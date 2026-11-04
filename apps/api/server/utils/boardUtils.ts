/**
 * Utility functions for Bookmark Boards
 * Handles Parse class setup, queries, auth, soft-delete, and board operations
 */

import Parse from 'parse/node.js';
import crypto from 'crypto';
import { createError } from 'h3';
import { validateParseToken } from './raycast-auth.js';
import {
  MAX_BOARD_DEPTH,
  type BoardMode,
  type BoardKind,
  type BoardVisibility,
  type BoardBookmarkSource,
  type SmartRules,
  type VisibilityConfig,
  type BoardResponse,
  type AuthUser,
} from '../types/board.types';
import { hasRole, type BoardRole } from './boardAccessRules';
import {
  getActiveMembership, boardsWithMembers, sharedBoardsFor, listMembers, serializeMember, displayName, displayNames,
} from './boardSharing';
import { notifyBoardAudience } from './boardNotifications';
import { siteUrl } from '#root/server/utils/site';

const Boards = Parse.Object.extend('boards');
const BoardBookmarks = Parse.Object.extend('boardBookmarks');
const Websites = Parse.Object.extend('websites');

let parseInitialized = false;

export function initParseForBoards() {
  if (parseInitialized) return;
  Parse.initialize(
    process.env.VITE_PARSE_ID as string,
    process.env.VITE_PARSE_JS_KEY as string,
    process.env.VITE_PARSE_MASTER_KEY as string
  );
  Parse.serverURL = process.env.VITE_PARSE_URL as string;
  parseInitialized = true;
}

// ─── Authentication ─────────────────────────────────────────────────────────

/**
 * Authenticate the request using Parse session token in Authorization header.
 * Returns the authenticated user context or throws 401.
 */
export async function requireAuth(event: any): Promise<AuthUser> {
  return await validateParseToken(event) as AuthUser;
}

// ─── ACL ─────────────────────────────────────────────────────────────────────

/**
 * Create an ACL granting read/write only to the specified user.
 */
export function makeOwnerAcl(userId: string): Parse.ACL {
  const acl = new Parse.ACL();
  acl.setPublicReadAccess(false);
  acl.setPublicWriteAccess(false);
  acl.setReadAccess(userId, true);
  acl.setWriteAccess(userId, true);
  return acl;
}

// ─── Validation ──────────────────────────────────────────────────────────────

const VALID_MODES: BoardMode[] = ['manual', 'smart', 'mixed'];
const VALID_VISIBILITIES: BoardVisibility[] = ['private', 'link', 'email_list', 'email_domain'];

export function validateMode(mode: string): asserts mode is BoardMode {
  if (!VALID_MODES.includes(mode as BoardMode)) {
    throw createError({ statusCode: 400, statusMessage: `mode must be one of: ${VALID_MODES.join(', ')}` });
  }
}

export function validateVisibility(
  visibility: string,
  visibilityConfig?: VisibilityConfig
): asserts visibility is BoardVisibility {
  if (!VALID_VISIBILITIES.includes(visibility as BoardVisibility)) {
    throw createError({ statusCode: 400, statusMessage: `visibility must be one of: ${VALID_VISIBILITIES.join(', ')}` });
  }
  if (visibility === 'email_list' && (!visibilityConfig?.allowedEmails || visibilityConfig.allowedEmails.length === 0)) {
    throw createError({ statusCode: 400, statusMessage: 'allowedEmails is required for email_list visibility' });
  }
  if (visibility === 'email_domain' && (!visibilityConfig?.allowedDomains || visibilityConfig.allowedDomains.length === 0)) {
    throw createError({ statusCode: 400, statusMessage: 'allowedDomains is required for email_domain visibility' });
  }
}

/**
 * Cleans a client smartRules payload. Topics may be empty: a smart board can
 * match on its own conditions alone (see syncBoardAutomation).
 */
export function normalizeSmartRules(raw: any): SmartRules {
  const topics = (Array.isArray(raw?.topics) ? raw.topics : [])
    .map((t: unknown) => String(t ?? '').trim().slice(0, 100))
    .filter(Boolean)
    .slice(0, 20);
  const threshold = Number(raw.confidenceThreshold ?? 0.6);
  return {
    topics,
    confidenceThreshold: Number.isFinite(threshold) ? Math.min(1, Math.max(0, threshold)) : 0.6,
    autoApply: raw.autoApply !== false,
    includeExisting: !!raw.includeExisting,
  };
}

// ─── Share Token Security ────────────────────────────────────────────────────

