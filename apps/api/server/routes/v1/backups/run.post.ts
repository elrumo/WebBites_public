import { defineEventHandler, createError } from 'h3';
import { initParseForBoards, requireAuth } from '#root/server/utils/boardUtils';
import {
  backupsRefusal, requireBackupConfig, serializeBackupConfig, startBackupRuns,
} from '#root/server/utils/backups';

defineRouteMeta({
  openAPI: {
    tags: ['Backups'],
    summary: 'Back up now',
    description: 'Queues a backup of everything changed since the last one (or resumes one that failed part-way).',
    responses: { '200': { description: '`{ backup }` with `running: true`' }, '409': { description: 'A backup is already running' } },
  },
});

export default defineEventHandler(async (event) => {
  initParseForBoards();
  const auth = await requireAuth(event);
  const refusal = await backupsRefusal(event, auth.userId);
  if (refusal) return refusal;

  const row = await requireBackupConfig(auth.userId);
  if (row.get('enabled') !== true) throw createError({ statusCode: 400, statusMessage: 'Turn backups on first' });
  if (row.get('run') && !row.get('lastError')) throw createError({ statusCode: 409, statusMessage: 'A backup is already running' });

  await startBackupRuns([row]);
  return { success: true, backup: serializeBackupConfig(row) };
});
