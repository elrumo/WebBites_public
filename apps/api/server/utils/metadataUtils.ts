/**
 * Metadata utilities for bookmark operations
 * Handles metadata sanitization, validation, and processing
 */

import { BookmarkConfig } from '../config/bookmark.config';
import type { MetadataResult, SanitizedMetadata } from '../types/bookmark.types';

/**
 * Sanitize metadata by removing base64 data and trimming long strings
 * This prevents storing large blobs and keeps metadata lean
 */
export function sanitizeMetadata(metadata: MetadataResult | null | undefined): SanitizedMetadata {
  if (!metadata) return {};

  const sanitized: SanitizedMetadata = {};

  for (const key in metadata) {
    const val = metadata[key];

    // Skip non-string values
    if (typeof val !== 'string') {
      sanitized[key] = val;
      continue;
    }

    const trimmed = val.trim();

    // Remove data URL base64 payloads entirely
    if (/^data:[^;]+;base64,/.test(trimmed)) {
      continue; // Skip this field
    }

    // Heuristic: remove likely raw base64 blobs
    // (long strings, base64 charset, length divisible by 4)
    if (
      trimmed.length > BookmarkConfig.MIN_BASE64_LENGTH &&
      trimmed.length % 4 === 0 &&
      /^[A-Za-z0-9+/=]+$/.test(trimmed)
    ) {
      continue; // Skip this field
    }

    // Enforce max length
    if (trimmed.length > BookmarkConfig.MAX_METADATA_VALUE_LENGTH) {
      sanitized[key] = trimmed.substring(0, BookmarkConfig.MAX_METADATA_TRUNCATE_LENGTH);
    } else {
      sanitized[key] = trimmed;
    }
  }

  return sanitized;
}

/**
 * Truncate metadata fields to specified max length
 */
export function truncateMetadataFields(
  metadata: MetadataResult,
  maxLength: number = BookmarkConfig.MAX_METADATA_FIELD_LENGTH
): MetadataResult {
  const truncated: MetadataResult = {};

  for (const key in metadata) {
    const value = metadata[key];
    if (typeof value === 'string' && value.length > maxLength) {
      truncated[key] = value.substring(0, maxLength);
    } else {
      truncated[key] = value;
    }
  }

  return truncated;
}

/**
 * Extract site author from metadata or URL
 */
export function extractSiteAuthor(
  metadata: MetadataResult | null | undefined,
  url: string,
  subType: string[]
): string | undefined {
  try {
    // For tweets, extract username from URL
    if (subType.includes('tweet')) {
      return url.split('/')[3];
    }

    // Use metadata author if available
    if (metadata?.author) {
      return metadata.author;
    }

    return undefined;
  } catch (error) {
    console.error('Error extracting site author:', error);
    return undefined;
  }
}

/**
 * Check if metadata has minimum required fields
 */
export function hasValidMetadata(metadata: MetadataResult | null | undefined): boolean {
  if (!metadata) return false;

  // At least one of these should be present
  return Boolean(
    metadata.title ||
    metadata.description ||
    metadata.image ||
    metadata.author
  );
}

/**
 * Merge metadata from multiple sources, preferring non-empty values
 */
export function mergeMetadata(...metadataSources: (MetadataResult | null | undefined)[]): MetadataResult {
  const merged: MetadataResult = {};

  for (const source of metadataSources) {
    if (!source) continue;

    for (const key in source) {
      // Only set if not already set or if current value is empty
      if (!merged[key] || (typeof source[key] === 'string' && source[key]?.length > 0)) {
        merged[key] = source[key];
      }
    }
  }

  return merged;
}

/**
 * Extract OG image URL, handling base64 and regular URLs differently
 */
export function extractOGImageInfo(imageUrl: string | undefined): {
  isBase64: boolean;
  url: string | undefined;
  base64Data?: string;
  fileExtension?: string;
} {
  if (!imageUrl) {
    return { isBase64: false, url: undefined };
  }

  // Check if it's a base64 data URL
  if (imageUrl.startsWith('data:image/')) {
    const base64Data = imageUrl.replace(/^data:image\/\w+;base64,/, '');
    const fileExtension = imageUrl.split(';')[0].split('/')[1].split('+')[0];

    return {
      isBase64: true,
      url: imageUrl,
      base64Data,
      fileExtension,
    };
  }

  // It's a regular URL
  return {
    isBase64: false,
    url: imageUrl,
  };
}

/**
 * Calculate approximate size of base64 data in KB
 */
export function getBase64SizeKB(base64Data: string): number {
  return (base64Data.length * 3 / 4) / 1024;
}

/**
 * Check if an image should be processed in background based on size
 */
export function shouldQueueImageProcessing(base64Data: string): boolean {
  const sizeKB = getBase64SizeKB(base64Data);
  return sizeKB > BookmarkConfig.MAX_IMAGE_SIZE_KB;
}

/**
 * Calculate approximate size of HTML content in KB
 */
export function getHtmlSizeKB(htmlContent: string): number {
  // UTF-8 encoding approximation (2 bytes per character)
  return (htmlContent.length * 2) / 1024;
}

/**
 * Check if HTML should be processed in background based on size
 */
export function shouldQueueHtmlProcessing(htmlContent: string): boolean {
  const sizeKB = getHtmlSizeKB(htmlContent);
  return sizeKB > BookmarkConfig.MAX_HTML_SIZE_KB;
}
