/**
 * Where backups go. Every destination does one thing — store a zip under a
 * name — so a run is one upload per part, not one per bookmark.
 *
 * Google Drive and Dropbox hold a long-lived refresh token; each part trades
 * it for a fresh access token, so a revoked grant shows up as
 * `DestinationAuthError` and the config is parked until the user reconnects.
 */
import { createReadStream } from 'fs';
import { request } from 'https';
import * as Minio from 'minio';
import { createError } from 'h3';
import { assertPublicHttpsUrl } from './automationRules';
import type { BackupDestination } from './backupFormat';

/** The grant is gone or the keys are wrong: retrying will not help, the user has to act. */
export class DestinationAuthError extends Error {}

export interface S3Secret { endpoint: string; region?: string; bucket: string; prefix?: string; accessKey: string; secretKey: string }
export interface OAuthSecret { refreshToken: string }
export interface BackupTarget { destination: BackupDestination; secret: any; folderId?: string | null }

const DRIVE_FOLDER_NAME = 'WebBites Backups';
const OAUTH_PROVIDERS = ['gdrive', 'dropbox'] as const;
export type OAuthProvider = typeof OAUTH_PROVIDERS[number];

export function isOAuthProvider(value: string): value is OAuthProvider {
  return (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

/** Store `filePath` as `name`. Answers a new Drive folder id when the old one had to be recreated. */
export async function uploadBackupFile(target: BackupTarget, name: string, filePath: string, size: number): Promise<{ folderId?: string }> {
  if (target.destination === 's3') {
    await s3Upload(target.secret, name, filePath, size);
    return {};
  }
  if (target.destination === 'dropbox') {
    await dropboxUpload(await refreshAccessToken('dropbox', target.secret.refreshToken), name, filePath, size);
    return {};
  }
  return driveUpload(await refreshAccessToken('gdrive', target.secret.refreshToken), target.folderId || null, name, filePath, size);
}

/** Streams a file as the request body. `fetch` cannot be trusted to send Content-Length with a stream. */
function httpUpload(url: string, method: string, headers: Record<string, string>, filePath: string, size: number) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(url, { method, headers: { ...headers, 'Content-Length': String(size) } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode || 0, body }));
    });
    req.on('error', reject);
    createReadStream(filePath).on('error', reject).pipe(req);
  });
}

function providerError(provider: string, status: number, body: string): Error {
  let detail = body.slice(0, 200);
  try {
    const json = JSON.parse(body);
    detail = json?.error?.message || json?.error_summary || json?.error_description || json?.error || detail;
  } catch { /* plain text */ }
  const message = `${provider} answered ${status}: ${detail}`;
  return status === 401 ? new DestinationAuthError(message) : new Error(message);
}

// ─── S3-compatible ───────────────────────────────────────────────────────────

const S3_AUTH_CODES = new Set(['AccessDenied', 'InvalidAccessKeyId', 'SignatureDoesNotMatch', 'NoSuchBucket']);

/** Validates what the user typed. Throws 400 so the settings form can show it. */
export function normalizeS3Secret(raw: any): S3Secret {
  const text = (value: unknown) => String(value ?? '').trim();
  const secret: S3Secret = {
    endpoint: text(raw?.endpoint).replace(/\/+$/, ''),
    region: text(raw?.region) || 'us-east-1',
    bucket: text(raw?.bucket),
    prefix: text(raw?.prefix).replace(/^\/+/, ''),
    accessKey: text(raw?.accessKey),
    secretKey: text(raw?.secretKey),
  };
  if (secret.prefix && !secret.prefix.endsWith('/')) secret.prefix += '/';
  if (!secret.bucket || !secret.accessKey || !secret.secretKey) {
    throw createError({ statusCode: 400, statusMessage: 'Endpoint, bucket, access key and secret key are all required' });
  }
  try {
    // The backend signs requests to whatever host this names, so no private addresses.
    assertPublicHttpsUrl(secret.endpoint);
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'The endpoint must be a public https:// URL' });
  }
  return secret;
}

export function s3Label(secret: S3Secret): string {
  return `${secret.bucket}/${secret.prefix || ''} · ${new URL(secret.endpoint).host}`;
}

function s3Client(secret: S3Secret): Minio.Client {
  const url = new URL(secret.endpoint);
  return new Minio.Client({
    endPoint: url.hostname,
    port: url.port ? Number(url.port) : undefined,
    useSSL: url.protocol === 'https:',
    accessKey: secret.accessKey,
    secretKey: secret.secretKey,
    region: secret.region || 'us-east-1',
  });
}

async function s3Upload(secret: S3Secret, name: string, filePath: string, size: number) {
  try {
    await s3Client(secret).putObject(secret.bucket, `${secret.prefix || ''}${name}`, createReadStream(filePath), size, { 'Content-Type': 'application/zip' });
  } catch (error: any) {
    const message = `S3: ${error?.code || error?.message || 'upload failed'}`;
    throw S3_AUTH_CODES.has(error?.code) ? new DestinationAuthError(message) : new Error(message);
  }
}

/** Proves the keys can write before they are saved. Leaves a small marker file behind. */
export async function testS3Destination(secret: S3Secret): Promise<void> {
  const marker = 'WebBites backups are written to this location.\n';
  try {
    await s3Client(secret).putObject(secret.bucket, `${secret.prefix || ''}webbites-connection-test.txt`, marker, Buffer.byteLength(marker), { 'Content-Type': 'text/plain' });
  } catch (error: any) {
    throw createError({ statusCode: 400, statusMessage: `Could not write to that bucket: ${error?.code || error?.message || 'unknown error'}` });
  }
}

