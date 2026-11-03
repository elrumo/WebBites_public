/**
 * Reading, checking and normalising an audio file on its way into a bookmark.
 *
 * The sibling of `pdfUrl` + `pdfDocument`, split the same way: the pure checks
 * (magic bytes, size, extension) run everywhere and cost nothing, and the
 * ffmpeg calls only run once something has already been accepted.
 *
 * Normalisation exists because the four clients record four different things.
 * Chrome and Firefox hand `MediaRecorder` back WebM/Opus, Safari gives MP4/AAC,
 * the Apple apps write M4A/AAC, and an upload is whatever the user had. WebM is
 * the problem: `AVPlayer` on iOS, macOS and watchOS cannot play it at all, so a
 * voice note recorded in Chrome would be a silent card on every Apple client.
 * Rather than teach four players about five containers, anything that is not
 * already AAC or MP3 is transcoded to `.m4a` here, once, on the way in.
 *
 * ffmpeg is in the runtime image (see Dockerfile). When it is missing —
 * a bare `bun run dev` on a machine without it — {@link normalizeAudio} keeps
 * the original bytes and says so, rather than refusing the upload.
 */

import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

const run = promisify(execFile);

/**
 * A cap on what we will store for one bookmark.
 *
 * Twice the PDF cap: a 100MB M4A is roughly 2.5 hours of spoken audio at the
 * bitrate a phone records at, which is a long meeting rather than a voice note,
 * and past that the transcription cost stops being worth the row.
 */
export const MAX_AUDIO_BYTES = 100 * 1024 * 1024;

/** Content types a client sends for audio. The bytes decide, but these gate. */
export const AUDIO_UPLOAD_TYPES = new Set([
    'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac',
    'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave',
    'audio/ogg', 'audio/opus', 'audio/webm', 'audio/flac', 'audio/x-flac',
    'video/mp4', 'video/webm',
    'application/octet-stream', ''
]);

/** Extensions we accept when the content type is useless, which is often. */
const AUDIO_EXTENSION = /\.(mp3|m4a|mp4|aac|wav|ogg|oga|opus|webm|flac|caf|aiff?)$/i;

export function looksLikeAudioName(fileName: string | undefined | null): boolean {
    return AUDIO_EXTENSION.test(String(fileName || ''));
}

/**
 * Whether these bytes are audio we can read, by container signature.
 *
 * Neither the extension nor the content type is the file — both are things a
 * client chose — so this is what actually gates an upload, exactly as
 * `isPdfBytes` does for a document.
 */
export function isAudioBytes(buffer: Buffer | null | undefined): boolean {
    if (!buffer || buffer.length < 12) return false;

    // ID3v2-tagged MP3.
    if (buffer.subarray(0, 3).toString('latin1') === 'ID3') return true;
    // A bare MPEG audio frame: 11 sync bits, and a layer that is not reserved.
    if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0 && (buffer[1] & 0x06) !== 0x00) return true;
    // ISO base media (M4A, MP4, CAF-in-MP4): `....ftyp` at byte 4.
    if (buffer.subarray(4, 8).toString('latin1') === 'ftyp') return true;
    // RIFF....WAVE
    if (buffer.subarray(0, 4).toString('latin1') === 'RIFF'
        && buffer.subarray(8, 12).toString('latin1') === 'WAVE') return true;
    // Ogg (Vorbis or Opus).
    if (buffer.subarray(0, 4).toString('latin1') === 'OggS') return true;
    // Matroska / WebM.
    if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return true;
    // FLAC.
    if (buffer.subarray(0, 4).toString('latin1') === 'fLaC') return true;
    // Apple CAF, and AIFF.
    if (buffer.subarray(0, 4).toString('latin1') === 'caff') return true;
    if (buffer.subarray(0, 4).toString('latin1') === 'FORM'
        && buffer.subarray(8, 12).toString('latin1').startsWith('AIF')) return true;

    return false;
}

/** `meeting notes.m4a` -> `meeting notes`, the PDF title rule verbatim. */
export function titleFromAudioFileName(fileName: string): string {
    const stem = String(fileName || '').replace(AUDIO_EXTENSION, '');
    const spaced = stem.replace(/_/g, ' ').trim();
    return spaced || fileName;
}

/** What a recording with no name of its own is called. */
export function voiceNoteTitle(when: Date = new Date()): string {
    const date = when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const time = when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return `Voice note · ${date}, ${time}`;
}