/**
 * Generate a cryptographically secure share token.
 * Returns { rawToken, tokenHash } — only the hash is persisted.
 */
export function generateShareToken(): { rawToken: string; tokenHash: string } {
  const rawToken = crypto.randomBytes(24).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  return { rawToken, tokenHash };
}

/**
 * Verify a raw token against a stored hash.
 */
export function verifyShareToken(rawToken: string, storedHash: string): boolean {
  const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const stored = Buffer.from(storedHash ?? '');
  const computed = Buffer.from(hash);
  // timingSafeEqual throws on a length mismatch, which would surface a
  // malformed/legacy stored hash as a 500 instead of a denied share link.
  if (stored.length !== computed.length) return false;
  return crypto.timingSafeEqual(computed, stored);
}

/**
 * A link token the server can work out again, so the share dialog can show the
 * link whenever it is opened. Only the hash is stored (`tokenHash`), exactly as
 * before — `verifyShareToken` and the public route are unchanged — and
 * rotating bumps `tokenVersion`, which changes the token.
 */
export function deriveShareToken(boardId: string, version: number = 0): { rawToken: string; tokenHash: string } {
  const secret = process.env.SHARE_LINK_SECRET || process.env.VITE_PARSE_MASTER_KEY;
  if (!secret) throw createError({ statusCode: 500, statusMessage: 'Share links are not configured' });
  const rawToken = crypto.createHmac('sha256', secret).update(`${boardId}:${version}`).digest('hex').slice(0, 48);
  return { rawToken, tokenHash: crypto.createHash('sha256').update(rawToken).digest('hex') };
}

/** Only what a client may set of `visibilityConfig` — never the token fields. */
export function cleanVisibilityConfig(raw: any): VisibilityConfig {
  const list = (value: unknown) => (Array.isArray(value) ? value.map((v) => String(v).trim().toLowerCase()).filter(Boolean).slice(0, 100) : undefined);
  const config: VisibilityConfig = {};
  const emails = list(raw?.allowedEmails);
  const domains = list(raw?.allowedDomains);
  if (emails) config.allowedEmails = emails;
  if (domains) config.allowedDomains = domains;
  return config;
}

const websiteUrl = () => siteUrl();

/**
 * The shareable link of a `link` board, or null while it is private or its
 * stored token was issued before tokens could be derived (`needsRotate`).
 */
export function shareLinkFor(board: Parse.Object): { shareUrl: string | null; needsRotate: boolean } {
  if (board.get('visibility') !== 'link') return { shareUrl: null, needsRotate: false };
  const config = board.get('visibilityConfig') || {};
  const { rawToken, tokenHash } = deriveShareToken(board.id, config.tokenVersion ?? 0);
  if (config.tokenHash !== tokenHash) return { shareUrl: null, needsRotate: true };
  return { shareUrl: `${websiteUrl()}/board/${board.get('publicSlug')}?token=${rawToken}`, needsRotate: false };
}

// ─── Membership Key ──────────────────────────────────────────────────────────

/**
 * Build a deterministic membership key for dedup.
 */
export function buildMembershipKey(boardId: string, websiteId: string): string {
  return `${boardId}:${websiteId}`;
}

// ─── Query Helpers ───────────────────────────────────────────────────────────

/**
 * Get a board owned by the authenticated user, or throw 404.
 * Filters out soft-deleted boards.
 */
export async function getOwnedBoardOrThrow(
  user: Parse.User,
  boardId: string,
  /** Folders are 404 unless the caller is the one that manages them (rename, move, delete, parent lookup). */
  { allowFolder = false }: { allowFolder?: boolean } = {}
): Promise<Parse.Object> {
  const query = new Parse.Query(Boards);
  query.equalTo('owner', user);
  query.notEqualTo('isDeleted', true);
  let board: Parse.Object;
  try {
    board = await query.get(boardId, { useMasterKey: true });
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Board not found' });
  }
  if (!allowFolder && isFolder(board)) throw createError({ statusCode: 404, statusMessage: 'Board not found' });
  return board;
}

/** Rows from before folders existed have no `kind`; they are boards. */
export function isFolder(board: Parse.Object): boolean {
  return board.get('kind') === 'folder';
}

/**
 * A board the user may open, with the role that lets them: the owner, or a
 * member who accepted. 404 for anyone else, so a board's existence never leaks.
 */
