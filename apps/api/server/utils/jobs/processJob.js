/**
 * The job handlers behind the queue.
 *
 * Moved verbatim out of `server/routes/qstash-webhook.post.js` so the same code
 * serves both queue drivers: the QStash webhook calls `processJob` for each
 * delivery, and the Redis driver's workers call it for each BullMQ job.
 */
import { captureException } from '#root/server/utils/sentry.js';
import { createError } from 'h3';
import Parse from 'parse/node.js'
import { log } from '../bookmarkLogger';
import { sendToQstash, callBackendEndpoint, updateUsage, incrementBookmarkUsage, saveWebsiteToSearchIndices, getPartitionedQueue, createFileName, isUrlAnImage } from '../serverUtils.js';
import { ImportSessionManager } from '../ImportSessionManager.ts';
import { processScreenshots } from '../../routes/v1/content/getScreenshots.ts';
import { removeBookmarkFromQueue } from '../../routes/v1/import/removeFromQueue.post.ts';
import { removeBatchFromQueue } from '../../routes/v1/import/removeBatchFromQueue.post.ts';
import { SaveBookmark } from '../../routes/v1/content/saveBookmark.ts';
import { pollFeed, extractItemContent, subscribeToUrl } from '../rssService.ts';
import { initParseForRss } from '../rssUtils.ts';
import { enrichmentContext, immediateMessages, aiMessages, automationMessage, queueBase, isEnrichmentContext } from '../enrichmentMessages.ts';
import { runAutomations } from '../automations.ts';

Parse.initialize(process.env.VITE_PARSE_ID, process.env.VITE_PARSE_JS_KEY, process.env.VITE_PARSE_MASTER_KEY)
Parse.serverURL = process.env.VITE_PARSE_URL;

/**
 * Run one job.
 *
 * `body` is the message exactly as it was enqueued (QStash delivers it as the
 * request body, BullMQ as `job.data`).
 *
 * Most job types are fire-and-forget: the QStash webhook has to answer within
 * QStash's timeout, so it starts the handler and returns. A queue worker is the
 * opposite: it has to wait for the handler, otherwise its concurrency and rate
 * limits would mean nothing. `awaitBackground` picks which. Handlers that were
 * already awaited stay awaited either way, and still throw.
 */
