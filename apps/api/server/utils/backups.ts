/**
 * Automatic backups (Plus). One `backupConfigs` row per user; one zip per
 * QStash message ("part") holding only the bookmarks that changed since the
 * last part.
 *
 * Incremental by `(updatedAt, objectId)`: the row's `cursor` is where the last
 * finished run stopped, `run.cursor` is how far the current one has got. A
 * part uploads, saves `run.cursor`, and queues the next part; so a crash or a
 * deploy loses at most one part, and the dispatcher picks the run back up when
 * its lease (`nextRunAt`) lapses. Nothing is ever deleted at the destination —
 * restoring means unzipping every part in name order.
 *
 * The row is master-key only: it holds encrypted credentials, so not even its
 * owner reads it directly.
 */
import Parse from 'parse/node.js';
import archiver from 'archiver';
import { createWriteStream } from 'fs';
import { stat, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createError, setResponseStatus, type H3Event } from 'h3';
import { initParseForBoards } from './boardUtils';
import { serializeBookmark } from './publicApi';
import { getUserWithPlan, hasPlanFeature } from './plans';
import { withRedisLock, getActiveSubscriptions, usageErrorBody } from './rssUtils';
import { buildOpml } from './rssParser';
import { sendToQstash } from './serverUtils';
import {
  bookmarkFileEntries, decryptSecret, encryptSecret, netscapeHtml, nextRunAfter, partFileName,
  BACKUP_FILE_COLUMNS, type BackupDestination, type BackupFrequency,
} from './backupFormat';
import { uploadBackupFile, DestinationAuthError } from './backupDestinations';

export const BACKUP_CONFIGS_CLASS = 'backupConfigs';
export const BACKUP_RUN_MESSAGE = 'backup-run-requests';
/** Not partitioned: the queue's parallelism is the global cap on concurrent backups. */
export const BACKUP_QUEUE = 'backupRun';

const BackupConfigs = Parse.Object.extend(BACKUP_CONFIGS_CLASS);
const Websites = Parse.Object.extend('websites');

const PAGE_SIZE = 200;
/** Dropbox's single-request upload stops at 150 MB. */
const PART_MAX_BYTES = 140 * 1024 * 1024;
/** minio alone retries a 5xx ten times with exponential backoff — up to about an hour. */
const LOCK_TTL_SECONDS = 90 * 60;
/** How long a run in progress may go quiet before the dispatcher resumes it. */
const RUN_LEASE_MS = 60 * 60_000;
const RETRY_AFTER_ERROR_MS = 6 * 60 * 60_000;
const FILE_TIMEOUT_MS = 60_000;

const userPointer = (objectId: string) => ({ __type: 'Pointer', className: '_User', objectId });

interface Cursor { updatedAt: string; id: string }
interface RunState { startedAt: string; part: number; cursor: Cursor | null }

// ─── Config ──────────────────────────────────────────────────────────────────

export async function getBackupConfig(userId: string): Promise<Parse.Object | undefined> {
  initParseForBoards();
  const query = new Parse.Query(BackupConfigs);
  query.equalTo('user', userPointer(userId));
  return query.first({ useMasterKey: true });
}

export async function isBackupAllowed(userId: string): Promise<boolean> {
  const { plan } = await getUserWithPlan(userId);
  return hasPlanFeature(plan, 'backups');
}

/** What the settings screen sees. Never the credentials. */
export function serializeBackupConfig(row: Parse.Object | undefined) {
  if (!row) return null;
  const iso = (value: any) => value?.toISOString?.() ?? null;
  return {
    destination: row.get('destination') as BackupDestination,
    destinationLabel: row.get('destinationLabel') || null,
    enabled: row.get('enabled') === true,
    frequency: (row.get('frequency') || 'daily') as BackupFrequency,
    running: row.get('enabled') === true && Boolean(row.get('run')) && !row.get('lastError'),
    needsReconnect: row.get('needsReconnect') === true,
    lastError: row.get('lastError') || null,
    lastSuccessAt: iso(row.get('lastSuccessAt')),
    nextRunAt: row.get('enabled') ? iso(row.get('nextRunAt')) : null,
  };
}

/**
 * Point a user's backups somewhere. A different place starts over with a full
 * backup — the incremental parts are useless without the ones before them.
 * Re-entering the same S3 location (rotated keys) keeps the cursor; an OAuth
 * reconnect cannot tell whether it is the same account, so it starts over.
 */
