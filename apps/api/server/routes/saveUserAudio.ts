/**
 * Saving audio as a bookmark — a recording made in one of our apps, or a file
 * the user already had.
 *
 * The sibling of `saveUserPdf`, and built from it: same ways in, same quota
 * check, same `ownStorageURL` adoption of a file a client uploaded itself. What
 * differs is what a recording needs that a document does not.
 *
 *   normalising  a browser hands `MediaRecorder` back WebM/Opus, which no Apple
 *                player will open. Everything that is not already AAC or MP3 is
 *                transcoded to `.m4a` here, once — see `audioFile`.
 *   no cover     there is nothing to render. The card draws the waveform from
 *                `audioPeaks` instead of an `OGImage`.
 *   transcripts  the Apple apps transcribe on the device and send the text with
 *                the save; everyone else gets a queued job. Either way it lands
 *                in `siteBody`, the column search and the AI summary read.
 *
 * Ways in, exactly as the document route has them:
 *
 *   upload   → multipart `file` parts, or a base64 `file` for the JSON callers.
 *   hosted   → `fileUrl`, audio the caller already put in our own storage. The
 *              native apps upload to Parse themselves so a dropped packet costs
 *              a retry rather than a 40MB re-send.
 */

import { defineEventHandler, getHeader, readBody, readMultipartFormData } from 'h3';
import Parse from 'parse/node.js';
import { createFileName } from '#root/server/utils/serverUtils.js';
import { getUserWithPlan, getBookmarkQuota } from '#root/server/utils/plans';
import { ownStorageURL } from '#root/server/utils/clientMetadata';
import {
    isAudioBytes,
    looksLikeAudioName,
    normalizeAudio,
    audioPeaks as readPeaks,
    probeAudio,
    titleFromAudioFileName,
    voiceNoteTitle,
    AUDIO_UPLOAD_TYPES,
    MAX_AUDIO_BYTES
} from '#root/server/utils/audioFile';
import { sanitizeTranscript, queueTranscription } from '#root/server/utils/audioTranscription';
import { resolveActingUserId } from '#root/server/utils/requireUser';

Parse.initialize(process.env.VITE_PARSE_ID, process.env.VITE_PARSE_JS_KEY, process.env.VITE_PARSE_MASTER_KEY);
Parse.serverURL = process.env.VITE_PARSE_URL;

const Websites = Parse.Object.extend('websites');

interface SaveUserAudioBody {
    userId: string;
    /** A base64 data URL, for callers that cannot send multipart. */
    file?: string;
    fileName?: string;
    tags?: string[];
    customId?: string;
    savedFrom?: string;
    pageTitle?: string;
    siteNotes?: string;
    /** Seconds. The client measured it; we only re-read it when it didn't. */
    duration?: number | string;
    /** 0..1 bars for the card's waveform, as an array or a JSON string. */
    peaks?: number[] | string;
    /** Recorded in one of our apps, rather than picked from a file. */
    isVoiceNote?: boolean | string;
    /** A transcript the device already made — `{text, language, segments}`. */
    transcript?: unknown;
    /** Audio already in our own storage, uploaded by the caller. */
    fileUrl?: string;
}