export async function processJob(body, { awaitBackground = false } = {}) {
  const tracked = (promise) => (awaitBackground ? promise : undefined);
  const type = body?.body?.type || body?.type || 'unknown';

  // log('[QSTASH-WEBHOOK] body:', body)
  log(`[QSTASH-WEBHOOK] type: ${type}`)


  switch (type) {
    case 'website-save-requests':
      // Process bookmark saving asynchronously to avoid QStash timeout
      await tracked(saveBookmark(body).catch(error => {
        console.error('Error in background bookmark saving:', error);
        captureException(error);
      }));
      break;
    case 'image-save-requests':
      // Process image saving asynchronously to avoid QStash timeout
      await tracked(saveUseImage(body.data).catch(error => {
        console.error('[QSTASH-WEBHOOK - image-save-requests] Error in background image saving:', error);
        captureException(error);
      }));
      break;
    case 'image-processing-requests':
      // Process large image files in background
      await tracked(processLargeImageFile(body.data).catch(error => {
        console.error('[QSTASH-WEBHOOK - image-processing-requests] Error in background image processing:', error);
        captureException(error);
      }));
      break;
    case 'html-processing-requests':
      // Process large HTML files in background
      await tracked(processLargeHtmlFile(body.data).catch(error => {
        console.error('[QSTASH-WEBHOOK - html-processing-requests] Error in background HTML processing:', error);
        captureException(error);
      }));
      break;
    case 'page-content-requests':
      // Process page content asynchronously to avoid QStash timeout
      await tracked(processPageContent(body).catch(error => {
        console.error('[QSTASH-WEBHOOK - page-content-requests] Error in background page content processing:', error);
        captureException(error);
      }));
      break;
    case 'batch-delete':
      // Process batch delete asynchronously to avoid QStash timeout
      await tracked(batchDelete(body.data, body.userId, body.customId).catch(error => {
        console.error('[QSTASH-WEBHOOK] Error in background batch delete:', error);
        captureException(error);
      }));
      break;
    case 'get-page-audio-requests':
      // Process audio generation asynchronously to avoid QStash timeout
      await tracked(getAudio(body.data.text, body.data.websiteID, body.data.url).catch(error => {
        console.error('[QSTASH-WEBHOOK] Error in background audio generation:', error);
        captureException(error);
      }));
      break;
    case 'bookmark-import-requests':
      // Process bookmark import asynchronously to avoid QStash timeout
      await tracked(processBookmarkImport(body.data).catch(error => {
        console.error('Error in background bookmark import:', error);
        captureException(error);
      }));
      break;
    case 'remove-bookmark-from-queue':
      // Migrated to v1 unified architecture - call function directly
      await removeBookmarkFromQueue(body.data || body);
      break;
    case 'remove-bookmarks-from-queue':
      // Batch removal to reduce rate limit pressure - call function directly
      await removeBatchFromQueue(body.data || body);
      break;
    case 'update-usage':
      // Validate required data before attempting update
      if (!body.data || !body.data.typeOfUsage || !body.data.userId) {
        console.error('Invalid update-usage request: missing required fields', {
          hasData: !!body.data,
          typeOfUsage: body.data?.typeOfUsage,
          userId: body.data?.userId
        });
        throw createError({
          statusCode: 400,
          message: 'Missing required fields: typeOfUsage and userId are required'
        });
      }

      let dataToUpdate = {
        typeOfUsage: body.data.typeOfUsage,
        user: body.data.userId,
        subOrAdd: body.data.subOrAdd || 'add',
        number: body.data.number ? body.data.number : 1,
        shouldRefreshCount: body.data.shouldRefreshCount ? body.data.shouldRefreshCount : false
      }

      try {
        log('[QSTASH-WEBHOOK - update-usage] Attempting to update usage with data:', {
          typeOfUsage: dataToUpdate.typeOfUsage,
          userId: dataToUpdate.user,
          subOrAdd: dataToUpdate.subOrAdd,
          number: dataToUpdate.number
        });

        const delta = dataToUpdate.subOrAdd === 'add' ? dataToUpdate.number : -dataToUpdate.number;
        if (process.env.USAGE_ATOMIC_ENABLED === 'true' && dataToUpdate.typeOfUsage === 'bookmarks' && delta > 0 && !dataToUpdate.shouldRefreshCount) {
          await incrementBookmarkUsage({ user: dataToUpdate.user, delta });
        } else {
          await updateUsage(dataToUpdate);
        }
        log('Usage update completed successfully');
      } catch (error) {
        console.error('Error updating usage:', {
          error: error.message,
          stack: error.stack,
          typeOfUsage: dataToUpdate.typeOfUsage,
          userId: dataToUpdate.user,
          subOrAdd: dataToUpdate.subOrAdd
        });

        throw createError({
          statusCode: 500,
          message: `Error updating usage: ${error.message}`
        })
      }
      break;
    case 'save-to-search-index':
      // Process search index save asynchronously to avoid QStash timeout
      await tracked(saveToSearchIndex(body.data).catch(error => {
        console.error('Error in background search index save:', JSON.stringify(error));
        captureException(error);
      }));
      break;
    case 'image-tags-requests':
      // Process image tags asynchronously to avoid QStash timeout
      await tracked(callBackendEndpoint('v1/content/images/getImageTags', body.data || body).catch(error => {
        console.error('[QSTASH-WEBHOOK - image-tags-requests] Error in background image tags:', error);
        captureException(error);
      }));
      break;
    // ─── RSS reader ──────────────────────────────────────────────────
    // Each feed is its own message so a slow or broken publisher delays
    // only itself, and QStash retries just that feed rather than the round.
    case 'rss-feed-poll-requests':
      initParseForRss();
      await tracked(pollFeed(body.data.feedId).catch(error => {
        console.error('[QSTASH-WEBHOOK - rss-feed-poll-requests] Error polling feed:', error);
        captureException(error);
      }));
      break;
    // Full-text extraction plus the automatic summary behind it. Fired only
    // for items on feeds where at least one subscriber pays for extraction.
    case 'rss-item-extract-requests':
      initParseForRss();
      await tracked(extractItemContent(body.data.itemId).catch(error => {
        console.error('[QSTASH-WEBHOOK - rss-item-extract-requests] Error extracting item:', error);
        captureException(error);
      }));
      break;
    // The tail of a large OPML import, which is too many live fetches to
    // hold an HTTP request open for.
    case 'rss-subscribe-requests':
      initParseForRss();
      await tracked(subscribeToUrl(body.data.userId, body.data.url).catch(error => {
        console.error(`[QSTASH-WEBHOOK - rss-subscribe-requests] Error subscribing to ${body.data?.url}:`, error?.message || error);
      }));
      break;
    // ─── Backups ─────────────────────────────────────────────────────
    // One zip part per message; each part queues the next. Fire-and-forget
    // like the rest: a failed part records `lastError` and the dispatcher
    // resumes the run when its lease lapses.
    case 'backup-run-requests':
      await tracked(import('#root/server/utils/backups')
        .then(({ runBackupChunk }) => runBackupChunk(body.data.configId))
        .catch(error => {
          console.error(`[QSTASH-WEBHOOK - backup-run-requests] Error running backup ${body.data?.configId}:`, error?.message || error);
          captureException(error);
        }));
      break;
    case 'audio-transcribe-requests':
      // A recording saved from anywhere but an Apple device, which
      // transcribes on its own. Fire-and-forget: a long file outlives the
      // webhook's request, and every exit writes a `transcriptStatus` the
      // clients read.
      await tracked(import('#root/server/utils/audioTranscription')
        .then(({ transcribeAudioBookmark }) =>
          transcribeAudioBookmark(body.data?.websiteId, body.data?.userId))
        .catch(error => {
          console.error('[QSTASH-WEBHOOK - audio-transcribe-requests] Error transcribing:', error?.message || error);
          captureException(error);
        }));
      break;
    case 'image-ocr-requests':
      // TODO: fix OCR
      // Process OCR extraction asynchronously to avoid QStash timeout
      // callBackendEndpoint('v1/content/images/getOcr', body.data || body).catch(error => {
      //   console.error('[QSTASH-WEBHOOK - image-ocr-requests] Error in background OCR:', error);
      //   captureException(error);
      // });
      break;
  }

  return { success: true }
}

