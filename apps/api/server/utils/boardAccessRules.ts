/**
 * Who may do what on a shared board, kept free of Parse and h3 so it can be
 * tested on its own. The routes that use it are `server/routes/v1/boards/**`,
 * the Parse side is in `boardUtils.ts`.
 *
 * Three roles. The owner is whoever `boards.owner` points at; `editor` and
 * `viewer` come from a `boardMembers` row. A viewer reads, an editor also
 * adds their own bookmarks and takes back their own additions, and only the
 * owner changes the board itself, who has access, or removes anybody else's
 * bookmark.
 */

import { isValidEmail, normalizeEmail } from './emailChangeRules';

export type BoardRole = 'owner' | 'editor' | 'viewer';
export type MemberRole = Exclude<BoardRole, 'owner'>;
export type MemberStatus = 'pending' | 'active';

const RANK: Record<BoardRole, number> = { viewer: 1, editor: 2, owner: 3 };

/** Invites one request may carry. */
export const MAX_INVITES_PER_REQUEST = 20;
/** Everyone a board can be shared with, pending included. */
export const MAX_MEMBERS_PER_BOARD = 50;
/** How long an emailed invite link works for. */
export const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function isMemberRole(value: unknown): value is MemberRole {
    return value === 'viewer' || value === 'editor';
}

/** `role` is at least `min`. */
export const hasRole = (role: BoardRole | null | undefined, min: BoardRole): boolean =>
    !!role && RANK[role] >= RANK[min];

export const canRead = (role: BoardRole | null | undefined) => hasRole(role, 'viewer');
export const canAddBookmarks = (role: BoardRole | null | undefined) => hasRole(role, 'editor');
export const canManageBoard = (role: BoardRole | null | undefined) => role === 'owner';

/** The owner removes anything; an editor only what they added themselves. */
export function canRemoveBookmark(role: BoardRole | null | undefined, addedByActor: boolean): boolean {
    if (role === 'owner') return true;
    return role === 'editor' && addedByActor;
}

/** `membershipKey` of a `boardMembers` row: one row per board and address. */
export const memberKey = (boardId: string, email: string): string => `${boardId}:${email}`;

export interface Invite {
    email: string;
    role: MemberRole;
}

/**
 * Cleans a client `invites` payload: lower-cased addresses, duplicates folded
 * (the later role wins), and the owner's own address left out. Throws a plain
 * `Error` with a message fit for a 400.
 */
export function parseInvites(raw: unknown, ownerEmail?: string): Invite[] {
    if (!Array.isArray(raw) || raw.length === 0) throw new Error('invites must be a non-empty array');
    if (raw.length > MAX_INVITES_PER_REQUEST) {
        throw new Error(`At most ${MAX_INVITES_PER_REQUEST} people can be invited at once`);
    }
    const owner = normalizeEmail(ownerEmail);
    const byEmail = new Map<string, Invite>();
    for (const entry of raw) {
        const email = normalizeEmail((entry as any)?.email);
        const role = (entry as any)?.role ?? 'viewer';
        if (!isValidEmail(email)) throw new Error(`"${String((entry as any)?.email ?? '').slice(0, 80)}" is not a valid email address`);
        if (!isMemberRole(role)) throw new Error('role must be viewer or editor');
        if (email === owner) continue;
        byEmail.set(email, { email, role });
    }
    return [...byEmail.values()];
}

/**
 * Link sharing is the only public visibility the UI offers. The backend still
 * understands `email_list` / `email_domain` for boards shared before this, but
 * a new share is either private or a link.
 */
export const UI_VISIBILITIES = ['private', 'link'] as const;
export type UiVisibility = (typeof UI_VISIBILITIES)[number];
export const isUiVisibility = (value: unknown): value is UiVisibility =>
    value === 'private' || value === 'link';