defineRouteMeta({
    openAPI: {
        tags: ['Bookmarks'],
        description: 'Save audio as a bookmark, either uploaded directly or already in our storage',
        requestBody: {
            description: 'An audio upload (multipart/form-data) or a hosted file URL (JSON)',
            required: true,
            content: {
                'multipart/form-data': {
                    schema: {
                        type: 'object',
                        required: ['userId'],
                        properties: {
                            file: { type: 'string', format: 'binary', description: 'The audio to upload' },
                            userId: { type: 'string' },
                            fileName: { type: 'string' },
                            duration: { type: 'number', description: 'Seconds' },
                            peaks: { type: 'string', description: 'JSON array of 0..1 waveform bars' },
                            isVoiceNote: { type: 'boolean' },
                            transcript: { type: 'string', description: 'JSON {text, language, segments}' },
                            tags: { type: 'string', description: 'JSON array or comma-separated list' },
                            customId: { type: 'string' },
                            savedFrom: { type: 'string' },
                            pageTitle: { type: 'string' }
                        }
                    }
                },
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['userId'],
                        properties: {
                            userId: { type: 'string' },
                            fileUrl: { type: 'string', description: 'Audio already uploaded to our own storage' },
                            file: { type: 'string', description: 'A base64 data URL holding the audio' },
                            fileName: { type: 'string' },
                            duration: { type: 'number' },
                            peaks: { type: 'array', items: { type: 'number' } },
                            isVoiceNote: { type: 'boolean' },
                            transcript: { type: 'object' },
                            tags: { type: 'array', items: { type: 'string' } },
                            customId: { type: 'string' },
                            savedFrom: { type: 'string' },
                            pageTitle: { type: 'string' }
                        }
                    }
                }
            }
        },
        responses: {
            '200': {
                description: 'Saved, or refused with a reason the caller can act on',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                status: { type: 'number', example: 200 },
                                objectId: { type: 'string' },
                                fileUrl: { type: 'string' },
                                duration: { type: 'number' },
                                transcriptStatus: { type: 'string' }
                            }
                        }
                    }
                }
            }
        }
    }
});

function partToBuffer(data: unknown): Buffer {
    if (Buffer.isBuffer(data)) return data;
    if (data instanceof ArrayBuffer) return Buffer.from(data);
    if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    return Buffer.from(String(data), 'utf8');
}

/** Tags arrive as a JSON array, a comma-separated string, or repeated parts. */
function parseTags(raw: string[] | undefined): string[] {
    if (!raw || raw.length === 0) return [];
    if (raw.length > 1) return raw.map(String);
    try {
        const parsed = JSON.parse(raw[0]);
        if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
        // not JSON; fall through to the comma-separated reading
    }
    return raw[0].split(',').map(tag => tag.trim()).filter(Boolean);
}

/** The waveform the client drew, as an array or the JSON string of one. */
function parsePeaks(raw: unknown): number[] | null {
    let value: any = raw;
    if (typeof value === 'string') {
        try { value = JSON.parse(value); } catch { return null; }
    }
    if (!Array.isArray(value)) return null;
    const peaks = value
        .map((peak: any) => Number(peak))
        .filter((peak: number) => Number.isFinite(peak))
        .map((peak: number) => Math.min(1, Math.max(0, Math.round(peak * 1000) / 1000)))
        .slice(0, 256);
    return peaks.length > 0 ? peaks : null;
}

const truthy = (value: unknown): boolean =>
    value === true || value === 'true' || value === '1' || value === 1;

/** Every part name a picker or a FormData might use for the file itself. */
const FILE_PART_NAMES = ['file', 'files', 'file[]', 'files[]', 'audio', 'recording', 'upload'];

