/**
 * Cache hydration utilities for bookmark operations
 * Extracts duplicate logic for rehydrating bookmarks from cache
 */

import Parse from 'parse/node.js';
import type { CachedWebsite, CacheHydrationResult, MetadataResult } from '../types/bookmark.types';
import { bookmarkLogger } from './bookmarkLogger';
import { sanitizeMetadata } from './metadataUtils';
import { CacheHydrationError } from '../errors/bookmark.errors';
import spotifyUrlInfo from 'spotify-url-info';
const { getPreview } = spotifyUrlInfo(fetch);

const Websites = Parse.Object.extend('websites');

interface HydrationOptions {
  url: string;
  subType: string[];
  existingWebsite: Parse.Object;
  targetWebsite: Parse.Object;
  setMetaDataFn: (website: Parse.Object, url: string, html?: string) => Promise<MetadataResult | undefined>;
}

/**
 * Hydrate a bookmark from cached data
 * This method is used by both single and batch bookmark operations
 */
export async function hydrateFromCache(options: HydrationOptions): Promise<CacheHydrationResult> {
  const { url, subType, existingWebsite, targetWebsite, setMetaDataFn } = options;

  try {
    const hasTitle = Boolean(existingWebsite.get('siteTitle'));
    const hasOG = Boolean(existingWebsite.get('OGImage') || existingWebsite.get('OGImageFile'));
    const hasDescription = Boolean(existingWebsite.get('siteDescription'));

    const OGImage = existingWebsite.get('OGImageFile')?.url() || existingWebsite.get('OGImage');

    // Copy all cached fields to target website
    const fieldsToCopy: (keyof CachedWebsite)[] = [
      'siteHtml',
      'siteHtmlFile',
      'siteHtmlUrl',
      'siteBody',
      'siteBodyFile',
      'siteBodyFileUrl',
      'baseUrl',
      'siteTitle',
      'siteDescription',
      'siteAuthor',
      'siteDate',
      'siteLogo',
      'sitePublisher',
      'aiSummary',
      'language',
      'siteColors',
      'embedCode',
      'fullPageScreenshot',
      'siteScreenshot',
      'containsAdultContent',
      'articleAudio',
      'OGImageFile',
    ];

    for (const field of fieldsToCopy) {
      const value = existingWebsite.get(field as string);

      if (value !== undefined && value !== null) {
        // Special handling for specific fields
        if (field === 'siteBody') {
          targetWebsite.set(field, value || '');
        } else if (field === 'sitePublisher' && typeof value === 'string') {
          targetWebsite.set(field, value.substring(0, 500));
        } else if (field === 'siteTitle') {
          targetWebsite.set(field, value || undefined);
        } else {
          targetWebsite.set(field, value);
        }
      }
    }

    // Set OG Image
    targetWebsite.set('OGImage', OGImage);
    targetWebsite.set('fromCache', true);

    // Fetch fresh metadata based on subtype
    let metadata: MetadataResult | undefined;

    if (subType.includes('spotify')) {
      try {
        const spMeta = await getPreview(url);
        metadata = spMeta;
        targetWebsite.set('metaData', spMeta);
        if (!hasTitle && spMeta?.title) targetWebsite.set('siteTitle', spMeta.title);
        if (!hasOG && spMeta?.image) targetWebsite.set('OGImage', spMeta.image);
      } catch (error) {
        bookmarkLogger.warn('cache.hydration.spotify.failed', 'Failed to fetch Spotify metadata from cache', {
          url,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      try {
        const metaData = await setMetaDataFn(existingWebsite, url);
        if (metaData && !('error' in metaData)) {
          metadata = sanitizeMetadata(metaData);
          targetWebsite.set('metaData', metadata);
          if (!hasTitle && metadata?.title) targetWebsite.set('siteTitle', metadata.title);
          if (!hasOG && metadata?.image) targetWebsite.set('OGImage', metadata.image);
          if (!hasDescription && metadata?.description) {
            targetWebsite.set('siteDescription', metadata.description);
          }
        }
      } catch (error) {
        bookmarkLogger.warn('cache.hydration.metadata.failed', 'Failed to fetch metadata from cache', {
          url,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    bookmarkLogger.cacheHit(url, '');

    return {
      success: true,
      hasTitle,
      hasOG,
      hasDescription,
      metadata,
    };
  } catch (error) {
    bookmarkLogger.error('cache.hydration.failed', 'Cache hydration failed', error, { url });
    throw new CacheHydrationError(url, error instanceof Error ? error.message : String(error));
  }
}

/**
 * Find cached website by URL
 */
export async function findCachedWebsite(url: string): Promise<Parse.Object | null> {
  try {
    const websiteQuery = new Parse.Query(Websites);
    websiteQuery.equalTo('url', url);
    websiteQuery.exists('siteHtmlFile');
    websiteQuery.descending('createdAt');

    const existingWebsite = await websiteQuery.first({ useMasterKey: true });

    if (existingWebsite) {
      bookmarkLogger.cacheHit(url, '');
    } else {
      bookmarkLogger.cacheMiss(url, '');
    }

    return existingWebsite || null;
  } catch (error) {
    bookmarkLogger.error('cache.lookup.failed', 'Failed to lookup cached website', error, { url });
    return null;
  }
}

/**
 * Batch fetch cached websites for multiple URLs
 * This is more efficient than individual queries
 */
export async function batchFindCachedWebsites(urls: string[]): Promise<Map<string, Parse.Object>> {
  const cacheMap = new Map<string, Parse.Object>();

  if (urls.length === 0) return cacheMap;

  try {
    const websiteQuery = new Parse.Query(Websites);
    websiteQuery.containedIn('url', urls);
    websiteQuery.exists('siteHtmlFile');
    // A row that only ever got a wall must not hand it to the next saver.
    websiteQuery.notEqualTo('contentWalled', true);
    websiteQuery.descending('createdAt');
    websiteQuery.limit(1000); // Adjust based on your needs

    const cachedWebsites = await websiteQuery.find({ useMasterKey: true });

    // Build map of url -> website, keeping only the most recent for each URL
    for (const website of cachedWebsites) {
      const url = website.get('url');
      if (!cacheMap.has(url)) {
        cacheMap.set(url, website);
      }
    }

    bookmarkLogger.info('cache.batch.lookup', 'Batch cache lookup completed', {
      requestedCount: urls.length,
      foundCount: cacheMap.size,
      hitRate: (cacheMap.size / urls.length) * 100,
    });

    return cacheMap;
  } catch (error) {
    bookmarkLogger.error('cache.batch.lookup.failed', 'Batch cache lookup failed', error, {
      urlCount: urls.length,
    });
    return cacheMap;
  }
}