export async function getBoardAccessOrThrow(
  user: Parse.User,
  boardId: string,
  min: BoardRole = 'viewer'
): Promise<{ board: Parse.Object; role: BoardRole }> {
  let board: Parse.Object;
  try {
    board = await new Parse.Query(Boards).notEqualTo('isDeleted', true).get(boardId, { useMasterKey: true });
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Board not found' });
  }
  if (isFolder(board)) throw createError({ statusCode: 404, statusMessage: 'Board not found' });
  let role: BoardRole | null = null;
  if (board.get('owner')?.id === user.id) role = 'owner';
  else role = ((await getActiveMembership(boardId, user.id))?.get('role') as BoardRole | undefined) ?? null;
  if (!hasRole(role, min)) throw createError({ statusCode: 404, statusMessage: 'Board not found' });
  return { board, role: role as BoardRole };
}

/**
 * Get a website/bookmark owned by the user, or throw 404.
 */
export async function getWebsiteForUser(
  user: Parse.User,
  websiteId: string
): Promise<Parse.Object> {
  const query = new Parse.Query(Websites);
  query.equalTo('user', user);
  try {
    return await query.get(websiteId, { useMasterKey: true });
  } catch {
    throw createError({ statusCode: 404, statusMessage: `Bookmark ${websiteId} not found` });
  }
}

/**
 * Get all non-deleted boards for a user.
 */
export async function getUserBoards(
  user: Parse.User,
  limit: number = 200,
  options: { includeArchived?: boolean } = {}
): Promise<Parse.Object[]> {
  const query = new Parse.Query(Boards);
  query.equalTo('owner', user);
  query.notEqualTo('isDeleted', true);
  query.descending('updatedAt');
  query.limit(limit);
  const boards = await query.find({ useMasterKey: true });
  if (options.includeArchived) return boards;
  // Filtered here rather than in the query: `archivedAt` is absent on every
  // board that predates archiving and null on one that was un-archived, and
  // `$exists: false` matches the first but not the second. A user has tens of
  // boards, not thousands, so one pass in JS beats an `or` of two subqueries.
  return boards.filter((board) => !board.get('archivedAt'));
}

/**
 * The boards in the user's sidebar: their own, then the ones shared with them.
 * A shared board is flagged with the viewer's role and its owner's name, and
 * is drawn at the top level — its parent belongs to the owner.
 */
export async function getBoardsForUser(
  user: Parse.User,
  limit: number = 200,
  options: { includeArchived?: boolean } = {}
): Promise<BoardResponse[]> {
  const [owned, shared] = await Promise.all([
    getUserBoards(user, limit, options),
    sharedBoardsFor(user.id),
  ]);
  const withMembers = await boardsWithMembers(owned.map((board) => board.id));
  const ownerNames = await displayNames(shared.map(({ board }) => board.get('owner')?.id));

  const mine = owned.map((board) => sanitizeBoard(board, {
    role: 'owner',
    shared: withMembers.has(board.id) || board.get('visibility') === 'link',
  }));
  const theirs = shared
    .filter(({ board }) => options.includeArchived || !board.get('archivedAt'))
    .map(({ board, role }) => sanitizeBoard(board, {
      role,
      shared: true,
      ownerName: ownerNames.get(board.get('owner')?.id) ?? 'Someone',
    }));
  return [...mine, ...theirs];
}

/**
 * What the sharing dialog needs: how the board is published, who has access,
 * and — for the owner only — the link and the members' addresses.
 */
export async function getSharingState(board: Parse.Object, role: BoardRole) {
  const isOwner = role === 'owner';
  const rows = await listMembers(board.id);
  const ownerId = board.get('owner')?.id as string;
  const names = await displayNames([ownerId, ...rows.map((row) => row.get('user')?.id)]);
  return {
    visibility: (board.get('visibility') || 'private') as BoardVisibility,
    ...(isOwner ? shareLinkFor(board) : { shareUrl: null, needsRotate: false }),
    owner: { id: ownerId, name: names.get(ownerId) ?? 'Someone' },
    members: rows.map((row) => serializeMember(row, names, isOwner)),
  };
}

/** Memberships the user has not removed from the board. */
function membershipQuery(boardId: string): Parse.Query {
  const query = new Parse.Query(BoardBookmarks);
  query.equalTo('board', { __type: 'Pointer', className: 'boards', objectId: boardId });
  query.notEqualTo('isDeleted', true);
  return query;
}

/**
 * Count active memberships in a board.
 */
export async function countBoardBookmarks(boardId: string): Promise<number> {
  return await membershipQuery(boardId).count({ useMasterKey: true });
}

