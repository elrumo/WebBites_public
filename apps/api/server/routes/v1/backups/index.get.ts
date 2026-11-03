import { defineEventHandler } from 'h3';
import { initParseForBoards, requireAuth } from '#root/server/utils/boardUtils';
import { getBackupConfig, serializeBackupConfig } from '#root/server/utils/backups';

defineRouteMeta({
  openAPI: {
    tags: ['Backups'],
    summary: 'Get backup settings',
    description: 'Where automatic backups go, how often, and how the last one went. `backup` is null until a destination is connected. Credentials are never returned.',
    responses: { '200': { description: '`{ backup }`' } },
  },
});

export default defineEventHandler(async (event) => {
  initParseForBoards();
  const auth = await requireAuth(event);
  return { success: true, backup: serializeBackupConfig(await getBackupConfig(auth.userId)) };
});