// ─── OAuth (Google Drive, Dropbox) ───────────────────────────────────────────

const OAUTH = {
  gdrive: {
    name: 'Google Drive',
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    clientId: () => process.env.GOOGLE_DRIVE_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_DRIVE_CLIENT_SECRET,
    // drive.file only sees what WebBites itself created — no access to the rest of the Drive.
    params: { scope: 'https://www.googleapis.com/auth/drive.file', access_type: 'offline', prompt: 'consent' },
  },
  dropbox: {
    name: 'Dropbox',
    authorize: 'https://www.dropbox.com/oauth2/authorize',
    token: 'https://api.dropboxapi.com/oauth2/token',
    clientId: () => process.env.DROPBOX_APP_KEY,
    clientSecret: () => process.env.DROPBOX_APP_SECRET,
    // An "App folder" app: files land in /Apps/<app name>/ and nowhere else.
    params: { token_access_type: 'offline' },
  },
} as const;

export const oauthRedirectUri = (provider: OAuthProvider) => `${process.env.VITE_BACKEND_URL}v1/backups/connect/${provider}/callback`;

export function oauthProviderName(provider: OAuthProvider): string {
  return OAUTH[provider].name;
}

export function assertOAuthConfigured(provider: OAuthProvider): void {
  if (!OAUTH[provider].clientId() || !OAUTH[provider].clientSecret()) {
    throw createError({ statusCode: 503, statusMessage: `${OAUTH[provider].name} backups are not configured on this server` });
  }
}

export function oauthAuthorizeUrl(provider: OAuthProvider, state: string): string {
  const config = OAUTH[provider];
  const params = new URLSearchParams({
    client_id: config.clientId() as string,
    redirect_uri: oauthRedirectUri(provider),
    response_type: 'code',
    state,
    ...config.params,
  });
  return `${config.authorize}?${params}`;
}

async function tokenRequest(provider: OAuthProvider, fields: Record<string, string>) {
  const config = OAUTH[provider];
  const res = await fetch(config.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId() as string, client_secret: config.clientSecret() as string, ...fields }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.text();
  if (res.status === 400 && body.includes('invalid_grant')) {
    throw new DestinationAuthError(`${config.name} access was revoked — reconnect it in Settings`);
  }
  if (!res.ok) throw providerError(config.name, res.status, body);
  return JSON.parse(body);
}

async function refreshAccessToken(provider: OAuthProvider, refreshToken: string): Promise<string> {
  const json = await tokenRequest(provider, { grant_type: 'refresh_token', refresh_token: refreshToken });
  return json.access_token;
}

/** Code → refresh token, plus the Drive folder backups go into. */
export async function exchangeOAuthCode(provider: OAuthProvider, code: string): Promise<{ secret: OAuthSecret; folderId: string | null }> {
  const json = await tokenRequest(provider, { grant_type: 'authorization_code', code, redirect_uri: oauthRedirectUri(provider) });
  if (!json.refresh_token) throw new Error(`${OAUTH[provider].name} did not return a refresh token`);
  const folderId = provider === 'gdrive' ? await createDriveFolder(json.access_token) : null;
  return { secret: { refreshToken: json.refresh_token }, folderId };
}

// ─── Google Drive ────────────────────────────────────────────────────────────

async function createDriveFolder(accessToken: string): Promise<string> {
  const res = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.text();
  if (!res.ok) throw providerError('Google Drive', res.status, body);
  return JSON.parse(body).id;
}

async function driveUpload(accessToken: string, folderId: string | null, name: string, filePath: string, size: number): Promise<{ folderId?: string }> {
  let folder = folderId || await createDriveFolder(accessToken);
  let session = await startDriveSession(accessToken, folder, name, size);
  if (session.status === 404) {
    // The user deleted the folder: make a new one rather than fail every run.
    folder = await createDriveFolder(accessToken);
    session = await startDriveSession(accessToken, folder, name, size);
  }
  const location = session.headers.get('location');
  if (!session.ok || !location) throw providerError('Google Drive', session.status, await session.text());

  const put = await httpUpload(location, 'PUT', { 'Content-Type': 'application/zip' }, filePath, size);
  if (put.status !== 200 && put.status !== 201) throw providerError('Google Drive', put.status, put.body);
  return folder !== folderId ? { folderId: folder } : {};
}

function startDriveSession(accessToken: string, folderId: string, name: string, size: number) {
  return fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'application/zip',
      'X-Upload-Content-Length': String(size),
    },
    body: JSON.stringify({ name, parents: [folderId] }),
    signal: AbortSignal.timeout(30_000),
  });
}

// ─── Dropbox ─────────────────────────────────────────────────────────────────

/** Single-request upload, capped at 150 MB by Dropbox — which is why parts stop at 140 MB. */
async function dropboxUpload(accessToken: string, name: string, filePath: string, size: number) {
  const res = await httpUpload('https://content.dropboxapi.com/2/files/upload', 'POST', {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/octet-stream',
    'Dropbox-API-Arg': JSON.stringify({ path: `/${name}`, mode: 'overwrite', mute: true }),
  }, filePath, size);
  if (res.status !== 200) throw providerError('Dropbox', res.status, res.body);
}
