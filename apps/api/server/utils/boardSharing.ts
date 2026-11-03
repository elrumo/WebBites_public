/**
 * Who a board is shared with: the `boardMembers` rows, invites, and the lookups
 * the routes need. Parse-aware but knows nothing of h3 or `boardUtils.ts`
 * (which imports this), so `Parse` objects come in and go out.
 *
 * Every read and write is master-key; whether the caller may see a row is
 * decided by the route, from `boardAccessRules.ts`.
 *
 * A row is `active` once it has a `user`. Inviting an address that already
 * belongs to an account activates it straight away. Any other address gets a
 * `pending` row holding the SHA-256 of an emailed token, and only that link
 * activates it: sign-up here does not verify addresses, so owning the same
 * address on an account proves nothing.
 */

import Parse from 'parse/node.js';
import { createError } from 'h3';
import {
  INVITE_TTL_MS, MAX_MEMBERS_PER_BOARD, memberKey,
  type Invite, type MemberRole, type MemberStatus,
} from './boardAccessRules';
import { generateToken, hashToken, isWellFormedToken } from './emailChangeRules';

export const BoardMembers = Parse.Object.extend('boardMembers');

const boardPointer = (boardId: string) => ({ __type: 'Pointer', className: 'boards', objectId: boardId }) as const;
const userPointer = (userId: string) => ({ __type: 'Pointer', className: '_User', objectId: userId }) as const;

/**
 * What other people see of an account: its name, else the part of the address
 * before the `@`. Never the full address — email sign-ups have it as username.
 */
export function displayName(user: Parse.User | Parse.Object | undefined | null): string {
  if (!user) return 'Someone';
  const name = String(user.get('name') ?? '').trim();
  if (name) return name;
  const handle = String(user.get('username') ?? user.get('email') ?? '').split('@')[0].trim();
  return handle || 'Someone';
}

/** Names for a set of user ids, by one query. Unknown ids are left out. */
export async function displayNames(userIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  const users = await new Parse.Query(Parse.User)
    .containedIn('objectId', ids)
    .select('name', 'username')
    .limit(ids.length)
    .find({ useMasterKey: true });
  for (const user of users) names.set(user.id, displayName(user));
  return names;
}

/**
 * The account answering to `email`, as its email or its username (many email
 * sign-ups have both). Legacy accounts stored with capitals won't match the
 * lower-cased address, so those fall through to the pending path.
 */
export async function findUserByEmail(email: string): Promise<Parse.User | undefined> {
  const byEmail = new Parse.Query(Parse.User).equalTo('email', email);
  const byUsername = new Parse.Query(Parse.User).equalTo('username', email);
  return (await Parse.Query.or(byEmail, byUsername).first({ useMasterKey: true })) as Parse.User | undefined;
}

// ─── Reading ─────────────────────────────────────────────────────────────────

/** The active membership of `userId` in the board, if any. */
export async function getActiveMembership(boardId: string, userId: string): Promise<Parse.Object | undefined> {
  return (await new Parse.Query(BoardMembers)
    .equalTo('board', boardPointer(boardId))
    .equalTo('user', userPointer(userId))
    .equalTo('status', 'active')
    .first({ useMasterKey: true })) || undefined;
}

/** Everyone the board is shared with, pending invites included, oldest first. */
export async function listMembers(boardId: string): Promise<Parse.Object[]> {
  return await new Parse.Query(BoardMembers)
    .equalTo('board', boardPointer(boardId))
    .ascending('createdAt')
    .limit(MAX_MEMBERS_PER_BOARD + 10)
    .find({ useMasterKey: true });
}

/** One member row of the board, or a 404. */
export async function getMemberOrThrow(board: Parse.Object, memberId: string): Promise<Parse.Object> {
  try {
    return await new Parse.Query(BoardMembers).equalTo('board', board).get(memberId, { useMasterKey: true });
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Member not found' });
  }
}

/** User ids of everyone who can currently open the board besides its owner. */
export async function activeMemberIds(boardId: string): Promise<string[]> {
  const rows = await new Parse.Query(BoardMembers)
    .equalTo('board', boardPointer(boardId))
    .equalTo('status', 'active')
    .select('user')
    .limit(MAX_MEMBERS_PER_BOARD + 10)
    .find({ useMasterKey: true });
  return rows.map((row) => row.get('user')?.id).filter(Boolean) as string[];
}

/** Ids among `boardIds` that have at least one member (pending or active). */
export async function boardsWithMembers(boardIds: string[]): Promise<Set<string>> {
  if (boardIds.length === 0) return new Set();
  const rows = await new Parse.Query(BoardMembers)
    .containedIn('board', boardIds.map(boardPointer))
    .select('board')
    .limit(1000)
    .find({ useMasterKey: true });
  return new Set(rows.map((row) => row.get('board')?.id).filter(Boolean));
}

/** The boards `userId` was given access to, with the role each carries. */
export async function sharedBoardsFor(userId: string): Promise<Array<{ board: Parse.Object; role: MemberRole }>> {
  const rows = await new Parse.Query(BoardMembers)
    .equalTo('user', userPointer(userId))
    .equalTo('status', 'active')
    .include('board')
    .limit(500)
    .find({ useMasterKey: true });
  return rows
    .filter((row) => row.get('board') && !row.get('board').get('isDeleted'))
    .map((row) => ({ board: row.get('board') as Parse.Object, role: row.get('role') as MemberRole }));
}

