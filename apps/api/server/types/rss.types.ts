/**
 * Wire types for the RSS reader.
 *
 * These are the shapes the native app and the web app decode. Both clients
 * treat `/v1/rss/*` as the only source of feed data — there is no Parse-direct
 * read path — so a change here is a change to both clients' models.
 */

/** A feed that failed too many polls stops being scheduled. */
export type RssFeedStatus = 'active' | 'dead';

/** Where an item's full-text extraction got to. */
export type RssExtractionStatus = 'none' | 'pending' | 'done' | 'failed';

/** Which class the audio token's MP3 should be written back to. */
export type AudioTargetType = 'website' | 'rssItem';

/** Shared feed metadata, flattened into the subscription DTO. */
export interface RssFeedResponse {
  id: string;
  feedUrl: string;
  siteUrl: string | null;
  title: string;
  description: string | null;
  iconUrl: string | null;
  language: string | null;
  status: RssFeedStatus;
  lastFetchedAt: string | null;
  lastItemAt: string | null;
}

/** A user's subscription, with the shared feed metadata folded in. */
export interface RssSubscriptionResponse {
  id: string;
  feed: RssFeedResponse;
  /** The user's own name for the feed; falls back to the feed title. */
  title: string;
  customTitle: string | null;
  extractionEnabled: boolean;
  sortOrder: number;
  unreadCount: number;
  subscribedAt: string | null;
  lastMarkAllReadAt: string | null;
}

/** List row — deliberately carries no article body. */
export interface RssItemListResponse {
  id: string;
  feedId: string;
  feedTitle: string;
  feedIconUrl: string | null;
  title: string;
  link: string | null;
  author: string | null;
  publishedAt: string | null;
  imageUrl: string | null;
  /** First couple of lines of the body, for the list row's second line. */
  excerpt: string;
  isRead: boolean;
  /** On the user's "Read later" shelf. */
  isReadLater: boolean;
  hasExtracted: boolean;
  hasSummary: boolean;
  hasAudio: boolean;
}

/** Everything a reader pane needs, fetched when an article opens. */
export interface RssItemDetailResponse extends RssItemListResponse {
  /** The body the feed shipped, sanitised. May be empty for title-only feeds. */
  rssContentHtml: string;
  rssContentText: string;
  /** Set once the feed's full-text extraction has run for this item. */
  extractedFileUrl: string | null;
  extractedText: string | null;
  extractionStatus: RssExtractionStatus;
  aiSummary: AiSummary | null;
  articleAudioUrl: string | null;
}

/** Same shape as `websites.aiSummary`, so both clients reuse their model. */
export interface AiSummary {
  tldr?: string;
  pointsThatBestDescribeThePage?: Array<{
    title: string;
    oneLineDescription: string;
    emojiThatBestRepresentsThePoint: string;
  }>;
}

/** A candidate returned by feed discovery, before the user commits to it. */
export interface RssDiscoveryCandidate {
  feedUrl: string;
  title: string;
  siteUrl: string | null;
  description: string | null;
  iconUrl: string | null;
  /** How this candidate was found — clients group results by it. */
  source: 'autodiscovery' | 'direct' | 'catalogue' | 'guess';
  alreadySubscribed: boolean;
  /** Present for catalogue hits: how many WebBites users read this feed. */
  subscriberCount?: number;
}

export interface RssItemsPage {
  items: RssItemListResponse[];
  /** Opaque cursor for the next page; null when the list is exhausted. */
  nextCursor: string | null;
}

export interface OpmlImportResult {
  subscribed: RssSubscriptionResponse[];
  /** Feeds handed to QStash because the file was larger than the inline cap. */
  queued: number;
  failed: Array<{ xmlUrl: string; reason: string }>;
}