/**
 * Get board bookmarks with pagination. Includes the website pointer.
 *
 * Bookmarks in the trash — and bookmarks hidden `everywhere` — are dropped
 * here, after the fetch, rather than with `matchesQuery('website', …)`: Parse
 * runs that inner query over the whole `websites` collection, which took ~30s
 * per call and timed the board out.
 *
 * Trashing a bookmark also soft-deletes its memberships (see
 * softDeleteBoardMembershipsForWebsites below), so the trash half of this
 * filter only catches memberships of bookmarks trashed before that existed.
 * Hiding does not touch memberships at all — a bookmark hidden from the
 * *library* is meant to stay in its boards, and that is the whole difference
 * between the two levels — so the hidden half is load-bearing on every call.
 *
 * This is the only board listing helper, which is what makes it the right
 * place: the owner's board view, the bookmarks sub-route and the *public*
 * shared-board route all come through here, so a bookmark hidden everywhere
 * cannot leak out through a share link.
 */
export async function getBoardBookmarkEntries(
  boardId: string,
  limit: number = 50,
  skip: number = 0,
  /** More `website.*` columns, for callers that show more than a card (MCP). */
  extraWebsiteFields: string[] = []
): Promise<Parse.Object[]> {
  const query = membershipQuery(boardId);
  query.include('website');
  // A website row carries siteBody, aiSummary, images…: a 40-row page was
  // ~490KB with the bare include and ~43KB with only what the board routes send.
  query.select(
    'source', 'aiTopic', 'aiConfidence', 'owner',
    'website.url', 'website.siteTitle', 'website.siteDescription',
    'website.OGImageFile', 'website.OGImage', 'website.type', 'website.subType',
    'website.tags', 'website.isDeleted', 'website.hiddenFrom',
    ...extraWebsiteFields.map((field) => `website.${field}`),
  );
  query.descending('createdAt');
  query.limit(limit);
  query.skip(skip);
  const entries = await query.find({ useMasterKey: true });
  // ponytail: dropped entries are still counted by countBoardBookmarks, so a
  // board holding them shows a total a page short. Same known ceiling the trash
  // filter already had; a count that ran the same filter would need the ~30s
  // subquery this exists to avoid.
  return entries.filter((entry) => {
    const website = entry.get('website');
    return !website?.get('isDeleted') && website?.get('hiddenFrom') !== 'everywhere';
  });
}

/**
 * Board entries as the API returns them, each with who added it (`owner` on a
 * membership is the person who filed it). Only other people's names cost a
 * query, so an unshared board costs nothing extra.
 */
export async function serializeBoardItems(entries: Parse.Object[], viewer: Parse.User) {
  const others = entries.map((entry) => entry.get('owner')?.id).filter((id) => id && id !== viewer.id);
  const names = await displayNames(others);
  names.set(viewer.id, displayName(viewer));
  return entries.map((entry) => {
    const website = entry.get('website');
    const adderId = entry.get('owner')?.id ?? null;
    return {
      membershipId: entry.id,
      source: entry.get('source') || 'manual',
      aiTopic: entry.get('aiTopic') || null,
      aiConfidence: entry.get('aiConfidence') || null,
      addedAt: entry.createdAt,
      addedBy: adderId ? { id: adderId, name: names.get(adderId) ?? 'Someone' } : null,
      website: website ? {
        id: website.id,
        url: website.get('url'),
        siteTitle: website.get('siteTitle'),
        siteDescription: website.get('siteDescription'),
        OGImage: website.get('OGImageFile')?.url() || website.get('OGImage'),
        type: website.get('type'),
        subType: website.get('subType'),
        tags: website.get('tags'),
      } : null,
    };
  });
}

/**
 * Find an existing membership by membershipKey (may be soft-deleted).
 */
export async function findMembership(
  membershipKey: string
): Promise<Parse.Object | undefined> {
  const query = new Parse.Query(BoardBookmarks);
  query.equalTo('membershipKey', membershipKey);
  return await query.first({ useMasterKey: true }) || undefined;
}

export type MembershipOutcome = 'created' | 'reactivated' | 'already_exists' | 'removed_by_user';

/**
 * Idempotent "put this bookmark on this board". The caller owns the
 * bookmarkCount update (manual adds batch it).
 *
 * `reactivate: false` leaves a membership the user removed by hand alone, so
 * an automation cannot keep putting back what the user took out.
 */
