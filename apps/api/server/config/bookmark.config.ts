/**
 * Configuration for bookmark operations
 * Centralizes all magic numbers and configuration values
 */

export const BookmarkConfig = {
  // Batch processing
  BATCH_SIZE: 50,
  MAX_PARALLEL_REQUESTS: 10,

  // File size limits (in KB)
  MAX_IMAGE_SIZE_KB: 500,
  MAX_HTML_SIZE_KB: 1000,

  // String length limits
  MAX_METADATA_FIELD_LENGTH: 1200,
  MAX_METADATA_VALUE_LENGTH: 800,
  MAX_METADATA_TRUNCATE_LENGTH: 600,
  MAX_PUBLISHER_LENGTH: 500,
  MAX_SITE_BODY_LENGTH: 1000,

  // Base64 detection
  MIN_BASE64_LENGTH: 256,

  // Timeouts (in milliseconds)
  TIMEOUTS: {
    DEFAULT_FETCH: 45000,
    HTML_CONTENT_FETCH: 4000,
    DNS_LOOKUP: 3000,
  },

  // Caching
  CACHE_ENABLED: true,
  CACHE_LOOKUP_ENABLED: true,

  // Image extensions
  IMAGE_EXTENSIONS: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg'] as const,

  // Credits
  CREDITS: {
    MOVIE_CAST_LIMIT: 10,
    MOVIE_CREW_LIMIT: 10,
    MOVIE_IMAGES_LIMIT: 10,
  },

  // Queue names
  QUEUES: {
    IMAGE_PROCESSING: 'imageProcessing',
    FILE_PROCESSING: 'fileProcessing',
    PAGE_CONTENT: 'getPageContent',
    BOOKMARK_CONTENT: 'getBookmarkContent',
    BOOKMARK_QUEUE_MANAGEMENT: 'bookmark-queue-management',
  },
} as const;

export type BookmarkConfigType = typeof BookmarkConfig;