// ── ffmpeg ───────────────────────────────────────────────────────────────────

let ffmpegChecked: boolean | null = null;

/** Whether ffmpeg is on this machine. Asked once, then remembered. */
export async function hasFfmpeg(): Promise<boolean> {
    if (ffmpegChecked !== null) return ffmpegChecked;
    try {
        await run('ffmpeg', ['-version'], { timeout: 5000 });
        ffmpegChecked = true;
    } catch {
        console.warn('[audioFile] ffmpeg is not installed; audio is stored as uploaded');
        ffmpegChecked = false;
    }
    return ffmpegChecked;
}

/** Runs `work` with the bytes on disk, and takes the scratch directory away after. */
async function withTempFile<T>(
    buffer: Buffer, extension: string, work: (file: string, dir: string) => Promise<T>
): Promise<T> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'webbites-audio-'));
    const file = path.join(dir, `input.${extension}`);
    try {
        await fs.writeFile(file, buffer);
        return await work(file, dir);
    } finally {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
}

export interface AudioProbe {
    /** `aac`, `mp3`, `opus`, `pcm_s16le`, … as ffprobe names it. */
    codec?: string;
    /** Seconds, or undefined for a stream ffprobe could not measure. */
    durationSeconds?: number;
}

/** What ffprobe makes of these bytes. Empty when ffmpeg is not installed. */
export async function probeAudio(buffer: Buffer, extension = 'bin'): Promise<AudioProbe> {
    if (!(await hasFfmpeg())) return {};
    try {
        return await withTempFile(buffer, extension, async (file) => {
            const { stdout } = await run('ffprobe', [
                '-v', 'error',
                '-select_streams', 'a:0',
                '-show_entries', 'stream=codec_name:format=duration',
                '-of', 'json',
                file
            ], { timeout: 60000, maxBuffer: 1024 * 1024 });

            const parsed = JSON.parse(stdout);
            const duration = Number(parsed?.format?.duration);
            return {
                codec: parsed?.streams?.[0]?.codec_name || undefined,
                durationSeconds: Number.isFinite(duration) && duration > 0
                    ? Math.round(duration * 10) / 10
                    : undefined
            };
        });
    } catch (error: any) {
        console.warn('[audioFile] Could not probe the audio:', error?.message);
        return {};
    }
}

export interface NormalizedAudio {
    buffer: Buffer;
    extension: string;
    contentType: string;
    durationSeconds?: number;
    /** True when the bytes were re-encoded rather than kept as they arrived. */
    transcoded: boolean;
}

/** Codecs every client can already play, in a container they can already open. */
const PLAYABLE_CODECS = new Set(['aac', 'mp3']);

/**
 * The file as it should be stored: AAC or MP3 kept as they are, everything else
 * re-encoded to `.m4a`.
 *
 * A WebM/Opus recording is the case that matters — Chrome and Firefox produce
 * it and no Apple player will touch it — but the same pass rescues Ogg, FLAC
 * and a WAV that would otherwise cost ten times its own size in storage.
 */
export async function normalizeAudio(buffer: Buffer, fileName: string): Promise<NormalizedAudio> {
    const extension = (fileName.match(AUDIO_EXTENSION)?.[1] || 'bin').toLowerCase();
    const probe = await probeAudio(buffer, extension);

    const alreadyPlayable = probe.codec
        ? PLAYABLE_CODECS.has(probe.codec) && extension !== 'webm' && extension !== 'ogg'
        // No ffmpeg to ask: trust the container, which is all we have.
        : ['mp3', 'm4a', 'mp4', 'aac'].includes(extension);

    if (alreadyPlayable || !(await hasFfmpeg())) {
        return {
            buffer,
            extension: extension === 'bin' ? 'm4a' : extension,
            contentType: extension === 'mp3' ? 'audio/mpeg' : 'audio/mp4',
            durationSeconds: probe.durationSeconds,
            transcoded: false
        };
    }

    try {
        const converted = await withTempFile(buffer, extension, async (file, dir) => {
            const output = path.join(dir, 'output.m4a');
            await run('ffmpeg', [
                '-v', 'error', '-y',
                '-i', file,
                // Drop any cover art or video track: a WebM from a browser can
                // carry one, and it would make this a video file.
                '-vn',
                '-c:a', 'aac', '-b:a', '96k',
                // Lets a player start before the whole file has arrived.
                '-movflags', '+faststart',
                output
            ], { timeout: 10 * 60 * 1000 });
            return await fs.readFile(output);
        });

        return {
            buffer: converted,
            extension: 'm4a',
            contentType: 'audio/mp4',
            durationSeconds: probe.durationSeconds ?? (await probeAudio(converted, 'm4a')).durationSeconds,
            transcoded: true
        };
    } catch (error: any) {
        // A file ffmpeg refuses is still a file the browser that recorded it can
        // play. Keeping it beats losing the recording.
        console.warn('[audioFile] Could not transcode; storing as uploaded:', error?.message);
        return {
            buffer,
            extension: extension === 'bin' ? 'm4a' : extension,
            contentType: 'audio/mp4',
            durationSeconds: probe.durationSeconds,
            transcoded: false
        };
    }
}