const batchDelete = async (ids, userId, customId) => {
  try {
    log(`batchDelete data: ${JSON.stringify({ids, userId, customId})}`)
    let result = await callBackendEndpoint('batchDelete', {ids, userId, customId}, { retries: 5, retryDelay: 3000, timeout: 120000 });
    log(`[batchDelete] result: ${JSON.stringify(result)}`);
  } catch (error) {
    console.error('Error in batchDelete:', error);
    throw createError({
      statusCode: 500,
      message: `Error processing message - batchDelete: ${error}`
    })
  }
}

const saveBookmark = async (body) => {
  const websiteData = body.data;
  websiteData.importing = websiteData.importing || false;
  // bookmarksToImport rows hold the URL as queued, before the cleaning below
  const queueUrl = websiteData.url;
  
  // Clean the URL by removing backticks and trimming whitespace
  if (websiteData.url) {
    websiteData.url = websiteData.url.replace(/`/g, '').trim();
  }
  
  // log('websiteData: ', websiteData)

  // Skip imports that were cancelled after this message was queued
  if (websiteData.importing && websiteData.userId && !(await isImportStillPending(websiteData.userId, queueUrl, websiteData.importSessionId))) {
    log(`[saveBookmark] Import cancelled, skipping: ${websiteData.url}`);
    return;
  }

  // First part: Save the bookmark
  try {
    log(`url: ${websiteData.url}`);
    // Call SaveBookmark class method directly instead of HTTP request
    const bookmarkService = new SaveBookmark();
    let savedSite = await bookmarkService.saveBookmark(websiteData);
    
    // Debug logging to understand the response structure
    // console.log('DEBUG: savedSite response structure:', JSON.stringify(savedSite, null, 2));

    // Direct call returns { status: 'ok', savedSite } or { status: 'error', error }
    if(!savedSite || savedSite.status === 'error' || savedSite.error) {
      savedSite = savedSite || { error: 'saveBookmark returned no result' };
      const errorMsg = savedSite.error || 'Unknown error';
      console.error('Error saving website for URL:', websiteData.url, '---- error: ', errorMsg);

      // Remove failed bookmark from queue immediately (no QStash delay)
      if (websiteData.importing && websiteData.userId) {
        const processingTime = Date.now() - (websiteData.startTime || Date.now());
        try {
          await removeBookmarkFromQueue({
            userId: websiteData.userId,
            url: queueUrl,
            status: 'failed',
            errorMsg: errorMsg,
            processingTime: processingTime
          });
          log(`❌ Failed bookmark removed from queue: ${websiteData.url}`);
        } catch (removalError) {
          console.error(`❌ Failed to remove failed bookmark from queue:`, removalError);
        }
      }

      throw createError({
        statusCode: 500,
        message: 'Error processing message - saveBookmark save failed'
      });
    }

    // Extract the savedSite from the direct response
    // Direct response structure: { status: 'ok', savedSite: actualSavedSiteObject }
    if (savedSite.status === 'ok' && savedSite.savedSite) {
      savedSite = savedSite.savedSite;
    } else {
      console.error('Error: Unexpected response structure from saveBookmark handler');
      console.error('Expected { status: "ok", savedSite: ... }, but got:', JSON.stringify(savedSite, null, 2));
      throw createError({
        statusCode: 500,
        message: 'Error processing message - saveBookmark: Unexpected response structure'
      });
    }
    
    // Final check if savedSite is still undefined or null
    if (!savedSite) {
      console.error('Error: savedSite is undefined even though status was "ok"');
      console.error('Full response was:', JSON.stringify(savedSite, null, 2));
      throw createError({
        statusCode: 500,
        message: 'Error processing message - saveBookmark: savedSite is undefined'
      });
    }
    
    // Remove bookmark from queue immediately if this is an import (no QStash delay)
    if (websiteData.importing && websiteData.userId) {
      const processingTime = Date.now() - (websiteData.startTime || Date.now());
      log(`✅ Removing successful bookmark immediately: ${websiteData.url}`);

      try {
        await removeBookmarkFromQueue({
          userId: websiteData.userId,
          url: queueUrl,
          status: 'success',
          errorMsg: null,
          processingTime: processingTime
        });
        log(`✅ Bookmark removed and progress updated: ${websiteData.url}`);
      } catch (removalError) {
        console.error(`❌ Failed to remove bookmark from queue:`, removalError);
        // Don't throw - let the bookmark save succeed even if queue removal fails
      }
    }
    
    let urlIsImage = isUrlAnImage(websiteData.url);
    // let urlIsImage = websiteData.url.match(/\.(jpeg|jpg|gif|png)$/) != null;
    // A PDF row is finished when saveUserPdf returns: it already carries its
    // cover, its text and its page count. Enrichment would screenshot and scrape
    // the document URL, which yields a blank shot and no article at all.
    if(savedSite.type == 'game' || savedSite.type == 'movie' || savedSite.type == 'pdf' || urlIsImage){
      return 'Done saving game, movie, image or pdf';
    }

    // Second part: fan out the enrichment stages. Awaited: we are already in a
    // background promise, and an unawaited enqueue behind a setTimeout was lost
    // whenever the process restarted inside that window.
    const savedSiteId = savedSite.id;
    log(`[qstash-webhook] savedSiteId: ${savedSiteId}`);
    await enqueueEnrichment(savedSiteId, websiteData);

    return { success: true, savedSiteId };
  } catch (error) {
    console.error(' ');
    console.error('__________________');
    console.error('Error in saveBookmark with websiteData:', websiteData);
    console.error('ERROR details:', error.message || error);
    console.error('ERROR stack:', error.stack);
    console.error('__________________');
    console.error(' ');
    
    // Remove errored bookmark from queue immediately (no QStash delay)
    if (websiteData.importing && websiteData.userId) {
      try {
        const processingTime = Date.now() - (websiteData.startTime || Date.now());
        await removeBookmarkFromQueue({
          userId: websiteData.userId,
          url: queueUrl,
          status: 'failed',
          errorMsg: error.message || 'Unknown error during bookmark processing',
          processingTime: processingTime
        });
        log(`❌ Errored bookmark removed from queue: ${websiteData.url}`);
      } catch (removalError) {
        console.error('Failed to remove errored bookmark from queue:', removalError);
      }
    }
    
    throw createError({
      statusCode: 500,
      message: `Error processing message 1 - saveBookmark: ${error}`
    });
  }
};

/**
 * First enrichment hop for a saved website row. Every entry point (QStash
 * save, public API, batch) calls this; see utils/enrichmentMessages.ts for
 * the shape. Never throws — a lost enqueue must not fail the save.
 */
export const enqueueEnrichment = async (savedSiteId, websiteData) => {
  const ctx = enrichmentContext(savedSiteId, websiteData);
  const hasDeviceBody = Boolean(websiteData.deviceEnrichment?.siteBody);
  const { screenshots, pageContent } = immediateMessages(ctx, hasDeviceBody);

  try {
    await sendToQstash([screenshots], { isBatch: true, queueName: getPartitionedQueue(queueBase(ctx, 'getBookmarkContent')) });
    if (pageContent) {
      await sendToQstash(pageContent, { isBatch: false, queueName: getPartitionedQueue(queueBase(ctx, 'getPageContent')) });
    } else {
      log('[enqueueEnrichment] Device page body present; skipping server content extraction');
      await enqueueAiStages(ctx);
    }
  } catch (error) {
    console.error(`[enqueueEnrichment] Failed for ${savedSiteId}:`, error);
    captureException(error);
  }
};

/** Second hop: the AI stages, once `siteBody` is (or definitively is not) there. */
export const enqueueAiStages = async (ctx) => {
  try {
    await sendToQstash(aiMessages(ctx), { isBatch: true, queueName: getPartitionedQueue(queueBase(ctx, 'getBookmarkContent')) });
  } catch (error) {
    console.error(`[enqueueAiStages] Failed for ${ctx.savedSiteId}:`, error);
    captureException(error);
  }
};

const processPageContent = async (data) => {
  let result;

  // Debug: Log the full data structure
  // log(`[processPageContent] Full data structure:`, JSON.stringify(data));
  // log(`[processPageContent] data.body:`, JSON.stringify(data?.body));
  // log(`[processPageContent] data.body.data:`, JSON.stringify(data?.body?.data));
  // log(`[processPageContent] data.data:`, JSON.stringify(data?.data));

  const body = data?.body?.data || data?.data || {};
  const subType = data?.body?.subType || data?.subType || 'unknown';

  // log(`[processPageContent] Processing subType: ${subType}, extracted body:`, JSON.stringify(body));

  switch (subType) {
    case 'getPageContent':
      // New unified content extraction endpoint
      result = await callBackendEndpoint('v1/content/getPageContent', body, { timeout: 90000 })
        .catch(error => ({ success: false, error: error?.message || String(error) }));
      // The AI stages read siteBody, so they queue now — after extraction has
      // succeeded or given up — rather than after a guessed delay. Messages
      // from before this change carry no context and were followed by their
      // own dependent batch, so they are left alone.
      if (isEnrichmentContext(body)) await enqueueAiStages(body);
      break;
    case 'getRenderedHtml':
      // Legacy endpoint - route to unified function
      result = await callBackendEndpoint('v1/content/getPageContent', { ...body, preferRendered: true }, { timeout: 90000 });
      break;
    case 'getArticleContent':
      // Legacy endpoint - route to unified function
      result = await callBackendEndpoint('v1/content/getPageContent', { ...body, preferRendered: false }, { timeout: 90000 });
      break;
    case 'categoriseSite':
      // AI endpoint - needs longer timeout for queue + processing
      try {
        result = await callBackendEndpoint('v1/content/categoriseSite', body, { timeout: 120000, retries: 3 });
      } finally {
        // Automations run even when tagging failed: url/domain rules don't need tags.
        // ponytail: a QStash redelivery of this message re-queues them, and webhook actions post twice.
        const userId = body?.websiteData?.userId;
        if (body?.savedSiteId && userId) {
          await sendToQstash(automationMessage(body.savedSiteId, userId), { isBatch: false, queueName: getPartitionedQueue(queueBase(body.websiteData, 'getBookmarkContent')) })
            .catch((error) => { console.error('[categoriseSite] Failed to queue automations:', error); captureException(error); });
        }
      }
      break;
    case 'getAiSummary':
      // AI endpoint - needs longer timeout for queue + processing
      result = await callBackendEndpoint('v1/content/getAiSummary', body, { timeout: 120000, retries: 3 });
      break;
    case 'checkForAdultContent':
      // Not enqueued any more (it was a no-op message per bookmark). Handler
      // kept so in-flight messages and a future re-enable still route here.
      // TODO: make it call the func directly instead of making a http request
      // result = await callBackendEndpoint('v1/content/checkForAdultContent', body, { timeout: 120000, retries: 3 });
      break;
    case 'getScreenshots':
      try {
        // Call the function directly instead of making an HTTP request to avoid self-recursion
        // log(`[qstash - getScreenshots] Calling processScreenshots with body:`, JSON.stringify(body));
        result = await processScreenshots(body);
        // Wrap result to match expected format from callBackendEndpoint
        result = { success: true, data: result };
      } catch (error) {
        console.error('[qstash - getScreenshots] Error processing getScreenshots:', error);
        console.error('[qstash - getScreenshots] Body was:', JSON.stringify(body));
        // Return error in expected format
        result = { success: false, error: error.message };
        // throw createError({
        //   statusCode: 500,
        //   message: "Error processing getScreenshots request"
        // });
      }
      break;
    case 'runAutomations':
    case 'assignToBoards': // in-flight messages from before automations; smart boards run as automations now
      result = { success: true, data: await runAutomations(body.savedSiteId, body.userId) };
      break;
    default:
      console.error('Unknown page content request type:', data);
      return { success: false, error: 'Unknown request type' };
  }
  return result;
}

const processBookmarkImport = async ({ userId, url, accessType, ignoreSubscriptionLimits, importSessionId }) => {
  const startTime = Date.now();
  
  try {
    const user = await new Parse.Query(Parse.User).get(userId, { useMasterKey: true });

    log(`[processBookmarkImport] importing for user: ${userId}, url: ${url}`)

    // The queue row is deleted when an import is cancelled; drop stale messages
    if (!(await isImportStillPending(userId, url, importSessionId))) {
      log(`[processBookmarkImport] Import cancelled, skipping: ${url}`);
      return;
    }
    
    if (!isValidUrl(url)) {
      log(`Invalid URL: ${url}`);
      // Send QStash message for ordered removal - invalid URL
      await sendToQstash({
        type: 'remove-bookmark-from-queue',
        userId: userId,
        url: url,
        status: 'failed',
        errorMsg: 'Invalid URL format',
        processingTime: Date.now() - startTime
      }, { queueName: getPartitionedQueue('bookmark-queue-management-import')});
      return;
    }

    let objToSend = {
      type: 'website-save-requests',
      data: {
        url, userId, fromCache: true, importing: true, accessType, ignoreSubscriptionLimits, importSessionId
      },
    };
    await sendToQstash(objToSend, {isBatch: false, queueName: getPartitionedQueue('saveBookmarkFromimport-import')});

    // Update session with current processing URL
    await updateCurrentlyProcessing(user, url);

    // NOTE: Bookmark removal is now handled by the ordered queue system
    // The 'website-save-requests' processing will send the removal message
    // when the bookmark is successfully saved
    
    log(`Bookmark queued for processing: ${url}`);
    
  } catch (error) {
    console.error(`Error processing bookmark ${url} for user ${userId}:`, error);
    const processingTime = Date.now() - startTime;
    
    // Send QStash message for ordered removal - processing error
    // The v1/import/removeFromQueue endpoint will handle progress updates
    await sendToQstash({
      type: 'remove-bookmark-from-queue',
      userId: userId,
      url: url,
      status: 'failed',
      errorMsg: error.message,
      processingTime: processingTime
    }, { queueName: getPartitionedQueue('bookmark-queue-management-import') });
  }
}

// An import message is only valid while its session isn't cancelled and its
// bookmarksToImport row still exists (cancelImport deletes the rows). Fails open
// so a transient Parse error never strands a row and blocks completion.
async function isImportStillPending(userId, url, importSessionId) {
  try {
    if (importSessionId && await ImportSessionManager.isSessionCancelled(importSessionId)) {
      return false;
    }
    const query = new Parse.Query('bookmarksToImport');
    query.equalTo('user', Parse.User.createWithoutData(userId));
    query.equalTo('url', url);
    return (await query.count({ useMasterKey: true })) > 0;
  } catch (error) {
    console.error(`[isImportStillPending] Check failed for ${url}, continuing:`, error?.message || error);
    return true;
  }
}

// Helper function to update currently processing bookmark
async function updateCurrentlyProcessing(user, url) {
  const session = await ImportSessionManager.getActiveSession(user);
  if (session) {
    await ImportSessionManager.updateCurrentlyProcessing(session, url);
  }
}

// NOTE: updateImportProgress and completeImportSession have been migrated to
// v1/import/removeFromQueue.post.ts as part of the unified v1 architecture

const getAudio = async (text, websiteID, url) => {
  return await callBackendEndpoint('v1/audio/getAudio', { text, websiteID, url });
}

const saveUseImage = async (data) => {
  try {
    log(`[qstash - saveUseImage] image urlToSave: ${data.urlToSave}`);

    let result = await callBackendEndpoint('saveUserImage', {
      imageUrl: data.urlToSave,
      tags: [],
      customId: data.customId,
      userId: data.userId,
      savedFrom: data.savedFrom
    });

    return result;
  } catch (error) {
    console.error('Error processing saveUseImage:', error);
    throw new Error(`Error processing saveUseImage: ${error.message}`);
  }
}

////////// Helper functions

const isValidUrl = (url) => {
  try {
    url = url.trim();
    if (url.startsWith('javascript')) return false;
    const newUrl = new URL(url);
    return newUrl.protocol === 'http:' || newUrl.protocol === 'https:';
  } catch (error) {
    log(`${url} is not a valid url: ${error}`);
    return false;
  }
}

const logFailedImport = async (savedSite, funcName, error, user) => {
  try {
    const isString = typeof savedSite === 'string';
    const failedToImport = user.get('failedToImport') || [];
    failedToImport.push({
      url: isString ? savedSite : savedSite.get('url'),
      websiteId: isString ? 'n/a' : savedSite.id,
      error: error,
      funcName: funcName,
      date: new Date().toString()
    });
    user.set('failedToImport', failedToImport);
    await user.save(null, { useMasterKey: true });
  } catch (error) {
    console.error(`Error logging failed import: ${error}`);
  }
}

// BACKGROUND FILE PROCESSING HANDLERS
export const processLargeImageFile = async ({ websiteId, imageData, url, fileExtension, fileName }) => {
  try {
    log(`Processing large image file for website ${websiteId}`);
    
    if (url) {
      log(`Downloading image from URL: ${url}`);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to download image: ${response.statusText}`);
      const buffer = await response.arrayBuffer();
      imageData = Buffer.from(buffer).toString('base64');
    }

    // Get the website object
    const websiteQuery = new Parse.Query("websites");
    const website = await websiteQuery.get(websiteId, { useMasterKey: true });
    
    if (!website) throw new Error(`Website not found: ${websiteId}`);
    
    // Process the image file
    // const fullFileName = `${fileName}.${fileExtension}`;
    let userId = website.get('user')?.id || '';
    let fullFileName = createFileName(userId, fileName, fileExtension, 'processLargeImageFile-1');
    // Construct proper content type from file extension
    const extension = fileExtension.startsWith('.') ? fileExtension.slice(1) : fileExtension;
    const contentType = `image/${extension}`;
    const imageFile = new Parse.File(fullFileName, { base64: imageData }, contentType);
    await imageFile.save({ useMasterKey: true });
    
    // Update website with processed image
    website.set("OGImageFile", imageFile);
    website.set("OGImage", imageFile.url());
    await website.save(null, { useMasterKey: true });
    
    console.log(`✅ Large image processed successfully for website ${websiteId}`);
    
  } catch (error) {
    console.error(`❌ Error processing large image for website ${websiteId}:`, error);
    captureException(error);
  }
};

