/**
 * The bell's history: a `boardNotifications` row for each thing that happened
 * on a board the recipient can open. Written here with the master key as the
 * action happens, read through `GET /v1/me/notifications`.
 *
 * Notifying is best-effort — it never fails the request that caused it.
 *
 * Item events coalesce: ten bookmarks added one by one are one row reading
 * "added 10", not ten. A row absorbs further events from the same person on
 * the same board for `COALESCE_MS`, as long as the recipient has not read it.
 */

import Parse from 'parse/node.js';
import { activeMemberIds, displayNames } from './boardSharing';

export const BoardNotifications = Parse.Object.extend('boardNotifications');

export type NotificationType =
  | 'board_shared' | 'role_changed' | 'board_unshared'
  | 'item_added' | 'item_edited' | 'item_removed'
  | 'member_joined' | 'member_left';

const COALESCED: NotificationType[] = ['item_added', 'item_edited', 'item_removed'];
const COALESCE_MS = 15 * 60 * 1000;
const MAX_TITLES = 3;

const userPointer = (userId: string) => ({ __type: 'Pointer', className: '_User', objectId: userId }) as const;

export interface NotifyOptions {
  /** Bookmarks involved, for item events. */
  count?: number;
  /** Websites to name (first few), for item events. */
  websiteIds?: string[];
  /** Instead of the owner and every active member — e.g. just the invitee. */
  recipients?: string[];
}

async function titlesFor(websiteIds: string[] = []): Promise<string[]> {
  const ids = websiteIds.slice(0, MAX_TITLES);
  if (ids.length === 0) return [];
  const rows = await new Parse.Query('websites')
    .containedIn('objectId', ids)
    .select('siteTitle', 'url')
    .limit(ids.length)
    .find({ useMasterKey: true });
  return rows.map((row) => String(row.get('siteTitle') || row.get('url') || '').trim()).filter(Boolean);
}

/**
 * Tell the people on `board` (but not the actor) that something happened.
 * `board` is a fetched `boards` row; `actorId` the user who did it.
 */
export async function notifyBoardAudience(
  board: Parse.Object,
  actorId: string,
  type: NotificationType,
  options: NotifyOptions = {},
): Promise<void> {
  try {
    const ownerId = board.get('owner')?.id as string | undefined;
    const audience = options.recipients ?? [ownerId, ...(await activeMemberIds(board.id))];
    const recipients = [...new Set(audience.filter((id): id is string => !!id && id !== actorId))];
    if (recipients.length === 0) return;

    const [actorNames, titles] = await Promise.all([displayNames([actorId]), titlesFor(options.websiteIds)]);
    const actorName = actorNames.get(actorId) ?? 'Someone';
    const count = options.count ?? 1;

    // Fold into unread rows of the same kind from the same person.
    const open = new Map<string, Parse.Object>();
    if (COALESCED.includes(type)) {
      const rows = await new Parse.Query(BoardNotifications)
        .containedIn('recipient', recipients.map(userPointer))
        .equalTo('board', board)
        .equalTo('actor', userPointer(actorId))
        .equalTo('type', type)
        .doesNotExist('readAt')
        .greaterThan('createdAt', new Date(Date.now() - COALESCE_MS))
        .limit(recipients.length)
        .find({ useMasterKey: true });
      for (const row of rows) open.set(row.get('recipient').id, row);
    }

    const writes = recipients.map((recipientId) => {
      const row = open.get(recipientId) ?? new BoardNotifications();
      if (!open.has(recipientId)) {
        row.set('recipient', userPointer(recipientId));
        row.set('actor', userPointer(actorId));
        row.set('board', board);
        row.set('type', type);
      }
      // The latest name wins: a board renamed since the first event reads right.
      row.set('boardName', String(board.get('name') ?? ''));
      row.set('actorName', actorName);
      row.set('count', (open.has(recipientId) ? row.get('count') ?? 0 : 0) + count);
      row.set('titles', [...new Set([...(open.has(recipientId) ? row.get('titles') ?? [] : []), ...titles])].slice(0, MAX_TITLES));
      // Bumped so a coalesced row sorts by its latest event.
      row.set('lastEventAt', new Date());
      return row;
    });
    await Parse.Object.saveAll(writes, { useMasterKey: true });
  } catch (error) {
    console.error('[boardNotifications] could not notify:', error);
  }
}

/** A row as the API returns it. */
export function serializeNotification(row: Parse.Object) {
  const readAt = row.get('readAt') as Date | undefined;
  return {
    id: row.id,
    type: row.get('type') as NotificationType,
    boardId: row.get('board')?.id ?? null,
    boardName: row.get('boardName') ?? '',
    actorName: row.get('actorName') ?? 'Someone',
    count: row.get('count') ?? 1,
    titles: (row.get('titles') as string[]) ?? [],
    readAt: readAt ? readAt.toISOString() : null,
    createdAt: (row.get('lastEventAt') as Date | undefined)?.toISOString?.() ?? row.createdAt?.toISOString?.() ?? null,
  };
}

const mine = (userId: string) => new Parse.Query(BoardNotifications).equalTo('recipient', userPointer(userId));

/** Newest first, with the unread and overall counts the bell needs. */
export async function listNotifications(userId: string, limit: number, skip: number) {
  const [rows, total, unreadCount] = await Promise.all([
    mine(userId).descending('lastEventAt').limit(limit).skip(skip).find({ useMasterKey: true }),
    mine(userId).count({ useMasterKey: true }),
    mine(userId).doesNotExist('readAt').count({ useMasterKey: true }),
  ]);
  return { notifications: rows.map(serializeNotification), total, unreadCount };
}

/** Mark `ids` (or everything) read; returns what is still unread. */
export async function markNotificationsRead(userId: string, ids: string[] | 'all'): Promise<number> {
  const query = mine(userId).doesNotExist('readAt');
  if (ids !== 'all') query.containedIn('objectId', ids.slice(0, 200));
  const rows = await query.limit(1000).find({ useMasterKey: true });
  const now = new Date();
  for (const row of rows) row.set('readAt', now);
  if (rows.length > 0) await Parse.Object.saveAll(rows, { useMasterKey: true });
  return await mine(userId).doesNotExist('readAt').count({ useMasterKey: true });
}

/** Read notifications older than `days` go; unread ones stay until seen. */
export async function purgeReadNotifications(days = 90): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  let removed = 0;
  for (;;) {
    const rows = await new Parse.Query(BoardNotifications)
      .exists('readAt')
      .lessThan('readAt', cutoff)
      .limit(500)
      .find({ useMasterKey: true });
    if (rows.length === 0) return removed;
    await Parse.Object.destroyAll(rows, { useMasterKey: true });
    removed += rows.length;
  }
}
