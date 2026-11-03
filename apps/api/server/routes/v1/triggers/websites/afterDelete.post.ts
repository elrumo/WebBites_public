import { captureException } from '#root/server/utils/sentry.js';
import { createError, defineEventHandler, H3Event, readBody } from 'h3';
import { incrementPendingBookmarkCount } from '#root/server/utils/distributedBookmarkCounter';
import { removeFromMeilisearch } from '#root/server/utils/meilisearchTrash';
import { removeEmbeddingBackups } from '#root/server/services/meilisearchSync';

interface AfterDeleteBody {
  websiteId?: string;
  userId?: string;
  wasCounted?: boolean;
}

defineRouteMeta({
  openAPI: {
    tags: ['Triggers'],
    description: 'Handle afterDelete operations for websites',
    requestBody: {
      description: 'Website afterDelete data',
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              websiteId: {
                type: 'string',
                description: 'Parse object ID of the website'
              },
              userId: {
                type: 'string',
                description: 'Parse object ID of the user'
              },
              wasCounted: {
                type: 'boolean',
                description: 'Whether the bookmark still counted against the quota. False when the caller has already decremented (a soft delete frees the quota at delete time), in which case only the search documents are cleaned up.'
              }
            },
            required: ['userId']
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Successfully handled afterDelete operations',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                decremented: { type: 'boolean' },
                skipped: { type: 'boolean' }
              }
            }
          }
        }
      },
      400: {
        description: 'Bad request - missing required parameters'
      },
      500: {
        description: 'Internal server error'
      }
    }
  }
});

export default defineEventHandler(async (event: H3Event) => {
  try {
    const body = await readBody(event) as AfterDeleteBody;
    const { websiteId, userId } = body;
    const wasCounted = body.wasCounted !== false;

    if (!userId) {
      throw createError({
        statusCode: 400,
        statusMessage: 'userId is required'
      });
    }

    // Unconditional, and before the counter: a soft-deleted bookmark keeps its
    // search document (that is what the trash reads), so a row that is really
    // gone has to take the document with it or it stays searchable for ever.
    // Idempotent, so the purge — which removes the documents itself before
    // destroying the rows — can fire this too.
    if (websiteId) {
      await removeFromMeilisearch([websiteId]);
      // Its embedding backup too. A miss is swept up by the next sync run.
      await removeEmbeddingBackups([websiteId]).catch((error) =>
        console.error(`[afterDelete] Could not remove the embedding backup of ${websiteId}:`, error));
    }

    if (!wasCounted) {
      return {
        success: true,
        skipped: true,
        decremented: false,
        websiteId: websiteId || null
      };
    }

    await incrementPendingBookmarkCount(userId, -1, new Date());

    return {
      success: true,
      skipped: false,
      decremented: true,
      websiteId: websiteId || null
    };
  } catch (error: any) {
    console.error('[AFTER DELETE WEBSITES] Error:', error?.message || String(error));
    captureException(error);

    throw createError({
      statusCode: error?.statusCode || 500,
      statusMessage: error?.statusMessage || 'Internal server error'
    });
  }
});
