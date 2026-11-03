import { createError, defineEventHandler, getRouterParam, setResponseStatus } from 'h3';
import Parse from 'parse/node.js';
import { initParseForBoards, requireAuth } from '#root/server/utils/boardUtils';
import { getUserWithPlan, getAudioQuota } from '#root/server/utils/plans';
import { queueTranscription } from '#root/server/utils/audioTranscription';
import { usageErrorBody } from '#root/server/utils/rssUtils';

/**
 * Ask for a transcript of an audio bookmark that has none.
 *
 * `saveUserAudio` queues one for every recording that arrives without one, so
 * this is the second chance: a transcript that failed, one the user declined on
 * the device and wants after all, and a row saved before transcripts existed.
 *
 * Refused early when the audio allowance is spent, rather than queued and
 * silently dropped by the worker — the clients already turn a `UsageError`
 * into the upgrade sheet, and a `pending` badge that never resolves is worse
 * than a refusal.
 */
defineRouteMeta({
  openAPI: {
    tags: ['Bookmarks'],
    summary: 'Transcribe an audio bookmark',
    description:
      'Queues a server-side transcript for one audio bookmark and sets `transcriptStatus` '
      + 'to `pending`. The finished transcript lands in `siteBody` and `audioTranscript`. '
      + 'Counts against the same monthly audio allowance as article narration.',
    responses: {
      '200': { description: '{ success, transcriptStatus }' },
      '403': { description: 'UsageError — the monthly audio allowance is spent' },
      '404': { description: 'No such bookmark, or it is not the caller’s' },
      '409': { description: 'Already transcribed, or one is already being made' },
      '415': { description: 'The bookmark is not audio' },
    },
  },
});

export default defineEventHandler(async (event) => {
  initParseForBoards();
  const auth = await requireAuth(event);
  const id = getRouterParam(event, 'id');

  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' });

  // Scoped to the caller's own rows: the id comes from the client, and a
  // transcript costs the *owner's* allowance.
  const query = new Parse.Query('websites');
  query.equalTo('objectId', id);
  query.equalTo('user', auth.user);
  const website = await query.first({ useMasterKey: true });

  if (!website) throw createError({ statusCode: 404, statusMessage: 'Bookmark not found' });

  if (website.get('type') !== 'audio') {
    throw createError({ statusCode: 415, statusMessage: 'That bookmark is not audio' });
  }
  if (!website.get('fileUrl') && !website.get('file')) {
    throw createError({ statusCode: 415, statusMessage: 'That bookmark has no audio to read' });
  }
  if (website.get('transcriptStatus') === 'pending') {
    throw createError({ statusCode: 409, statusMessage: 'A transcript is already being made' });
  }

  const { user, plan } = await getUserWithPlan(auth.user.id);
  if (getAudioQuota(user, plan).exceeded) {
    // The shape `streamAudio` already uses, and both clients already map to an
    // upgrade prompt: `errorType` at the top level, not buried in h3's `data`
    // envelope by `createError`. See `usageErrorBody`.
    setResponseStatus(event, 403);
    return usageErrorBody('Usage limit reached, please upgrade your plan', 'audio');
  }

  await queueTranscription(website, auth.user.id);

  return { success: true, transcriptStatus: 'pending' };
});