/** What the transcription API will accept in one request. */
export const OPENAI_UPLOAD_LIMIT = 25 * 1024 * 1024;

/**
 * A small copy to send to the transcription API.
 *
 * OpenAI refuses an upload over 25MB, and a stored recording is stereo at 96kbps
 * because that is what it should sound like — neither of which transcription
 * needs. 32kbps mono at 16kHz is what speech recognition actually reads, and it
 * puts about 100 minutes under the cap.
 *
 * ponytail: no chunking — a recording longer than the cap survives is refused
 * rather than split. Split it at silence boundaries if anyone hits it.
 */
export async function transcriptionCopy(
    buffer: Buffer, fileName: string
): Promise<{ buffer: Buffer; fileName: string } | null> {
    const extension = (fileName.match(AUDIO_EXTENSION)?.[1] || 'm4a').toLowerCase();

    if (!(await hasFfmpeg())) {
        return buffer.length <= OPENAI_UPLOAD_LIMIT ? { buffer, fileName } : null;
    }

    try {
        const small = await withTempFile(buffer, extension, async (file, dir) => {
            const output = path.join(dir, 'speech.m4a');
            await run('ffmpeg', [
                '-v', 'error', '-y',
                '-i', file,
                '-vn', '-ac', '1', '-ar', '16000',
                '-c:a', 'aac', '-b:a', '32k',
                output
            ], { timeout: 10 * 60 * 1000 });
            return await fs.readFile(output);
        });
        return small.length <= OPENAI_UPLOAD_LIMIT ? { buffer: small, fileName: 'speech.m4a' } : null;
    } catch (error: any) {
        console.warn('[audioFile] Could not downmix for transcription:', error?.message);
        return buffer.length <= OPENAI_UPLOAD_LIMIT ? { buffer, fileName } : null;
    }
}

/**
 * The card's waveform, when the client did not send one.
 *
 * Bars come from the client normally — it has the decoded samples already — so
 * this only runs for a file that arrived from a share sheet or an import. The
 * shape is what a reader recognises the recording by, not a measurement, so a
 * coarse RMS over the decoded PCM is enough.
 */
export async function audioPeaks(buffer: Buffer, fileName: string, bars = 64): Promise<number[] | null> {
    if (!(await hasFfmpeg())) return null;
    const extension = (fileName.match(AUDIO_EXTENSION)?.[1] || 'm4a').toLowerCase();

    try {
        const pcm = await withTempFile(buffer, extension, async (file, dir) => {
            const output = path.join(dir, 'peaks.raw');
            await run('ffmpeg', [
                '-v', 'error', '-y',
                '-i', file,
                '-vn', '-ac', '1', '-ar', '8000',
                '-f', 's16le', output
            ], { timeout: 5 * 60 * 1000 });
            return await fs.readFile(output);
        });

        const samples = Math.floor(pcm.length / 2);
        if (samples < bars) return null;

        const perBar = Math.floor(samples / bars);
        const peaks: number[] = [];
        for (let bar = 0; bar < bars; bar++) {
            let sum = 0;
            for (let i = 0; i < perBar; i++) {
                const value = pcm.readInt16LE((bar * perBar + i) * 2) / 32768;
                sum += value * value;
            }
            peaks.push(Math.round(Math.sqrt(sum / perBar) * 1000) / 1000);
        }

        // Scaled to the loudest bar: a quiet recording should still draw a
        // waveform rather than a flat line.
        const loudest = Math.max(...peaks);
        if (!(loudest > 0)) return null;
        return peaks.map(peak => Math.round((peak / loudest) * 1000) / 1000);
    } catch (error: any) {
        console.warn('[audioFile] Could not read the waveform:', error?.message);
        return null;
    }
}
