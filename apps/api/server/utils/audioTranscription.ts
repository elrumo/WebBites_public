/**
 * Turning a saved audio bookmark into a transcript.
 *
 * The Apple apps do this on the device and send the text with the save, so this
 * only runs for the web, the share sheet, an import, and a reader who asked for
 * a transcript after the fact. Either way the result lands in the same two
 * columns, because every reader of a transcript — search, the AI summary, the
 * narrator, the detail sheet — already knows how to read them:
 *
 *   `siteBody`        the plain text, which is what a scraped article fills.
 *   `audioTranscript` the timestamped segments, so the detail sheet can seek.
 *
 * Metered against the same monthly allowance as article narration
 * (`audiosGenerated`): both are one OpenAI audio call per bookmark, and a user
 * who has spent the month's narration has spent the month's transcription.
 */

import Parse from 'parse/node.js';
import { getOpenAIAudio } from '#root/server/utils/aiClients';
import { sendToQstash, getPartitionedQueue } from './serverUtils.js';
import { getUserWithPlan, getAudioQuota } from './plans';
import { ownStorageURL } from './clientMetadata';
import { transcriptionCopy, MAX_AUDIO_BYTES } from './audioFile';

Parse.initialize(
    process.env.VITE_PARSE_ID as string,
    process.env.VITE_PARSE_JS_KEY as string,
    process.env.VITE_PARSE_MASTER_KEY as string
);
Parse.serverURL = process.env.VITE_PARSE_URL as string;

// Built on first use: a deployment without an OpenAI key must still be able to load this module.
let audioClient: ReturnType<typeof getOpenAIAudio> | null = null
const openai = new Proxy({} as ReturnType<typeof getOpenAIAudio>, {
  get: (_target, prop) => Reflect.get((audioClient ??= getOpenAIAudio()) as object, prop),
})

/**
 * whisper-1 rather than the newer `gpt-4o-transcribe`: it is the only one that
 * answers `verbose_json` with segment timestamps, and the timestamps are what
 * makes the transcript in the detail sheet seekable rather than a wall of text.
 */
const TRANSCRIBE_MODEL = 'whisper-1';

/** What `transcriptStatus` on a row can say. */
export type TranscriptStatus = 'none' | 'pending' | 'done' | 'failed' | 'quota';

export interface TranscriptSegment {
    start: number;
    end: number;
    text: string;
}

export interface StoredTranscript {
    language?: string;
    /** Which side made it — the device's own model, or ours. */
    source: 'device' | 'server';
    model?: string;
    segments: TranscriptSegment[];
}

/** The shape a client may send with a save, sanitised before it is stored. */
export function sanitizeTranscript(raw: unknown): { text: string; transcript: StoredTranscript } | null {
    let value: any = raw;
    if (typeof value === 'string') {
        try { value = JSON.parse(value); } catch { return null; }
    }
    if (!value || typeof value !== 'object') return null;

    const segments: TranscriptSegment[] = Array.isArray(value.segments)
        ? value.segments
            .map((segment: any) => ({
                start: Number(segment?.start),
                end: Number(segment?.end),
                text: String(segment?.text ?? '').trim()
            }))
            .filter((segment: TranscriptSegment) =>
                Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.text.length > 0)
            // A transcript is shown, not streamed: a cap keeps one very long
            // recording from making a row nothing can load.
            .slice(0, MAX_SEGMENTS)
        : [];

    const text = String(value.text ?? '').trim()
        || segments.map(segment => segment.text).join(' ').trim();
    if (!text) return null;

    return {
        text: text.slice(0, MAX_TRANSCRIPT_CHARS),
        transcript: {
            language: typeof value.language === 'string' ? value.language.slice(0, 16) : undefined,
            source: value.source === 'server' ? 'server' : 'device',
            model: typeof value.model === 'string' ? value.model.slice(0, 64) : undefined,
            segments
        }
    };
}

const MAX_SEGMENTS = 5000;
/** Matches what `siteBody` holds for a scraped article. */
const MAX_TRANSCRIPT_CHARS = 200000;

/** Writes the transcript columns and nothing else. */
export async function saveTranscript(
    website: Parse.Object, text: string, transcript: StoredTranscript
): Promise<void> {
    website.set('siteBody', text);
    website.set('audioTranscript', transcript);
    website.set('transcriptStatus', 'done' satisfies TranscriptStatus);
    await website.save(null, { useMasterKey: true });
}

/**
 * Transcribe one audio bookmark, in the background.
 *
 * Every exit writes a `transcriptStatus` the clients can act on — `quota` opens
 * the upgrade sheet, `failed` offers a retry — because a transcript that simply
 * never arrives looks identical to one still being made.
 */
