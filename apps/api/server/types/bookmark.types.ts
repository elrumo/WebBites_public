/**
 * TypeScript types and interfaces for bookmark operations
 * Provides type safety throughout the bookmark system
 */

import type Parse from 'parse/node.js';

export interface SaveBookmarkBody {
  userId: string;
  url: string;
  savedFrom?: string;
  type?: string;
  customId?: string | null;
  geoLocation?: any | null;
  fromCache?: boolean;
  siteNotes?: string | null;
  textNote?: string | null;
  mediaBookmark?: any | null;
  importing?: boolean;
  /**
   * Post content read out of the live page by the browser extension's content
   * script. Only the browser surfaces can produce this — the share sheet gets a
   * bare URL from the host app, with no DOM and no session. Untrusted: it is
   * assembled by JavaScript in a page we do not control, so it must go through
   * `sanitizeClientMetadata` before anything reads it.
   */
  clientMetadata?: unknown;
  /**
   * Internal: this URL has already been through PDF detection and is not one.
   *
   * Set only when the PDF pipeline handed a link back — a `.pdf` URL that
   * turned out to serve a login page. Without it the re-save would detect the
   * same URL, download it a second time and hand it back again.
   */
  pdfChecked?: boolean;
}

export interface MetadataResult {
  title?: string;
  description?: string;
  image?: string;
  author?: string;
  date?: string;
  logo?: string;
  publisher?: string;
  url?: string;
  [key: string]: any; // Allow additional metadata fields
}

export interface CachedWebsite {
  siteTitle?: string;
  siteDescription?: string;
  siteAuthor?: string;
  siteDate?: string;
  siteLogo?: string;
  sitePublisher?: string;
  siteHtml?: string;
  siteHtmlFile?: Parse.File;
  siteHtmlUrl?: string;
  siteBody?: string;
  siteBodyFile?: Parse.File;
  siteBodyFileUrl?: string;
  baseUrl?: string;
  OGImage?: string;
  OGImageFile?: Parse.File;
  aiSummary?: string;
  language?: string;
  siteColors?: any;
  embedCode?: string;
  fullPageScreenshot?: string;
  siteScreenshot?: string;
  containsAdultContent?: boolean;
  metaData?: MetadataResult;
  articleAudio?: string;
}

export interface PageType {
  type: string;
  subType: string[];
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  bookmark: Parse.Object | null;
}

export interface BatchProcessingResult {
  status: 'ok' | 'error';
  savedCount?: number;
  queuedCount?: number;
  savedSiteIds?: string[];
  skipped?: Array<{
    userId: string;
    index: number;
    reason: string;
  }>;
  errors?: Array<{
    index: number;
    url: string;
    error: string;
  }>;
  error?: string;
}

export interface SaveBookmarkResult {
  status: 'ok' | 'error';
  savedSite?: Parse.Object;
  error?: string;
  alert?: {
    message: string;
    description: string;
    onClickFunction?: () => void;
  };
}

export interface MovieDetails {
  id: number;
  title: string;
  poster_path?: string;
  backdrop_path?: string;
  credits?: any;
  movieImages?: any;
  movieKeywords?: any;
  videos?: any;
  [key: string]: any;
}

export interface GameDetails {
  id: number;
  name: string;
  slug: string;
  keywords?: Array<{ name: string }>;
  cover?: { url: string };
  message?: string;
  [key: string]: any;
}

export interface CacheHydrationResult {
  success: boolean;
  hasTitle: boolean;
  hasOG: boolean;
  hasDescription: boolean;
  metadata?: MetadataResult;
}

export interface QstashRequest {
  type: string;
  subType?: string;
  data: Record<string, any>;
}

export interface QstashBatchItem {
  body: QstashRequest;
}

export interface QstashOptions {
  isBatch?: boolean;
  queueName: string;
}

export interface WebsiteDescriptionParams {
  url: string;
  user: Parse.Object;
  savedFrom: string;
  customId: string | null;
  siteNotes: string | null;
  textNote: string | null;
  fromCache?: boolean;
}

export interface SanitizedMetadata {
  [key: string]: string | undefined;
}

export interface ImageProcessingRequest {
  websiteId: string;
  imageData: string;
  fileExtension: string;
  fileName: string;
}

export interface HtmlProcessingRequest {
  websiteId: string;
  htmlContent: string;
  fileName: string;
}

export interface LogContext {
  userId?: string;
  url?: string;
  bookmarkId?: string;
  operation?: string;
  duration?: number;
  fromCache?: boolean;
  batchSize?: number;
  [key: string]: any;
}

export interface FailedImport {
  url: string;
  websiteId: string;
  error: any;
  funcName: string;
  date: string;
}

export interface UsageUpdateRequest {
  type: 'update-usage';
  data: {
    typeOfUsage: string;
    userId: string;
    subOrAdd: 'add' | 'sub';
    number: number;
    shouldRefreshCount: boolean;
  };
}

export interface BatchProcessingMetrics {
  totalProcessed: number;
  successful: number;
  failed: number;
  skipped: number;
  duration: number;
  averageTimePerBookmark: number;
}