/** Pending invites `inviterId` has sent in the last day — the emails they cost us. */
export async function recentInviteEmails(inviterId: string): Promise<number> {
  return await new Parse.Query(BoardMembers)
    .equalTo('invitedBy', userPointer(inviterId))
    .equalTo('status', 'pending')
    .greaterThan('updatedAt', new Date(Date.now() - 24 * 60 * 60 * 1000))
    .count({ useMasterKey: true });
}

/** A `boardMembers` row as the sharing dialog shows it. Emails are the owner's to see. */
export function serializeMember(row: Parse.Object, names: Map<string, string>, includeEmail: boolean) {
  const userId = row.get('user')?.id as string | undefined;
  const email = String(row.get('email') ?? '');
  const pending = row.get('status') !== 'active';
  return {
    id: row.id,
    name: (userId && names.get(userId)) || (includeEmail ? email.split('@')[0] : 'Pending invite'),
    ...(includeEmail ? { email } : {}),
    role: row.get('role') as MemberRole,
    status: row.get('status') as MemberStatus,
    userId: pending ? null : userId ?? null,
  };
}

// ─── Writing ─────────────────────────────────────────────────────────────────

export interface InviteOutcome {
  member: Parse.Object;
  /** The raw emailed token, only for a pending row that was just (re)issued. */
  token: string | null;
  /** The account that was activated straight away, if the address had one. */
  user: Parse.User | null;
  /** First time this address is on the board. */
  isNew: boolean;
  /** The row is new or its role changed — worth telling the invitee about. */
  changed: boolean;
}

/**
 * Share `board` with one address. Re-inviting an existing member only changes
 * their role; re-inviting a pending address issues a fresh link.
 */
export async function inviteMember(
  board: Parse.Object,
  inviter: Parse.User,
  { email, role }: Invite,
): Promise<InviteOutcome> {
  const key = memberKey(board.id, email);
  const existing = await new Parse.Query(BoardMembers).equalTo('membershipKey', key).first({ useMasterKey: true });
  const account = (await findUserByEmail(email)) ?? null;

  // The owner's own account is skipped by `parseInvites` by email; this covers
  // a second address that resolves to the same account.
  if (account && account.id === board.get('owner')?.id) {
    throw createError({ statusCode: 400, statusMessage: 'You already own this board' });
  }

  const row = existing ?? new BoardMembers();
  const changed = !existing || row.get('role') !== role;
  if (!existing) {
    row.set('board', board);
    row.set('email', email);
    row.set('membershipKey', key);
    row.set('invitedBy', inviter);
  }
  row.set('role', role);

  let token: string | null = null;
  if (account) {
    row.set('user', account);
    row.set('status', 'active' satisfies MemberStatus);
    row.unset('tokenHash');
    row.unset('expiresAt');
  } else if (row.get('status') !== 'active') {
    // Unknown address (or a pending one): a fresh single-use link each time.
    const issued = generateToken();
    token = issued.token;
    row.set('status', 'pending' satisfies MemberStatus);
    row.set('tokenHash', issued.tokenHash);
    row.set('expiresAt', new Date(Date.now() + INVITE_TTL_MS));
  }
  await row.save(null, { useMasterKey: true });
  return { member: row, token, user: account, isNew: !existing, changed: changed || token !== null };
}

/**
 * Turn the emailed link into access for `user`. The link — not the address on
 * the account — is the proof, so it works for whoever holds it, once.
 */
export async function acceptInvite(
  user: Parse.User,
  rawToken: unknown,
): Promise<{ member: Parse.Object; board: Parse.Object; role: MemberRole }> {
  if (!isWellFormedToken(rawToken)) {
    throw createError({ statusCode: 400, statusMessage: 'This invite link is not valid' });
  }
  const row = await new Parse.Query(BoardMembers)
    .equalTo('tokenHash', hashToken(rawToken))
    .equalTo('status', 'pending')
    .include('board')
    .first({ useMasterKey: true });
  const board = row?.get('board');
  const expiresAt = row?.get('expiresAt') as Date | undefined;
  if (!row || !board || board.get('isDeleted') || (expiresAt && expiresAt.getTime() < Date.now())) {
    throw createError({ statusCode: 410, statusMessage: 'This invite link has expired or was already used' });
  }
  if (board.get('owner')?.id === user.id) {
    throw createError({ statusCode: 400, statusMessage: 'You already own this board' });
  }

  // One account, one row per board: fold into an existing membership if the
  // invitee was already added another way.
  const already = await getActiveMembership(board.id, user.id);
  if (already && already.id !== row.id) {
    await row.destroy({ useMasterKey: true });
    return { member: already, board, role: already.get('role') as MemberRole };
  }
  row.set('user', user);
  row.set('status', 'active' satisfies MemberStatus);
  row.unset('tokenHash');
  row.unset('expiresAt');
  await row.save(null, { useMasterKey: true });
  return { member: row, board, role: row.get('role') as MemberRole };
}
