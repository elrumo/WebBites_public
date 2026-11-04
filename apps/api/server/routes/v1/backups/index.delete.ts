import { defineEventHandler } from 'h3';
import { initParseForBoards, requireAuth } from '#root/server/utils/boardUtils';
import { getBackupConfig } from '#root/server/utils/backups';

defineRouteMeta({
  openAPI: {
    tags: ['Backups'],
    summary: 'Disconnect backups',
    description: 'Forgets the destination and its credentials and stops scheduled backups. Backups already written stay where they are.',
    responses: { '200': { description: 'Disconnected' } },
  },
});

export default defineEventHandler(async (event) => {
  initParseForBoards();
  const auth = await requireAuth(event);
  const row = await getBackupConfig(auth.userId);
  if (row) await row.destroy({ useMasterKey: true });
  return { success: true, backup: null };
});