export async function addBookmarkToBoard(
  board: Parse.Object | string,
  websiteId: string,
  ownerId: string,
  { source, reactivate = true, aiTopic, aiConfidence }: {
    source: BoardBookmarkSource;
    reactivate?: boolean;
    aiTopic?: string;
    aiConfidence?: number;
  },
): Promise<MembershipOutcome> {
  const boardId = typeof board === 'string' ? board : board.id;
  const key = buildMembershipKey(boardId, websiteId);
  const existing = await findMembership(key);
  const setMeta = (row: Parse.Object) => {
    row.set('source', source);
    if (aiTopic !== undefined) row.set('aiTopic', aiTopic);
    if (aiConfidence !== undefined) row.set('aiConfidence', aiConfidence);
  };

  if (existing) {
    if (!existing.get('isDeleted')) return 'already_exists';
    if (!reactivate) return 'removed_by_user';
    existing.set('isDeleted', false);
    existing.unset('deletedAt');
    setMeta(existing);
    await existing.save(null, { useMasterKey: true });
    return 'reactivated';
  }

  const entry = new BoardBookmarks();
  entry.set('board', { __type: 'Pointer', className: 'boards', objectId: boardId });
  entry.set('website', { __type: 'Pointer', className: 'websites', objectId: websiteId });
  entry.set('owner', { __type: 'Pointer', className: '_User', objectId: ownerId });
  entry.set('membershipKey', key);
  entry.set('isDeleted', false);
  setMeta(entry);
  entry.setACL(makeOwnerAcl(ownerId));
  await entry.save(null, { useMasterKey: true });
  return 'created';
}

/**
 * Which of `websiteIds` the user owns and has not trashed.
 *
 * addBookmarkToBoard trusts the id it is handed, and the board listing then
 * loads `website` with the master key, so an id belonging to somebody else
 * used to put their title, URL and image on this user's board. Every caller
 * that takes ids from a request comes through here first.
 *
 * `excludeHidden` also drops bookmarks hidden at either level, for callers
 * (the MCP server) that must not even confirm a hidden bookmark exists.
 */
