import crypto from 'crypto';
import { defineEventHandler, getRouterParam, getQuery, createError } from 'h3';
import { validateParseToken } from '#root/server/utils/raycast-auth.js';
import {
  initParseForBoards, getBoardBySlug, getBoardBookmarkEntries,
  countBoardBookmarks, sanitizeBoard, verifyShareToken,
} from '#root/server/utils/boardUtils';
import { displayNames } from '#root/server/utils/boardSharing';

defineRouteMeta({
  openAPI: {
    tags: ['Board Sharing'],
    summary: 'Access a shared board (public)',
    description: 'Retrieves a shared board via its publicSlug. Access depends on visibility: link (token in query param), email_list (auth + email check), email_domain (auth + domain check). Private boards always return 403.',
    security: [],
    parameters: [
      { name: 'publicSlug', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'token', in: 'query', required: false, schema: { type: 'string' }, description: 'Share token for link-visibility boards' },
      { name: 'limit', in: 'query', schema: { type: 'number', default: 50 } },
      { name: 'skip', in: 'query', schema: { type: 'number', default: 0 } },
    ],
    responses: {
      '200': { description: 'Shared board data' },
      '403': { description: 'Access denied' },
      '404': { description: 'Board not found' },
    },
  },
});

export default defineEventHandler(async (event) => {
  initParseForBoards();
  const publicSlug = getRouterParam(event, 'publicSlug');
  if (!publicSlug) throw createError({ statusCode: 400, statusMessage: 'publicSlug is required' });

  const board = await getBoardBySlug(publicSlug);
  if (!board) throw createError({ statusCode: 404, statusMessage: 'Board not found' });

  const visibility = board.get('visibility') || 'private';
  const visibilityConfig = board.get('visibilityConfig') || {};
  const query = getQuery(event);
  const limit = Math.min(parseInt(query.limit as string) || 50, 500);
  const skip = parseInt(query.skip as string) || 0;

  // ─── Access Control ────────────────────────────────────────────
  if (visibility === 'private') {
    throw createError({ statusCode: 403, statusMessage: 'Board is private' });
  }

  if (visibility === 'link') {
    const token = String(query.token || '');
    if (!token || !visibilityConfig.tokenHash || !verifyShareToken(token, visibilityConfig.tokenHash)) {
      throw createError({ statusCode: 403, statusMessage: 'Invalid or missing share token' });
    }
  }

  if (visibility === 'email_list' || visibility === 'email_domain') {
    let viewer: any;
    try {
      viewer = await validateParseToken(event);
    } catch {
      throw createError({ statusCode: 401, statusMessage: 'Authentication required to access this board' });
    }

    const email = String(viewer.email || '').toLowerCase();
    if (!email) throw createError({ statusCode: 403, statusMessage: 'Email is required' });

    if (visibility === 'email_list') {
      const allowed = (visibilityConfig.allowedEmails || []).map((v: string) => String(v).toLowerCase());
      if (!allowed.includes(email)) {
        throw createError({ statusCode: 403, statusMessage: 'Your email is not authorized' });
      }
    }

    if (visibility === 'email_domain') {
      const domain = email.split('@')[1] || '';
      const allowed = (visibilityConfig.allowedDomains || []).map((v: string) => String(v).toLowerCase());
      if (!allowed.includes(domain)) {
        throw createError({ statusCode: 403, statusMessage: 'Your email domain is not authorized' });
      }
    }
  }

  // ─── Return Board + Bookmarks ──────────────────────────────────
  const [entries, total] = await Promise.all([
    getBoardBookmarkEntries(board.id, limit, skip),
    countBoardBookmarks(board.id),
  ]);

  const items = entries.map((entry) => {
    const website = entry.get('website');
    return {
      source: entry.get('source') || 'manual',
      aiTopic: entry.get('aiTopic') || null,
      addedAt: entry.createdAt,
      website: website ? {
        id: website.id,
        url: website.get('url'),
        siteTitle: website.get('siteTitle'),
        siteDescription: website.get('siteDescription'),
        OGImage: website.get('OGImageFile')?.url() || website.get('OGImage'),
        type: website.get('type'),
        tags: website.get('tags'),
      } : null,
    };
  });

  const ownerId = board.get('owner')?.id as string;
  const ownerName = (await displayNames([ownerId])).get(ownerId) ?? 'Someone';
  return { board: sanitizeBoard(board), ownerName, items, totalBookmarks: total };
});
