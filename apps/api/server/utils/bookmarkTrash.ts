/**
 * Pure helpers for the bookmark trash (soft delete + 30-day purge).
 *
 * The quota counter is the part worth keeping honest: a bookmark that never
 * incremented the counter must not decrement it, and a bookmark must not
 * decrement it twice (once on soft delete, once when the purge finally
 * destroys the row and the cloud afterDelete trigger fires).
 */

export const TRASH_RETENTION_DAYS = 30;

/**
 * Rows whose deletion should decrement the owner's bookmark counter, tallied
 * per user. `bookmarkCounted === false` means the increment never landed (or
 * already came back off), so those rows are skipped.
 *
 * Call this *before* setting `bookmarkCounted = false` on the rows.
 */
export function countedByUser(objects: { get(key: string): any }[]): Map<string, number> {
  const perUser = new Map<string, number>();
  for (const object of objects) {
    if (object.get('bookmarkCounted') === false) continue;
    const userId = object.get('user')?.id;
    if (!userId) continue;
    perUser.set(userId, (perUser.get(userId) || 0) + 1);
  }
  return perUser;
}

/** Rows soft-deleted before this instant are safe to hard-delete. */
export function purgeCutoff(now: Date = new Date(), days: number = TRASH_RETENTION_DAYS): string {
  return new Date(now.getTime() - days * 86400000).toISOString();
}

/** Whole days until a row soft-deleted at `deletedAt` gets purged. */
export function daysUntilPurge(deletedAt: string, now: Date = new Date()): number {
  const purgesAt = new Date(deletedAt).getTime() + TRASH_RETENTION_DAYS * 86400000;
  return Math.max(0, Math.ceil((purgesAt - now.getTime()) / 86400000));
}
