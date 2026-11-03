/**
 * Custom error types for bookmark operations
 * Provides better error handling and debugging
 */

export class BookmarkError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'BookmarkError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BookmarkLimitError extends BookmarkError {
  constructor(message: string = 'You have reached your bookmark limit') {
    super(message, 'BOOKMARK_LIMIT_EXCEEDED');
    this.name = 'BookmarkLimitError';
  }
}

export class InvalidUrlError extends BookmarkError {
  constructor(url: string, message?: string) {
    super(message || `Invalid URL: ${url}`, 'INVALID_URL');
    this.name = 'InvalidUrlError';
  }
}

export class DuplicateBookmarkError extends BookmarkError {
  constructor(url: string, public bookmarkId?: string) {
    super(`Bookmark already exists: ${url}`, 'DUPLICATE_BOOKMARK');
    this.name = 'DuplicateBookmarkError';
  }
}

export class MetadataFetchError extends BookmarkError {
  constructor(url: string, public reason?: string) {
    super(`Failed to fetch metadata for: ${url}${reason ? ` - ${reason}` : ''}`, 'METADATA_FETCH_FAILED');
    this.name = 'MetadataFetchError';
  }
}

export class CacheHydrationError extends BookmarkError {
  constructor(url: string, public reason?: string) {
    super(`Failed to hydrate from cache: ${url}${reason ? ` - ${reason}` : ''}`, 'CACHE_HYDRATION_FAILED');
    this.name = 'CacheHydrationError';
  }
}

export class SearchIndexError extends BookmarkError {
  constructor(bookmarkId: string, public reason?: string) {
    super(`Failed to save to search index: ${bookmarkId}${reason ? ` - ${reason}` : ''}`, 'SEARCH_INDEX_FAILED');
    this.name = 'SearchIndexError';
  }
}

export class MediaBookmarkError extends BookmarkError {
  constructor(mediaType: 'movie' | 'game', public mediaId?: string | number, reason?: string) {
    super(`Failed to save ${mediaType} bookmark${mediaId ? ` (ID: ${mediaId})` : ''}${reason ? ` - ${reason}` : ''}`, 'MEDIA_BOOKMARK_FAILED');
    this.name = 'MediaBookmarkError';
  }
}

export class ImageBookmarkError extends BookmarkError {
  constructor(url: string, public reason?: string) {
    super(`Failed to save image bookmark: ${url}${reason ? ` - ${reason}` : ''}`, 'IMAGE_BOOKMARK_FAILED');
    this.name = 'ImageBookmarkError';
  }
}

export class BatchProcessingError extends BookmarkError {
  constructor(
    message: string,
    public failedCount: number,
    public totalCount: number,
    public errors?: Array<{ index: number; url: string; error: string }>
  ) {
    super(message, 'BATCH_PROCESSING_ERROR');
    this.name = 'BatchProcessingError';
  }
}