const processLargeHtmlFile = async ({ websiteId, htmlContent, fileName }) => {
  try {
    log(`[qstash - processLargeHtmlFile] Processing large HTML file for website ${websiteId}`);

    // Get the website object
    const websiteQuery = new Parse.Query("websites");
    const website = await websiteQuery.get(websiteId, { useMasterKey: true });

    if (!website) {
      throw new Error(`Website not found: ${websiteId}`);
    }

    // Process the HTML file
    const htmlFile = new Parse.File(fileName, { base64: Buffer.from(htmlContent).toString('base64') }, 'text/html');
    await htmlFile.save({ useMasterKey: true });

    // Update website with processed HTML
    website.set("siteHtmlFile", htmlFile);
    website.set("siteHtmlFileUrl", htmlFile.url());
    await website.save(null, { useMasterKey: true });

    console.log(`[qstash - processLargeHtmlFile] ✅ Large HTML processed successfully for website ${websiteId}`);

  } catch (error) {
    console.error(`❌ Error processing large HTML for website ${websiteId}:`, error);
    captureException(error);
  }
};

export const saveToSearchIndex = async (data) => {
  try {
    const { websiteId } = data;

    if (!websiteId) {
      throw new Error('websiteId is required');
    }

    log(`Saving website ${websiteId} to search indices`);

    // Call the utility function directly instead of making an HTTP request
    const result = await saveWebsiteToSearchIndices(websiteId, 'qstash-saveToSearchIndex');

    if (!result.success) {
      console.error('Error saving to search indices:', result);
      throw new Error(`Search index save failed: ${JSON.stringify(result)}`);
    }

    log(`✅ Successfully saved website ${websiteId} to search indices`);
    return result;
  } catch (error) {
    console.error('Error in saveToSearchIndex handler:', error);
    throw createError({
      statusCode: 500,
      message: `Error saving to search index: ${error.message}`
    });
  }
};