export async function ownedLiveWebsiteIds(
  userId: string,
  websiteIds: unknown[],
  { excludeHidden = false }: { excludeHidden?: boolean } = {},
): Promise<Set<string>> {
  const ids = [...new Set(websiteIds.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  if (ids.length === 0) return new Set();
  const query = new Parse.Query(Websites);
  query.equalTo('user', { __type: 'Pointer', className: '_User', objectId: userId });
  query.containedIn('objectId', ids);
  query.notEqualTo('isDeleted', true);
  if (excludeHidden) query.notContainedIn('hiddenFrom', ['library', 'everywhere']);
  query.select('objectId');
  query.limit(ids.length);
  const rows = await query.find({ useMasterKey: true });
  return new Set(rows.map((row) => row.id));
}

export type AddToBoardResult = {
  results: Array<{ websiteId: string; status: MembershipOutcome | 'not_found' | 'failed' }>;
  created: number;
};

/**
 * Add a user's own bookmarks to a board they own, keeping `bookmarkCount` in
 * step. Ids the user doesn't own (or has trashed) come back `not_found`
 * rather than failing the batch. `board` must already be ownership-checked,
 * e.g. by getOwnedBoardOrThrow.
 */
export async function addBookmarksToBoardForUser(
  board: Parse.Object,
  websiteIds: unknown[],
  userId: string,
  { source = 'manual', excludeHidden = false }: { source?: BoardBookmarkSource; excludeHidden?: boolean } = {},
): Promise<AddToBoardResult> {
  const owned = await ownedLiveWebsiteIds(userId, websiteIds, { excludeHidden });
  const results: AddToBoardResult['results'] = [];
  let created = 0;

  for (const websiteId of websiteIds) {
    if (typeof websiteId !== 'string' || !owned.has(websiteId)) {
      results.push({ websiteId: String(websiteId), status: 'not_found' });
      continue;
    }
    try {
      const status = await addBookmarkToBoard(board, websiteId, userId, { source });
      if (status === 'created' || status === 'reactivated') created++;
      results.push({ websiteId, status });
    } catch {
      results.push({ websiteId, status: 'failed' });
    }
  }

  if (created > 0) {
    await updateBoardBookmarkCount(board.id, created);
    await notifyBoardAudience(board, userId, 'item_added', {
      count: created,
      websiteIds: results.filter((r) => r.status === 'created' || r.status === 'reactivated').map((r) => r.websiteId),
    });
  }
  return { results, created };
}

/**
 * Get all boards a bookmark belongs to (active memberships only).
 */
export async function getBookmarkBoardMemberships(
  websiteId: string,
  userId: string
): Promise<Parse.Object[]> {
  const query = new Parse.Query(BoardBookmarks);
  query.equalTo('website', { __type: 'Pointer', className: 'websites', objectId: websiteId });
  query.equalTo('owner', { __type: 'Pointer', className: '_User', objectId: userId });
  query.notEqualTo('isDeleted', true);
  query.include('board');
  return await query.find({ useMasterKey: true });
}

/**
 * Find a board by publicSlug (for public access).
 */
export async function getBoardBySlug(publicSlug: string): Promise<Parse.Object | undefined> {
  const query = new Parse.Query(Boards);
  query.equalTo('publicSlug', publicSlug);
  query.notEqualTo('isDeleted', true);
  return await query.first({ useMasterKey: true }) || undefined;
}

// ─── Soft Delete ─────────────────────────────────────────────────────────────

/**
 * Take deleted bookmarks off every board they sit on.
 *
 * Called when a bookmark is moved to the trash. `deletedWithBookmark` marks
 * these apart from the memberships the user removed by hand, so restoring the
 * bookmark puts back exactly the boards the delete took away and nothing else.
 */
export async function softDeleteBoardMembershipsForWebsites(websiteIds: string[]): Promise<number> {
  if (!websiteIds || websiteIds.length === 0) return 0;

  const now = new Date().toISOString();
  const websitePointers = websiteIds.map((objectId) => ({
    __type: 'Pointer', className: 'websites', objectId,
  }));

  let total = 0;
  const batchSize = 100;
  while (true) {
    const query = new Parse.Query(BoardBookmarks);
    query.containedIn('website', websitePointers);
    query.notEqualTo('isDeleted', true);
    query.limit(batchSize);
    const entries = await query.find({ useMasterKey: true });
    if (entries.length === 0) break;

    for (const entry of entries) {
      entry.set('isDeleted', true);
      entry.set('deletedAt', now);
      entry.set('deletedWithBookmark', true);
    }
    await Parse.Object.saveAll(entries, { useMasterKey: true });
    total += entries.length;
    if (entries.length < batchSize) break;
  }

  return total;
}

/** The exact undo of the above, for a restore from the trash. */
export async function restoreBoardMembershipsForWebsites(websiteIds: string[]): Promise<number> {
  if (!websiteIds || websiteIds.length === 0) return 0;

  const websitePointers = websiteIds.map((objectId) => ({
    __type: 'Pointer', className: 'websites', objectId,
  }));

  let total = 0;
  const batchSize = 100;
  while (true) {
    const query = new Parse.Query(BoardBookmarks);
    query.containedIn('website', websitePointers);
    query.equalTo('isDeleted', true);
    query.equalTo('deletedWithBookmark', true);
    query.limit(batchSize);
    const entries = await query.find({ useMasterKey: true });
    if (entries.length === 0) break;

    for (const entry of entries) {
      entry.unset('isDeleted');
      entry.unset('deletedAt');
      entry.unset('deletedWithBookmark');
    }
    await Parse.Object.saveAll(entries, { useMasterKey: true });
    total += entries.length;
    if (entries.length < batchSize) break;
  }

  return total;
}

/**
 * Soft-delete a board and all its memberships.
 */
export async function softDeleteBoard(board: Parse.Object): Promise<number> {
  const now = new Date().toISOString();
  board.set('isDeleted', true);
  board.set('deletedAt', now);
  await board.save(null, { useMasterKey: true });

  // Soft-delete all memberships in batches
  let totalDeleted = 0;
  const batchSize = 100;
  while (true) {
    const query = new Parse.Query(BoardBookmarks);
    query.equalTo('board', board);
    query.notEqualTo('isDeleted', true);
    query.limit(batchSize);
    const entries = await query.find({ useMasterKey: true });
    if (entries.length === 0) break;

    for (const entry of entries) {
      entry.set('isDeleted', true);
      entry.set('deletedAt', now);
    }
    await Parse.Object.saveAll(entries, { useMasterKey: true });
    totalDeleted += entries.length;
    if (entries.length < batchSize) break;
  }

  return totalDeleted;
}

/**
 * Hard-delete records that have been soft-deleted for more than `daysOld` days.
 * Used by the scheduled purge task.
 */
export async function purgeDeletedRecords(daysOld: number = 30): Promise<{ boards: number; memberships: number }> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysOld);
  let boardsPurged = 0;
  let membershipsPurged = 0;

  // Purge old memberships first
  while (true) {
    const query = new Parse.Query(BoardBookmarks);
    query.equalTo('isDeleted', true);
    query.lessThan('deletedAt', cutoff.toISOString());
    query.limit(100);
    const entries = await query.find({ useMasterKey: true });
    if (entries.length === 0) break;
    await Parse.Object.destroyAll(entries, { useMasterKey: true });
    membershipsPurged += entries.length;
  }

  // Purge old boards
  while (true) {
    const query = new Parse.Query(Boards);
    query.equalTo('isDeleted', true);
    query.lessThan('deletedAt', cutoff.toISOString());
    query.limit(100);
    const entries = await query.find({ useMasterKey: true });
    if (entries.length === 0) break;
    await Parse.Object.destroyAll(entries, { useMasterKey: true });
    boardsPurged += entries.length;
  }

  return { boards: boardsPurged, memberships: membershipsPurged };
}