export default defineEventHandler(async (event) => {
    try {
        const contentType = (getHeader(event, 'content-type') || '').toLowerCase();

        let body: SaveUserAudioBody | null = null;
        let bytes: Buffer | null = null;
        let uploadedName: string | undefined;

        if (contentType.includes('multipart/form-data')) {
            const parts = (await readMultipartFormData(event)) || [];
            const text = (name: string) => {
                const part = parts.find(p => p.name === name);
                return part ? partToBuffer(part.data).toString('utf8') : undefined;
            };

            // One recording per bookmark. Several files are several bites, split
            // by the caller — the same rule a document follows, for the same
            // reason: each has its own title, length and transcript.
            const filePart = parts.find(p => p.name && FILE_PART_NAMES.includes(p.name) && p.filename);
            if (filePart) {
                const partType = (filePart.type || '').toLowerCase().split(';')[0].trim();
                if (!AUDIO_UPLOAD_TYPES.has(partType) && !looksLikeAudioName(filePart.filename)) {
                    return { error: 'That file is not audio', status: 415 };
                }
                bytes = partToBuffer(filePart.data);
                uploadedName = filePart.filename;
            }

            body = {
                userId: text('userId') || '',
                fileName: text('fileName') || undefined,
                tags: parseTags(parts.filter(p => p.name === 'tags' || p.name === 'tags[]')
                    .map(p => partToBuffer(p.data).toString('utf8')).filter(Boolean)),
                customId: text('customId') || undefined,
                savedFrom: text('savedFrom') || undefined,
                pageTitle: text('pageTitle') || undefined,
                siteNotes: text('siteNotes') || undefined,
                duration: text('duration'),
                peaks: text('peaks'),
                isVoiceNote: text('isVoiceNote'),
                transcript: text('transcript'),
                fileUrl: text('fileUrl') || undefined
            };
        } else {
            body = await readBody<SaveUserAudioBody>(event);

            if (body?.file) {
                const base64 = body.file.includes(',') ? body.file.split(',')[1] : body.file;
                try {
                    bytes = Buffer.from(base64, 'base64');
                } catch {
                    return { error: 'Could not read the uploaded audio', status: 400 };
                }
            }
        }

        if (!body) return { error: 'Missing required fields', status: 400 };

        // Only internal callers may name another user; see resolveActingUserId.
        body.userId = await resolveActingUserId(event, body.userId);

        // Audio the caller already put in our own storage. Validated the same
        // way an adopted document is: anything that is not ours is dropped
        // rather than fetched, which is what stops this being a way to make the
        // server request an arbitrary URL.
        const hostedUrl = body.fileUrl ? ownStorageURL(body.fileUrl.trim()) : null;

        if (!bytes && !hostedUrl) return { error: 'Missing audio input', status: 400 };

        if (bytes) {
            if (bytes.length === 0) return { error: 'Empty audio file', status: 400 };
            if (bytes.length > MAX_AUDIO_BYTES) {
                return {
                    error: `Audio is limited to ${Math.round(MAX_AUDIO_BYTES / (1024 * 1024))}MB`,
                    status: 413
                };
            }
            // An upload gets the same check a document gets: the extension and
            // the content type are both things a client chose, neither is the
            // file.
            if (!isAudioBytes(bytes)) return { error: 'That file is not audio', status: 415 };
        }

        let user: Parse.Object;
        let plan: Parse.Object | null;
        try {
            ({ user, plan } = await getUserWithPlan(body.userId));
        } catch (error: any) {
            console.error('[saveUserAudio] Could not load the user:', error?.message);
            return { error: 'User not found', status: 404 };
        }
        if (!user) return { error: 'User not found', status: 404 };

        if (getBookmarkQuota(user, plan).exceeded) {
            return {
                error: 'You have reached your website limit. Upgrade your account to save more bookmarks.',
                status: 402
            };
        }

        const isVoiceNote = truthy(body.isVoiceNote);
        let fileName = body.fileName || uploadedName
            || (hostedUrl ? decodeURIComponent(hostedUrl.split('/').pop() || '') : '')
            || 'recording.m4a';

        // A recording the client made is already AAC on every platform that can
        // send one; a browser's is not, and an upload is whatever the user had.
        // Only bytes we hold get normalised — adopting a hosted file means
        // trusting the client that put it there, which is the whole point of
        // not making it send them twice.
        let storedUrl = hostedUrl || '';
        let storedType = 'audio/mp4';
        let duration = Number(body.duration);
        let peaks = parsePeaks(body.peaks);
        let audioFile: Parse.File | null = null;

        if (bytes) {
            const normalized = await normalizeAudio(bytes, fileName);
            bytes = normalized.buffer;
            storedType = normalized.contentType;
            if (normalized.transcoded) {
                fileName = fileName.replace(/\.[^.]+$/, '') + '.m4a';
                // A re-encode moves every timestamp the client measured by a
                // frame or two, and the peaks were drawn from the original.
                // Cheap to re-read here, and wrong to keep.
                duration = normalized.durationSeconds ?? duration;
            } else if (!Number.isFinite(duration) || duration <= 0) {
                duration = normalized.durationSeconds
                    ?? (await probeAudio(bytes, normalized.extension)).durationSeconds
                    ?? NaN;
            }

            if (!peaks) peaks = await readPeaks(bytes, fileName);

            try {
                audioFile = new Parse.File(
                    createFileName(body.userId, fileName.replace(/\.[^.]+$/, ''), normalized.extension, 'saveUserAudio'),
                    { base64: bytes.toString('base64') },
                    storedType
                );
                await audioFile.save({ useMasterKey: true });
                storedUrl = audioFile.url() || '';
            } catch (error: any) {
                console.error('[saveUserAudio] Could not store the audio:', error);
                return { error: 'Failed to save the audio', details: error.message, status: 500 };
            }
            if (!storedUrl) return { error: 'Failed to save the audio', status: 500 };
        }

        // Best name first: what the user typed, then the filename made readable,
        // and for a recording with neither, the moment it was made.
        const title = body.pageTitle?.trim()
            || (isVoiceNote && !body.fileName ? voiceNoteTitle() : '')
            || titleFromAudioFileName(fileName)
            || fileName;

        const device = sanitizeTranscript(body.transcript);

        const website = new Websites();
        try {
            website.setACL(new Parse.ACL(user));
            website.set('user', user);
            website.set('type', 'audio');
            // No `'audio'` here, unlike the PDF route's `subType: ['pdf']`:
            // that one exists for readers that predate the type, and an audio
            // bite has none — every client that knows about one switches on
            // `type`. A redundant entry would only show up as a second "Audio"
            // chip beside the type in the details panel.
            website.set('subType', isVoiceNote ? ['voiceNote'] : []);
            website.set('customId', body.customId || null);
            website.set('savedFrom', body.savedFrom || '');
            website.set('tags', Array.isArray(body.tags) ? body.tags : []);
            if (body.siteNotes) website.set('siteNotes', body.siteNotes);

            // A recording has no original to go back to, so our copy is the
            // bookmark's URL — the same thing an uploaded document does.
            website.set('url', storedUrl);
            try {
                website.set('baseUrl', new URL(storedUrl).origin);
            } catch {
                website.set('baseUrl', null);
            }

            website.set('siteTitle', title);
            website.set('fileName', fileName);
            if (audioFile) website.set('file', audioFile);
            website.set('fileUrl', storedUrl);
            if (Number.isFinite(duration) && duration > 0) {
                website.set('audioDuration', Math.round(duration * 10) / 10);
            }
            if (peaks) website.set('audioPeaks', peaks);

            if (device) {
                website.set('siteBody', device.text);
                website.set('audioTranscript', device.transcript);
                website.set('transcriptStatus', 'done');
            } else {
                website.set('transcriptStatus', 'pending');
            }

            await website.save(null, { useMasterKey: true });
        } catch (error: any) {
            console.error('[saveUserAudio] Could not save the bookmark:', error);
            return { error: 'Failed to save bookmark', details: error.message, status: 500 };
        }

        try {
            const relation = user.relation('savedSites');
            relation.add(website);
            await user.save(null, { useMasterKey: true });
        } catch (error) {
            console.error('[saveUserAudio] Could not add the bookmark to the user:', error);
        }

        // Nothing to queue when the device already did the work — which is the
        // Apple apps' whole path, and the one that costs the user no allowance.
        if (!device) {
            try {
                await queueTranscription(website, user.id);
            } catch (error: any) {
                console.error('[saveUserAudio] Could not queue the transcript:', error?.message);
                website.set('transcriptStatus', 'failed');
                await website.save(null, { useMasterKey: true }).catch(() => {});
            }
        }

        console.log(`[saveUserAudio] Saved ${fileName} (${Math.round(duration || 0)}s) for ${body.userId}`);

        return {
            status: 200,
            objectId: website.id,
            fileUrl: storedUrl,
            fileName,
            duration: Number.isFinite(duration) ? duration : null,
            transcriptStatus: website.get('transcriptStatus'),
            title,
            message: 'Audio saved successfully'
        };
    } catch (error: any) {
        console.error('[saveUserAudio] Unexpected error:', error);
        return { error: 'Internal server error', details: error.message, status: 500 };
    }
});
