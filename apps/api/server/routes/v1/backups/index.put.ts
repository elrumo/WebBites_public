import { defineEventHandler, readBody, createError } from 'h3';
import { initParseForBoards, requireAuth } from '#root/server/utils/boardUtils';
import {
  backupsRefusal, requireBackupConfig, saveBackupDestination, serializeBackupConfig,
} from '#root/server/utils/backups';
import { BACKUP_FREQUENCIES, nextRunAfter, type BackupFrequency } from '#root/server/utils/backupFormat';
import { normalizeS3Secret, s3Label, testS3Destination } from '#root/server/utils/backupDestinations';

defineRouteMeta({
  openAPI: {
    tags: ['Backups'],
    summary: 'Update backup settings',
    description: 'Send `s3` to point backups at an S3-compatible bucket (the keys are tested with a small write before saving). `frequency` and `enabled` change the schedule. Google Drive and Dropbox connect through `POST /v1/backups/connect/{provider}`. Turning backups on needs Plus; turning them off always works.',
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              s3: {
                type: 'object',
                properties: {
                  endpoint: { type: 'string', example: 'https://s3.eu-west-1.amazonaws.com' },
                  region: { type: 'string', example: 'eu-west-1' },
                  bucket: { type: 'string' },
                  prefix: { type: 'string', example: 'webbites/' },
                  accessKey: { type: 'string' },
                  secretKey: { type: 'string' },
                },
              },
              frequency: { type: 'string', enum: [...BACKUP_FREQUENCIES] },
              enabled: { type: 'boolean' },
            },
          },
        },
      },
    },
    responses: { '200': { description: '`{ backup }`' }, '400': { description: 'Invalid settings or the bucket refused the test write' }, '403': { description: 'UsageError: needs Plus' } },
  },
});

export default defineEventHandler(async (event) => {
  initParseForBoards();
  const auth = await requireAuth(event);
  const body = (await readBody(event).catch(() => ({}))) || {};

  if (body.s3 || body.enabled === true) {
    const refusal = await backupsRefusal(event, auth.userId);
    if (refusal) return refusal;
  }

  let row;
  if (body.s3) {
    const secret = normalizeS3Secret(body.s3);
    await testS3Destination(secret);
    row = await saveBackupDestination(auth.userId, 's3', secret, s3Label(secret));
  } else {
    row = await requireBackupConfig(auth.userId);
  }

  if (body.frequency !== undefined) {
    if (!BACKUP_FREQUENCIES.includes(body.frequency)) {
      throw createError({ statusCode: 400, statusMessage: `frequency must be one of: ${BACKUP_FREQUENCIES.join(', ')}` });
    }
    const frequency = body.frequency as BackupFrequency;
    // Reschedule from the last backup; a run in progress keeps its lease.
    if (frequency !== row.get('frequency') && !row.get('run') && row.get('lastSuccessAt')) {
      row.set('nextRunAt', nextRunAfter(row.get('lastSuccessAt'), frequency));
    }
    row.set('frequency', frequency);
  }

  if (typeof body.enabled === 'boolean') {
    if (body.enabled && row.get('needsReconnect')) {
      throw createError({ statusCode: 400, statusMessage: 'Reconnect your backup destination first' });
    }
    row.set('enabled', body.enabled);
  }

  await row.save(null, { useMasterKey: true });
  return { success: true, backup: serializeBackupConfig(row) };
});