// ─── Serialization ───────────────────────────────────────────────────────────

/**
 * Serialize a Parse Board object to a clean API response.
 */
export function sanitizeBoard(
  board: Parse.Object,
  /** Sharing context; absent on the routes that only ever see an owner's board. */
  extra: { role?: BoardRole; shared?: boolean; ownerName?: string } = {}
): BoardResponse {
  const archivedAt = board.get('archivedAt');
  const foreign = !!extra.role && extra.role !== 'owner';
  return {
    ...extra,
    id: board.id,
    name: board.get('name'),
    kind: (isFolder(board) ? 'folder' : 'board') as BoardKind,
    description: board.get('description') || null,
    mode: board.get('mode') as BoardMode,
    smartRules: board.get('smartRules') || null,
    color: board.get('color') || null,
    icon: board.get('icon') || null,
    bookmarkCount: board.get('bookmarkCount') || 0,
    visibility: board.get('visibility') || 'private',
    publicSlug: board.get('publicSlug') || null,
    isDeleted: !!board.get('isDeleted'),
    parentId: foreign ? null : board.get('parent')?.id || null,
    path: foreign ? [] : board.get('path') || [],
    sortIndex: board.get('sortIndex') ?? 0,
    archivedAt: archivedAt?.toISOString?.() || archivedAt || null,
    createdAt: board.createdAt?.toISOString?.() || board.get('createdAt'),
    updatedAt: board.updatedAt?.toISOString?.() || board.get('updatedAt'),
  };
}

/**
 * Increment or decrement the bookmarkCount on a board.
 */
export async function updateBoardBookmarkCount(
  boardId: string,
  delta: number
): Promise<void> {
  const query = new Parse.Query(Boards);
  try {
    const board = await query.get(boardId, { useMasterKey: true });
    board.increment('bookmarkCount', delta);
    await board.save(null, { useMasterKey: true });
  } catch {
    // Board may have been deleted
  }
}

// ─── Creation ────────────────────────────────────────────────────────────────

export interface CreateBoardInput {
  name: string;
  kind?: BoardKind;
  description?: string | null;
  mode?: BoardMode;
  smartRules?: unknown;
  color?: string | null;
  icon?: string | null;
  parentId?: string | null;
  sortIndex?: unknown;
}

/**
 * Create a private board for `user`. Callers validate the mode and its rules
 * first; the parent is ownership- and depth-checked here (resolveBoardPath)
 * before anything is saved, so a bad parent never leaves a stray top-level
 * board behind. Shared by `POST /v1/boards` and the MCP `create_board` tool.
 */
export async function createBoard(
  user: Parse.User,
  userId: string,
  input: CreateBoardInput,
): Promise<Parse.Object> {
  const board = new Boards();
  board.set('name', String(input.name).trim().substring(0, 100));
  if (input.kind === 'folder') board.set('kind', 'folder');
  board.set('description', input.description ? String(input.description).trim().substring(0, 1000) : '');
  board.set('mode', input.mode ?? 'manual');
  board.set('owner', user);
  board.set('bookmarkCount', 0);
  board.set('visibility', 'private');
  board.set('isDeleted', false);
  board.set('publicSlug', crypto.randomUUID());

  if (input.smartRules) board.set('smartRules', normalizeSmartRules(input.smartRules));

  if (input.color) board.set('color', input.color);
  if (input.icon) board.set('icon', input.icon);

  const { parent, path } = await resolveBoardPath(user, input.parentId);
  if (parent) board.set('parent', parent);
  board.set('path', path);
  board.set('sortIndex', Number.isFinite(Number(input.sortIndex)) ? Number(input.sortIndex) : 0);

  board.setACL(makeOwnerAcl(userId));
  await board.save(null, { useMasterKey: true });
  return board;
}

// ─── Nesting ─────────────────────────────────────────────────────────────────

/** A pointer literal for a board id, or undefined for "no parent". */
function boardPointer(boardId: string | null | undefined) {
  if (!boardId) return undefined;
  return { __type: 'Pointer', className: 'boards', objectId: boardId } as const;
}

