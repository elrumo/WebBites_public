/**
 * The pure half of backups: credential encryption, the zip layout, the
 * Netscape export and the schedule. No Parse and no network here, so
 * `npm run test:backups` needs nothing but a key.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { extname } from 'path';

export const BACKUP_DESTINATIONS = ['s3', 'gdrive', 'dropbox'] as const;
export type BackupDestination = typeof BACKUP_DESTINATIONS[number];
export const BACKUP_FREQUENCIES = ['daily', 'weekly'] as const;
export type BackupFrequency = typeof BACKUP_FREQUENCIES[number];

// ─── Credentials at rest ─────────────────────────────────────────────────────

function encryptionKey(): Buffer {
  const key = Buffer.from(process.env.BACKUP_ENCRYPTION_KEY || '', 'base64');
  if (key.length !== 32) throw new Error('BACKUP_ENCRYPTION_KEY must be 32 bytes, base64 encoded');
  return key;
}

/** AES-256-GCM, stored as `iv.tag.ciphertext` (base64url). Tampering fails the auth tag. */
export function encryptSecret(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64url')).join('.');
}

export function decryptSecret<T = any>(stored: string): T {
  const [iv, tag, data] = String(stored).split('.').map((part) => Buffer.from(part, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
}

// ─── Zip layout ──────────────────────────────────────────────────────────────

/** `websites` file columns that go into a backup, and the name each gets in the zip. */
export const BACKUP_FILE_COLUMNS = {
  siteScreenshot: 'screenshot',
  fullPageScreenshot: 'fullpage',
  OGImageFile: 'og-image',
  siteHtmlFile: 'page',
  siteBodyFile: 'reader',
  file: 'file',
} as const;

const DEFAULT_EXT: Record<string, string> = { page: '.html', reader: '.html' };

export interface StoredFileRef { name: string; url: string }
export interface BackupFileEntry { kind: string; url: string; path: string }

/** Where each of a bookmark's stored files lands: `files/<id>/<kind><ext>`. */
export function bookmarkFileEntries(id: string, files: Record<string, StoredFileRef | null | undefined>): BackupFileEntry[] {
  return Object.entries(BACKUP_FILE_COLUMNS).flatMap(([column, kind]) => {
    const file = files[column];
    if (!file?.url) return [];
    const ext = extname(file.name || '').toLowerCase() || DEFAULT_EXT[kind] || '';
    return [{ kind, url: file.url, path: `files/${id}/${kind}${ext}` }];
  });
}

/** `webbites-backup-2026-09-24T03-20-05Z-part1.zip` — sorts by run, then part. */
export function partFileName(startedAt: string | Date, part: number): string {
  const stamp = new Date(startedAt).toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
  return `webbites-backup-${stamp}-part${part}.zip`;
}

// ─── Netscape bookmarks file ─────────────────────────────────────────────────

const escapeHtml = (value: unknown) =>
  String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

export interface NetscapeBookmark { url?: string | null; title?: string | null; tags?: string[]; createdAt?: string | Date }

/** The format every browser imports. */
export function netscapeHtml(bookmarks: NetscapeBookmark[]): string {
  const rows = bookmarks.filter((b) => b.url).map((b) => {
    const added = b.createdAt ? Math.floor(new Date(b.createdAt).getTime() / 1000) : '';
    const tags = b.tags?.length ? ` TAGS="${escapeHtml(b.tags.join(','))}"` : '';
    return `    <DT><A HREF="${escapeHtml(b.url)}" ADD_DATE="${added}"${tags}>${escapeHtml(b.title || b.url)}</A>`;
  });
  return [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>WebBites</H1>',
    '<DL><p>',
    ...rows,
    '</DL><p>',
    '',
  ].join('\n');
}

// ─── Schedule ────────────────────────────────────────────────────────────────

/**
 * The dispatcher ticks hourly, so a run that started at :20:05 and is next due
 * at :20:05 would miss the :20:00 tick and slip an hour every day. Due half an
 * hour early instead.
 */
export function nextRunAfter(startedAt: string | Date, frequency: BackupFrequency): Date {
  const days = frequency === 'weekly' ? 7 : 1;
  return new Date(new Date(startedAt).getTime() + days * 86_400_000 - 30 * 60_000);
}
