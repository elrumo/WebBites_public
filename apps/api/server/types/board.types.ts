/**
 * TypeScript types and interfaces for Bookmark Boards
 * Supports manual, smart (AI-driven), and mixed board types
 */

/** Board mode determines how bookmarks are added */
export type BoardMode = 'manual' | 'smart' | 'mixed';

/**
 * A `folder` only groups boards and other folders; it holds no bookmarks, can't
 * be shared, and is the only kind that may be a parent.
 */
export type BoardKind = 'board' | 'folder';

/** Visibility controls who can access a board */
export type BoardVisibility = 'private' | 'link' | 'email_list' | 'email_domain';

/** How a bookmark was added to a board */
export type BoardBookmarkSource = 'manual' | 'smart' | 'automation';

/** Smart rules configuration for AI-driven boards */
export interface SmartRules {
  /** Topics/themes this board matches against */
  topics: string[];
  /** Confidence threshold for AI matching (0-1) */
  confidenceThreshold?: number;
  /** Whether new bookmarks are auto-assigned when they match */
  autoApply: boolean;
  /** Whether to include existing bookmarks when applying rules */
  includeExisting?: boolean;
}

/** Visibility configuration for shared boards */
export interface VisibilityConfig {
  /** SHA-256 hash of the share token (never store raw) */
  tokenHash?: string;
  /** When the token was last rotated */
  tokenLastRotatedAt?: string;
  /** Bumped by every rotation; the link token is derived from it (boardUtils.deriveShareToken). */
  tokenVersion?: number;
  /** Email addresses allowed when visibility is 'email_list' */
  allowedEmails?: string[];
  /** Email domains allowed when visibility is 'email_domain' */
  allowedDomains?: string[];
}

/** Authenticated user context from validateParseToken */
export interface AuthUser {
  userId: string;
  username: string;
  email: string;
  sessionToken: string;
  user: any; // Parse.User
}

/** Board object as returned in API responses */
export interface BoardResponse {
  id: string;
  name: string;
  /** Absent on rows from before folders existed; treat as 'board'. */
  kind: BoardKind;
  description?: string | null;
  mode: BoardMode;
  smartRules?: SmartRules | null;
  color?: string | null;
  icon?: string | null;
  bookmarkCount: number;
  visibility: BoardVisibility;
  publicSlug?: string | null;
  isDeleted: boolean;
  /** Parent folder id, or null for a top-level board or folder. */
  parentId?: string | null;
  /**
   * Ancestor ids, root first, excluding the board itself. Maintained by the
   * API — clients never write it — so "this board and everything under it" is
   * one `containedIn` query.
   */
  path: string[];
  /** Manual ordering among siblings; lower sorts first. */
  sortIndex: number;
  /** When the board was archived, or null while it is active. */
  archivedAt?: string | null;
  /** The caller's role, when the route knows it. Absent means owner. */
  role?: 'owner' | 'editor' | 'viewer';
  /** Shared with people, or published by link (owner); always true for a board shared with you. */
  shared?: boolean;
  /** Who owns a board that was shared with the caller. */
  ownerName?: string;
  createdAt: string;
  updatedAt: string;
}

/** How deep collections may nest. A move past this is a 400. */
export const MAX_BOARD_DEPTH = 8;

/** A single board suggestion from AI */
export interface BoardSuggestion {
  bookmarkId: string;
  bookmarkTitle: string;
  suggestedBoardIds: string[];
  suggestedBoardNames: string[];
  confidence: number;
}

/** A suggested new board from AI */
export interface NewBoardSuggestion {
  name: string;
  description: string;
  topics: string[];
  matchingBookmarkIds: string[];
}

/** Response for board suggestions */
export interface SuggestBoardsResponse {
  success: boolean;
  assignments: BoardSuggestion[];
  newBoardSuggestions?: NewBoardSuggestion[];
  error?: string;
}