/**
 * The ancestor ids of a board, root first, excluding the board itself.
 *
 * Read off the parent's own `path` rather than walked, so this is one fetch
 * deep however far down the tree the board sits. The parent must be owned by
 * the same user, which is what stops a board being re-parented into somebody
 * else's tree.
 */
export async function resolveBoardPath(
  user: Parse.User,
  parentId: string | null | undefined
): Promise<{ parent: Parse.Object | null; path: string[] }> {
  if (!parentId) return { parent: null, path: [] };
  const parent = await getOwnedBoardOrThrow(user, parentId, { allowFolder: true });
  if (!isFolder(parent)) {
    throw createError({ statusCode: 400, statusMessage: 'Only folders can contain boards or other folders' });
  }
  const path = [...((parent.get('path') as string[]) || []), parent.id];
  if (path.length >= MAX_BOARD_DEPTH) {
    throw createError({
      statusCode: 400,
      statusMessage: `Collections may nest at most ${MAX_BOARD_DEPTH} deep`,
    });
  }
  return { parent, path };
}

/**
 * Every board under `boardId`, at any depth.
 *
 * One query, because `path` carries the whole ancestry of each row.
 */
export async function getDescendantBoards(
  user: Parse.User,
  boardId: string
): Promise<Parse.Object[]> {
  const query = new Parse.Query(Boards);
  query.equalTo('owner', user);
  query.notEqualTo('isDeleted', true);
  query.equalTo('path', boardId);
  query.limit(1000);
  return await query.find({ useMasterKey: true });
}

/**
 * Re-parent a board and repair the `path` of everything beneath it.
 *
 * Refuses a move into the board's own subtree (which would orphan the whole
 * branch into a cycle) and one that would push any descendant past the depth
 * cap, so the tree cannot be left inconsistent by a half-applied move.
 */
export async function moveBoard(
  user: Parse.User,
  board: Parse.Object,
  parentId: string | null
): Promise<void> {
  if (parentId === board.id) {
    throw createError({ statusCode: 400, statusMessage: 'A collection cannot contain itself' });
  }

  const descendants = await getDescendantBoards(user, board.id);
  if (parentId && descendants.some((child) => child.id === parentId)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A collection cannot be moved inside one of its own sub-collections',
    });
  }

  const { parent, path } = await resolveBoardPath(user, parentId);
  const oldPath = (board.get('path') as string[]) || [];
  const newPath = [...path];

  // The deepest descendant decides whether this move fits: its depth moves by
  // the same delta the board's does.
  const deepest = descendants.reduce(
    (max, child) => Math.max(max, ((child.get('path') as string[]) || []).length),
    oldPath.length
  );
  if (deepest - oldPath.length + newPath.length + 1 > MAX_BOARD_DEPTH) {
    throw createError({
      statusCode: 400,
      statusMessage: `That move would nest collections more than ${MAX_BOARD_DEPTH} deep`,
    });
  }

  if (parent) board.set('parent', parent);
  else board.unset('parent');
  board.set('path', newPath);

  const updates: Parse.Object[] = [board];
  for (const child of descendants) {
    const childPath = (child.get('path') as string[]) || [];
    // Everything from this board down keeps its own suffix and swaps the
    // prefix that led to the board for the new one.
    const suffix = childPath.slice(oldPath.length);
    child.set('path', [...newPath, ...suffix]);
    updates.push(child);
  }

  await Parse.Object.saveAll(updates, { useMasterKey: true });
}

/**
 * Put `orderedIds` under `parentId` in exactly that order — the one call behind
 * every drag in the sidebar. A board that is already under that parent is only
 * renumbered; one that came from elsewhere is moved first (cycle- and
 * depth-checked), so a rejected drop changes nothing for that row.
 */
export async function reorderBoards(
  user: Parse.User,
  parentId: string | null,
  orderedIds: string[]
): Promise<Parse.Object[]> {
  if (new Set(orderedIds).size !== orderedIds.length) {
    throw createError({ statusCode: 400, statusMessage: 'orderedIds has duplicates' });
  }
  const rows = await Promise.all(orderedIds.map((id) => getOwnedBoardOrThrow(user, id, { allowFolder: true })));
  for (const row of rows) {
    if ((row.get('parent')?.id || null) !== parentId) await moveBoard(user, row, parentId);
  }
  rows.forEach((row, index) => row.set('sortIndex', index));
  await Parse.Object.saveAll(rows, { useMasterKey: true });
  return rows;
}

export { Boards, BoardBookmarks, Websites };
