/**
 * The late-arriving device pass.
 *
 * A share-sheet save has to feel instant, and the extension that handles it is
 * capped at ~120 MB and killed the moment the sheet dismisses — far too little
 * to render a page in a WKWebView. So the extension enqueues and returns, and
 * the main app does the rendering later: on next foreground, or from a
 * background task. This route is where that result lands.
 *
 * It matters most for Instagram and Threads, where the device is not an
 * optimization but the only route that works — it renders the post on the
 * user's own connection, in a real browser engine, optionally in their own
 * logged-in session. See `server/utils/socialResolvers/meta.ts`.
 *
 * The payload is the same `deviceEnrichment` shape `saveBookmark` already
 * accepts, validated by the same `sanitizeDeviceEnrichment` and applied by the
 * same `applyDeviceEnrichment`, so a bookmark enriched late is indistinguishable
 * from one enriched inline.
 */

import { defineEventHandler, readBody, createError } from 'h3';
import Parse from 'parse/node.js';
import { requireUserId } from '#root/server/utils/requireUser';
import { sanitizeDeviceEnrichment, applyDeviceEnrichment, rehostCarousel } from '#root/server/routes/v1/content/saveBookmark';
import type { BookmarkImage } from '#root/server/utils/bookmarkImages';
import { captureException } from '#root/server/utils/sentry.js';

Parse.initialize(
  process.env.VITE_PARSE_ID as string,
  process.env.VITE_PARSE_JS_KEY as string,
  process.env.VITE_PARSE_MASTER_KEY as string
);
Parse.serverURL = process.env.VITE_PARSE_URL as string;

const Websites = Parse.Object.extend('websites');

defineRouteMeta({
  openAPI: {
    tags: ['Bookmarks'],
    description:
      "Attach on-device extraction (rendered page body, OCR text, screenshots, tags) to a bookmark the device saved earlier.",
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['deviceEnrichment'],
            properties: {
              customId: {
                type: 'string',
                description:
                  'The client-generated id the device sent with the original save. Preferred over objectId.'
              },
              objectId: {
                type: 'string',
                description: 'Parse object id of the bookmark, when the device knows it.'
              },
              deviceEnrichment: {
                type: 'object',
                description:
                  'Same shape saveBookmark accepts: title, description, author, siteBody, imageText, aiSummary, tags, keywords, Parse file references for screenshots, and clientMetadata — the post the device read out of the rendered page, including every picture of a carousel.'
              }
            }
          }
        }
      }
    },
    responses: {
      200: { description: 'Enrichment applied' },
      401: { description: 'Missing or invalid credentials' },
      404: { description: 'No bookmark matched, or it belongs to another user' },
      422: { description: 'Enrichment payload was empty or malformed' }
    }
  }
});

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event);
  const body = await readBody(event);

  const customId = typeof body?.customId === 'string' ? body.customId.trim() : '';
  const objectId = typeof body?.objectId === 'string' ? body.objectId.trim() : '';
  if (!customId && !objectId) {
    throw createError({ statusCode: 400, statusMessage: 'customId or objectId is required' });
  }

  const enrichment = sanitizeDeviceEnrichment(body?.deviceEnrichment);
  if (!enrichment) {
    throw createError({ statusCode: 422, statusMessage: 'deviceEnrichment was empty or malformed' });
  }

  try {
    const query = new Parse.Query(Websites);
    if (customId) query.equalTo('customId', customId);
    else query.equalTo('objectId', objectId);
    // Scope to the caller. `customId` is generated client-side, so without this
    // one user could enrich — and so overwrite the title, body and screenshot
    // of — another user's bookmark by guessing an id.
    query.equalTo('user', Parse.User.createWithoutData(userId));
    query.descending('createdAt');

    const website = await query.first({ useMasterKey: true });
    if (!website) {
      throw createError({ statusCode: 404, statusMessage: 'Bookmark not found' });
    }

    applyDeviceEnrichment(website, enrichment);
    // The row already exists and its card is on screen; this is the content
    // arriving, which is exactly what `metadata` means elsewhere in the save
    // path. afterSave re-indexes from here.
    website.set('saveStage', 'metadata');
    await website.save(null, { useMasterKey: true });

    // A carousel the device just read is a list of CDN links that expire within
    // days. Copying them onto our own storage is the same detached pass the
    // inline save path runs, and for the same reason.
    const carousel: BookmarkImage[] = website.get('images') || [];
    if (carousel.length > 1) {
      rehostCarousel(website.id as string, carousel).catch((error: any) => {
        console.error('[enrichBookmark] Error re-hosting carousel:', error);
      });
    }

    console.log(
      `[enrichBookmark] applied to ${website.id} (${enrichment.siteBody ? 'page body' : 'metadata'}${enrichment.imageText ? ', ocr' : ''}${enrichment.desktopScreenshot ? ', screenshot' : ''}${carousel.length > 1 ? `, ${carousel.length} images` : ''})`
    );

    return { status: 'ok', objectId: website.id };
  } catch (error: any) {
    // A thrown h3 error is the answer we meant to give, not a failure to report.
    if (error?.statusCode) throw error;
    console.error('[enrichBookmark] Error:', error);
    captureException(error);
    throw createError({ statusCode: 500, statusMessage: 'Failed to apply enrichment' });
  }
});