export async function saveBackupDestination(
  userId: string,
  destination: BackupDestination,
  secret: unknown,
  label: string,
  folderId: string | null = null,
): Promise<Parse.Object> {
  const row = (await getBackupConfig(userId)) ?? newConfig(userId);
  const samePlace = destination === 's3' && row.get('destination') === 's3' && row.get('destinationLabel') === label;
  if (!samePlace) {
    row.set('cursor', null);
    row.set('run', null);
  }
  row.set('destination', destination);
  row.set('destinationLabel', label);
  row.set('credentials', encryptSecret(secret));
  row.set('folderId', folderId);
  row.set('needsReconnect', false);
  row.set('lastError', null);
  if (!row.get('frequency')) row.set('frequency', 'daily');
  row.set('enabled', true);
  // First backup (or first after a move) goes out on the next dispatcher tick.
  if (!samePlace || !row.get('nextRunAt')) row.set('nextRunAt', new Date());
  return row.save(null, { useMasterKey: true });
}

function newConfig(userId: string): Parse.Object {
  const row = new BackupConfigs();
  row.set('user', userPointer(userId));
  row.setACL(new Parse.ACL());
  return row;
}

function queueBackupPart(configIds: string[]) {
  const messages = configIds.map((configId) => ({ type: BACKUP_RUN_MESSAGE, data: { configId } }));
  return sendToQstash(messages.length === 1 ? messages[0] : messages, { isBatch: messages.length > 1, queueName: BACKUP_QUEUE });
}

/**
 * Start (or resume) a run for each config and queue its next part. Only a
 * config with a `run` gets worked on, so a duplicate message after the run
 * finished is a no-op. `nextRunAt` becomes the run's lease: the dispatcher
 * leaves it alone until the lease lapses.
 */
export async function startBackupRuns(rows: Parse.Object[]): Promise<void> {
  if (!rows.length) return;
  const now = new Date();
  for (const row of rows) {
    if (!row.get('run')) row.set('run', { startedAt: now.toISOString(), part: 0, cursor: row.get('cursor') || null });
    row.set('nextRunAt', new Date(now.getTime() + RUN_LEASE_MS));
    // A retry is running again; if it fails again the part says why.
    row.set('lastError', null);
  }
  await Parse.Object.saveAll(rows, { useMasterKey: true });
  await queueBackupPart(rows.map((row) => row.id));
}

/** Configs whose next run is due, or whose run in progress went quiet. */
export async function findDueBackups(limit: number): Promise<Parse.Object[]> {
  initParseForBoards();
  const query = new Parse.Query(BackupConfigs);
  query.equalTo('enabled', true);
  query.lessThanOrEqualTo('nextRunAt', new Date());
  query.ascending('nextRunAt');
  query.limit(limit);
  return query.find({ useMasterKey: true });
}

// ─── Running a part ──────────────────────────────────────────────────────────

export async function runBackupChunk(configId: string) {
  initParseForBoards();
  const result = await withRedisLock(`backup:lock:${configId}`, LOCK_TTL_SECONDS, () => runLocked(configId));
  console.log(`[backups] ${configId}:`, JSON.stringify(result));
  return result;
}

async function runLocked(configId: string) {
  const row = await new Parse.Query(BackupConfigs).get(configId, { useMasterKey: true }).catch(() => null);
  if (!row || row.get('enabled') !== true || !row.get('credentials')) return { stopped: 'disabled' };

  // A duplicate message arriving after the run finished.
  const run: RunState | null = row.get('run') || null;
  if (!run) return { stopped: 'no_run' };

  const userId = row.get('user').id as string;

  if (!(await isBackupAllowed(userId))) {
    // Kept, not deleted: re-subscribing picks up where it stopped.
    await finishRun(row, run, 'plan_required');
    return { stopped: 'plan_required' };
  }

  const credentials = row.get('credentials');
  try {
    const page = await changedBookmarks(userId, run.cursor, new Date(run.startedAt));
    if (!page.length && run.part === 0) {
      await finishRun(row, run, null);
      return { stopped: 'no_changes' };
    }

    const { included, filePath, size } = await buildPart(userId, page, run);
    try {
      const { folderId } = await uploadBackupFile(
        { destination: row.get('destination'), secret: decryptSecret(credentials), folderId: row.get('folderId') },
        partFileName(run.startedAt, run.part + 1),
        filePath,
        size,
      );
      if (folderId) row.set('folderId', folderId);
    } finally {
      await unlink(filePath).catch(() => { });
    }

    // The user moved their backups elsewhere while this part was uploading.
    const current = await new Parse.Query(BackupConfigs).get(configId, { useMasterKey: true });
    if (current.get('credentials') !== credentials) return { stopped: 'destination_changed' };

    const last = included[included.length - 1];
    const next: RunState = { ...run, part: run.part + 1, cursor: last ? { updatedAt: last.updatedAt.toISOString(), id: last.id } : run.cursor };
    const more = included.length < page.length || page.length === PAGE_SIZE;
    if (!more) {
      await finishRun(row, next, null);
      return { done: true, parts: next.part };
    }

    row.set('run', next);
    row.set('lastError', null);
    row.set('nextRunAt', new Date(Date.now() + RUN_LEASE_MS));
    await row.save(null, { useMasterKey: true });
    await queueBackupPart([configId]);
    return { part: next.part, bookmarks: included.length };
  } catch (error: any) {
    const message = error?.message || String(error);
    console.error(`[backups] ${configId} failed:`, message);
    // `run` is left as it was: the retry resumes from the last uploaded part.
    row.set('lastError', message.slice(0, 500));
    if (error instanceof DestinationAuthError) {
      row.set('needsReconnect', true);
      row.set('enabled', false);
    } else {
      row.set('nextRunAt', new Date(Date.now() + RETRY_AFTER_ERROR_MS));
    }
    await row.save(null, { useMasterKey: true });
    return { error: message };
  }
}