export async function transcribeAudioBookmark(websiteId: string, userId: string): Promise<void> {
    let website: Parse.Object | null = null;

    try {
        website = await new Parse.Query('websites').get(websiteId, { useMasterKey: true });
    } catch (error: any) {
        console.error(`[audioTranscription] ${websiteId} could not be loaded:`, error?.message);
        return;
    }
    if (!website) return;

    const mark = async (status: TranscriptStatus) => {
        try {
            website!.set('transcriptStatus', status);
            await website!.save(null, { useMasterKey: true });
        } catch (error: any) {
            console.error(`[audioTranscription] could not mark ${websiteId} as ${status}:`, error?.message);
        }
    };

    try {
        const { user, plan } = await getUserWithPlan(userId);
        if (!user) return void await mark('failed');

        if (getAudioQuota(user, plan).exceeded) {
            console.log(`[audioTranscription] ${userId} has no audio allowance left`);
            return void await mark('quota');
        }

        // Only our own bucket is fetched. The column is written by our own save
        // routes, but this runs from a queue message, so the check is repeated
        // here rather than assumed — it is the same rule `saveUserPdf` adopts a
        // hosted file under.
        const fileUrl = ownStorageURL(website.get('fileUrl') || website.get('file')?.url?.());
        if (!fileUrl) {
            console.error(`[audioTranscription] ${websiteId} has no stored audio to read`);
            return void await mark('failed');
        }

        const response = await fetch(fileUrl);
        if (!response.ok) {
            console.error(`[audioTranscription] ${fileUrl} answered ${response.status}`);
            return void await mark('failed');
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length === 0 || bytes.length > MAX_AUDIO_BYTES) {
            return void await mark('failed');
        }

        const fileName = website.get('fileName') || 'recording.m4a';
        const small = await transcriptionCopy(bytes, fileName);
        if (!small) {
            console.error(`[audioTranscription] ${websiteId} is too long to transcribe in one request`);
            return void await mark('failed');
        }

        const result: any = await openai.audio.transcriptions.create({
            file: new File([new Uint8Array(small.buffer)], small.fileName, { type: 'audio/mp4' }),
            model: TRANSCRIBE_MODEL,
            response_format: 'verbose_json',
            timestamp_granularities: ['segment']
        });

        const segments: TranscriptSegment[] = Array.isArray(result?.segments)
            ? result.segments
                .map((segment: any) => ({
                    start: Math.round(Number(segment?.start) * 100) / 100,
                    end: Math.round(Number(segment?.end) * 100) / 100,
                    text: String(segment?.text ?? '').trim()
                }))
                .filter((segment: TranscriptSegment) =>
                    Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.text)
                .slice(0, MAX_SEGMENTS)
            : [];

        const text = String(result?.text ?? '').trim()
            || segments.map(segment => segment.text).join(' ').trim();

        if (!text) {
            // Silence, or a recording with nothing said in it. Not a failure to
            // retry — there is nothing there to find on a second pass.
            console.log(`[audioTranscription] ${websiteId} had nothing to transcribe`);
            return void await mark('none');
        }

        await saveTranscript(website, text.slice(0, MAX_TRANSCRIPT_CHARS), {
            language: typeof result?.language === 'string' ? result.language.slice(0, 16) : undefined,
            source: 'server',
            model: TRANSCRIBE_MODEL,
            segments
        });

        // Counted once the transcript is stored, not before: a failed call has
        // cost the user nothing they can hear.
        sendToQstash(
            {
                type: 'update-usage',
                data: { typeOfUsage: 'audiosGenerated', userId, subOrAdd: 'add', number: 1 }
            },
            { isBatch: false, queueName: getPartitionedQueue('updateUsage') }
        ).catch((error: any) =>
            console.error('[audioTranscription] usage update failed:', error?.message));

        console.log(`[audioTranscription] ${websiteId}: ${segments.length} segments, ${text.length} chars`);
    } catch (error: any) {
        console.error(`[audioTranscription] ${websiteId} failed:`, error?.message || error);
        await mark('failed');
    }
}

/** Puts a bookmark in the queue to be transcribed, and says so on the row. */
export async function queueTranscription(website: Parse.Object, userId: string): Promise<void> {
    website.set('transcriptStatus', 'pending' satisfies TranscriptStatus);
    await website.save(null, { useMasterKey: true });
    await sendToQstash(
        { type: 'audio-transcribe-requests', data: { websiteId: website.id, userId } },
        { isBatch: false, queueName: getPartitionedQueue('getBookmarkContent') }
    );
}
