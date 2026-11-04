/**
 * Tests for reading an audio file. The containers are built inline rather than
 * checked in as fixtures — every one of these is a header, not a recording.
 * The ffmpeg-backed functions are exercised only when ffmpeg is installed, so
 * this passes on a machine without it. Run with:
 *
 *   npm run test:audioFile
 */

import {
    isAudioBytes,
    looksLikeAudioName,
    titleFromAudioFileName,
    voiceNoteTitle,
    normalizeAudio,
    probeAudio,
    audioPeaks,
    hasFfmpeg,
    MAX_AUDIO_BYTES
} from './audioFile';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.error(`  FAIL ${name}`); }
};

/** `bytes` at the front, zero-padded out to a readable length. */
const header = (...parts: (string | number[])[]): Buffer => {
    const chunks = parts.map(part => Buffer.isBuffer(part)
        ? part
        : typeof part === 'string' ? Buffer.from(part, 'latin1') : Buffer.from(part));
    return Buffer.concat([...chunks, Buffer.alloc(64)]);
};

console.log('\nContainer signatures');

check('ID3-tagged MP3', isAudioBytes(header('ID3', [0x04, 0x00])));
check('bare MPEG frame', isAudioBytes(header([0xff, 0xfb, 0x90, 0x44])));
check('M4A (ftyp at byte 4)', isAudioBytes(header([0, 0, 0, 0x20], 'ftypM4A ')));
check('MP4', isAudioBytes(header([0, 0, 0, 0x18], 'ftypmp42')));
check('WAV', isAudioBytes(header('RIFF', [0x24, 0, 0, 0], 'WAVEfmt ')));
check('Ogg', isAudioBytes(header('OggS', [0x00, 0x02])));
check('WebM', isAudioBytes(header([0x1a, 0x45, 0xdf, 0xa3])));
check('FLAC', isAudioBytes(header('fLaC', [0x00, 0x00, 0x00, 0x22])));
check('CAF', isAudioBytes(header('caff', [0x00, 0x01])));
check('AIFF', isAudioBytes(header('FORM', [0, 0, 0x10, 0], 'AIFF')));

console.log('\nWhat is not audio');

// The two that matter: a PDF and an HTML error page both reach this check
// wearing an audio filename, because that is what a wrong upload looks like.
check('a PDF is refused', !isAudioBytes(header('%PDF-1.7')));
check('an HTML login page is refused', !isAudioBytes(header('<!DOCTYPE html><html>')));
check('a PNG is refused', !isAudioBytes(header([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
check('empty is refused', !isAudioBytes(Buffer.alloc(0)));
check('too short to tell is refused', !isAudioBytes(Buffer.from([0xff, 0xfb])));
check('null is refused', !isAudioBytes(null));
// An MPEG sync word with a reserved layer is not a frame — this is the check
// that keeps `0xff 0xe0`-prefixed junk out.
check('reserved MPEG layer is refused', !isAudioBytes(header([0xff, 0xe1, 0x00, 0x00])));

console.log('\nNames');

check('.m4a is audio', looksLikeAudioName('recording.m4a'));
check('.MP3 is audio (case)', looksLikeAudioName('Podcast.MP3'));
check('.webm is audio', looksLikeAudioName('voice.webm'));
check('.pdf is not', !looksLikeAudioName('paper.pdf'));
check('no extension is not', !looksLikeAudioName('recording'));
check('undefined is not', !looksLikeAudioName(undefined));

check('title drops the extension', titleFromAudioFileName('Team sync.m4a') === 'Team sync');
check('title un-snakes', titleFromAudioFileName('team_sync_notes.mp3') === 'team sync notes');
check('title keeps a nameless file', titleFromAudioFileName('.m4a') === '.m4a');
check('voice note title names the day', /^Voice note · \d+ \w+, \d{2}:\d{2}$/.test(voiceNoteTitle(new Date('2026-09-16T14:03:00'))));

check('cap is 100MB', MAX_AUDIO_BYTES === 100 * 1024 * 1024);

// ── ffmpeg-backed ────────────────────────────────────────────────────────────

async function ffmpegTests() {
    if (!(await hasFfmpeg())) {
        console.log('\nffmpeg not installed — skipping transcode tests');
        return;
    }

    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const { promises: fs } = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const run = promisify(execFile);

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'webbites-audio-test-'));
    const make = async (name: string, codec: string[]) => {
        const file = path.join(dir, name);
        await run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi',
            '-i', 'sine=frequency=440:duration=2', ...codec, file]);
        return { file, bytes: await fs.readFile(file) };
    };

    console.log('\nffmpeg');

    const opus = await make('voice.webm', ['-c:a', 'libopus']);
    const probed = await probeAudio(opus.bytes, 'webm');
    check('probe reads the codec', probed.codec === 'opus');
    check('probe reads the duration', Math.round(probed.durationSeconds || 0) === 2);

    // The case the whole module exists for: a browser recording has to come out
    // as something an AVPlayer will open.
    const normalizedOpus = await normalizeAudio(opus.bytes, 'voice.webm');
    check('WebM/Opus is transcoded', normalizedOpus.transcoded);
    check('…to .m4a', normalizedOpus.extension === 'm4a');
    check('…with an audio/mp4 type', normalizedOpus.contentType === 'audio/mp4');
    check('…and keeps its duration', Math.round(normalizedOpus.durationSeconds || 0) === 2);
    check('…and is really AAC now', (await probeAudio(normalizedOpus.buffer, 'm4a')).codec === 'aac');

    const mp3 = await make('podcast.mp3', ['-c:a', 'libmp3lame']);
    const normalizedMp3 = await normalizeAudio(mp3.bytes, 'podcast.mp3');
    check('MP3 is kept as it is', !normalizedMp3.transcoded);
    check('…byte for byte', normalizedMp3.buffer.equals(mp3.bytes));
    check('…as audio/mpeg', normalizedMp3.contentType === 'audio/mpeg');

    const wav = await make('memo.wav', ['-c:a', 'pcm_s16le']);
    const normalizedWav = await normalizeAudio(wav.bytes, 'memo.wav');
    check('WAV is transcoded', normalizedWav.transcoded);
    check('…and gets much smaller', normalizedWav.buffer.length < wav.bytes.length / 2);

    const peaks = await audioPeaks(normalizedOpus.buffer, 'voice.m4a');
    check('peaks come back', Array.isArray(peaks) && peaks!.length === 64);
    check('peaks are 0..1', (peaks || []).every(p => p >= 0 && p <= 1));
    check('peaks are scaled to the loudest bar', Math.max(...(peaks || [0])) === 1);

    // Garbage that claims to be audio: ffmpeg refuses it, and the caller gets
    // its bytes back rather than an exception.
    const junk = await normalizeAudio(Buffer.from('not audio at all'), 'lies.webm');
    check('unreadable bytes are kept, not thrown', !junk.transcoded && junk.buffer.length === 16);

    await fs.rm(dir, { recursive: true, force: true });
}

ffmpegTests().then(() => {
    console.log(`\n${pass} passed, ${fail} failed\n`);
    if (fail > 0) process.exit(1);
});