async function finishRun(row: Parse.Object, run: RunState, error: string | null) {
  const frequency = row.get('frequency') || 'daily';
  if (!error) {
    row.set('cursor', run.cursor);
    row.set('run', null);
    row.set('lastSuccessAt', new Date());
  }
  row.set('lastError', error);
  // Scheduled from the run's start so it keeps its time of day — unless the
  // run took so long (a huge first backup) that that is already past.
  const next = nextRunAfter(error ? new Date() : run.startedAt, frequency);
  row.set('nextRunAt', next > new Date() ? next : nextRunAfter(new Date(), frequency));
  await row.save(null, { useMasterKey: true });
}

/**
 * The next page of bookmarks changed after `cursor`, oldest first. Ties on
 * `updatedAt` break on objectId so a bulk import saved in one millisecond is
 * not split across a page boundary and half-skipped. Anything changed after
 * the run started waits for the next run. Soft-deleted rows come too — the
 * backup records the delete rather than forgetting the bookmark.
 */
async function changedBookmarks(userId: string, cursor: Cursor | null, until: Date): Promise<Parse.Object[]> {
  const scoped = () => {
    const query = new Parse.Query(Websites);
    query.equalTo('user', userPointer(userId));
    query.lessThanOrEqualTo('updatedAt', until);
    return query;
  };
  let query = scoped();
  if (cursor) {
    const at = new Date(cursor.updatedAt);
    const after = scoped().greaterThan('updatedAt', at);
    const sameMs = scoped().equalTo('updatedAt', at).greaterThan('objectId', cursor.id);
    query = Parse.Query.or(after, sameMs);
  }
  query.ascending('updatedAt').addAscending('objectId');
  query.limit(PAGE_SIZE);
  return query.find({ useMasterKey: true });
}

/**
 * Zip a page of bookmarks into a temp file, stopping early once the part is
 * big enough. The last part of a run also carries full snapshots: boards,
 * feeds, and a browser-importable bookmarks.html of everything still live.
 *
 * ponytail: re-sends a changed bookmark's unchanged files; track file names per bookmark if parts get big.
 */
async function buildPart(userId: string, page: Parse.Object[], run: RunState) {
  const filePath = join(tmpdir(), `webbites-backup-${userId}-${Date.now()}.zip`);
  const output = createWriteStream(filePath);
  const archive = archiver('zip', { zlib: { level: 6 } });
  const written = new Promise<void>((resolve, reject) => {
    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
  });
  archive.pipe(output);

  const included: Parse.Object[] = [];
  const records: any[] = [];
  let bytes = 0;

  try {
    for (const row of page) {
      const refs = Object.fromEntries(Object.keys(BACKUP_FILE_COLUMNS).map((column) => {
        const file = row.get(column);
        return [column, file?.url ? { name: file.name(), url: file.url() } : null];
      }));
      const files: Record<string, string> = {};
      const missingFiles: Record<string, string> = {};
      const entries: Array<{ path: string; data: Buffer | string }> = [];
      let rowBytes = 0;

      for (const entry of bookmarkFileEntries(row.id, refs)) {
        const data = await downloadFile(entry.url);
        // Gone, or would push this one bookmark past a whole part: keep the link instead.
        if (!data || rowBytes + data.length > PART_MAX_BYTES) {
          missingFiles[entry.kind] = entry.url;
          continue;
        }
        entries.push({ path: entry.path, data });
        files[entry.kind] = entry.path;
        rowBytes += data.length;
      }
      if (!files.reader && row.get('siteBody')) {
        const text = String(row.get('siteBody'));
        files.reader = `files/${row.id}/reader.txt`;
        entries.push({ path: files.reader, data: text });
        rowBytes += Buffer.byteLength(text);
      }

      // Full: this bookmark opens the next part.
      if (included.length && bytes + rowBytes > PART_MAX_BYTES) break;
      for (const { path, data } of entries) {
        // Images and PDFs are already compressed; deflating them again only costs CPU.
        archive.append(data, { name: path, store: !/\.(html|txt|json)$/.test(path) });
      }
      bytes += rowBytes;

      records.push({
        ...serializeBookmark(row),
        fileName: row.get('fileName') ?? null,
        deletedAt: row.get('isDeleted') ? row.get('deletedAt') || true : null,
        files,
        ...(Object.keys(missingFiles).length ? { missingFiles } : {}),
      });
      included.push(row);
    }

    archive.append(JSON.stringify({
      version: 1,
      runStartedAt: run.startedAt,
      part: run.part + 1,
      bookmarks: records,
    }, null, 2), { name: 'bookmarks.json' });

    const lastPart = included.length === page.length && page.length < PAGE_SIZE;
    if (lastPart) {
      const snapshots = await buildSnapshots(userId);
      for (const [name, body] of Object.entries(snapshots)) archive.append(body, { name });
    }

    await archive.finalize();
    await written;
  } catch (error) {
    archive.abort();
    await unlink(filePath).catch(() => { });
    throw error;
  }

  return { included, filePath, size: (await stat(filePath)).size };
}

/** A stored file's bytes, or null when it is gone or too big to fit in a part. */
async function downloadFile(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FILE_TIMEOUT_MS) });
    if (!res.ok) return null;
    if (Number(res.headers.get('content-length') || 0) > PART_MAX_BYTES) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function buildSnapshots(userId: string): Promise<Record<string, string>> {
  const all = (className: string, configure?: (query: Parse.Query) => void) => {
    const query = new Parse.Query(className);
    query.equalTo('user', userPointer(userId));
    configure?.(query);
    return query.findAll({ useMasterKey: true, batchSize: 1000 });
  };
  const plain = (row: Parse.Object) => {
    const { ACL, user, ...rest } = row.toJSON() as any;
    return rest;
  };

  const [live, boards, boardBookmarks, subscriptions] = await Promise.all([
    all('websites', (query) => {
      query.notEqualTo('isDeleted', true);
      query.select('url', 'siteTitle', 'tags', 'createdAt');
    }),
    all('boards', (query) => query.notEqualTo('isDeleted', true)),
    all('boardBookmarks', (query) => query.notEqualTo('isDeleted', true)),
    getActiveSubscriptions(userId),
  ]);

  return {
    'bookmarks.html': netscapeHtml(live.map((row) => ({
      url: row.get('url'), title: row.get('siteTitle'), tags: row.get('tags'), createdAt: row.createdAt,
    }))),
    'boards.json': JSON.stringify({ boards: boards.map(plain), boardBookmarks: boardBookmarks.map(plain) }, null, 2),
    'feeds.opml': buildOpml(subscriptions.map((subscription) => {
      const feed = subscription.get('feed');
      return {
        title: subscription.get('customTitle') || feed?.get('title') || feed?.get('feedUrl'),
        xmlUrl: feed?.get('feedUrl'),
        htmlUrl: feed?.get('siteUrl') || null,
      };
    })),
  };
}

// ─── Route helpers ───────────────────────────────────────────────────────────

/**
 * The UsageError body (with a 403) when the plan lacks backups, else null.
 * Only for turning things on — switching off or disconnecting always works.
 */
export async function backupsRefusal(event: H3Event, userId: string) {
  if (await isBackupAllowed(userId)) return null;
  setResponseStatus(event, 403);
  return usageErrorBody('Automatic backups are part of WebBites Plus.', 'backups');
}

/** 404 for "no backups set up yet", which the routes that act on a config share. */
export async function requireBackupConfig(userId: string): Promise<Parse.Object> {
  const row = await getBackupConfig(userId);
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Backups are not set up' });
  return row;
}
