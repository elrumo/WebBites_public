# Audio bookmarks

A bite that is a recording: a voice note made in one of our apps, or an audio
file the user already had. Its searchable content is a transcript, made on the
device where the device can, and here where it cannot.

Not to be confused with the **narration** feature (`/v1/audio/getAudio`,
`/v1/audio/streamAudio`, `websites.articleAudio`), which reads an *article*
aloud with OpenAI TTS. The two share a monthly allowance and nothing else.

## Columns on `websites`

| column | type | written by |
|---|---|---|
| `type` | `'audio'` | `saveUserAudio` |
| `subType` | `['audio']`, or `['audio','voiceNote']` when recorded in-app | `saveUserAudio` |
| `file` | File — the stored recording | `saveUserAudio` (absent when the client uploaded to Parse itself) |
| `fileUrl` | String — the flat URL of the same thing | `saveUserAudio` |
| `fileName` | String | `saveUserAudio` |
| `url` | String — our copy; a recording has no original | `saveUserAudio` |
| `audioDuration` | Number, seconds | client, or ffprobe |
| `audioPeaks` | Number[] 0..1, ≤ 64 — the card's waveform | client, or ffmpeg |
| `siteBody` | String — the transcript as plain text | device, or `audioTranscription` |
| `audioTranscript` | Object `{language, source, model, segments:[{start,end,text}]}` | device, or `audioTranscription` |
| `transcriptStatus` | `none` \| `pending` \| `done` \| `failed` \| `quota` | both |

`siteBody` is deliberate rather than a column of its own: search, the AI
summary, the narrator and every reader already read it, so a transcript there
needs no new plumbing anywhere. The cost is that Meilisearch truncates it to
1000 characters (`meilisearchDocumentMapper`), so only the opening of a long
recording is searchable. `audioTranscript` carries the timestamps the detail
sheet seeks by, and is heavy enough that every client excludes it from list
queries and fetches it when the sheet opens.

No migration: `websites` has no declared schema, and the columns appear on
first write like every other one.

## Saving

`POST /saveUserAudio` — the sibling of `saveUserPdf`, same four ways in:

```
multipart  file part + userId, fileName, duration, peaks, isVoiceNote,
           transcript, tags, customId, savedFrom, pageTitle
JSON       the same, with `file` as a base64 data URL
hosted     `fileUrl` — audio the caller already put in our storage. Validated
           by `ownStorageURL()`; anything else is ignored, not fetched.
```

The native apps take the hosted route: they `POST /parse/files/<name>` with the
session token and hand back only the URL, so a dropped packet costs a retry
rather than the whole upload. Their bytes are therefore **not** normalised —
every Apple client records AAC already.

Uploaded bytes go through `normalizeAudio()`:

- AAC or MP3 → kept byte for byte.
- Anything else (WebM/Opus from Chrome and Firefox, Ogg, FLAC, WAV) → ffmpeg to
  96 kbps AAC in `.m4a`. This is the point of the whole module: `AVPlayer` on
  iOS, macOS and watchOS cannot open WebM, so a voice note recorded in Chrome
  would be a silent card on every Apple client.
- ffmpeg missing, or refusing the file → the original bytes are stored and a
  warning is logged. A recording that only plays in some places beats no
  recording.

`isAudioBytes()` gates on the container signature, not the extension or the
content type, both of which are things a client chose.

## Transcripts

```
Apple device ──transcribe locally──> POST /saveUserAudio {transcript} ─> done
everyone else ─> POST /saveUserAudio ─> transcriptStatus: pending
                       │
                       └─ QStash `audio-transcribe-requests`
                            └─ qstash-webhook ─> transcribeAudioBookmark()
                                 ├─ audio allowance spent ──> 'quota'
                                 ├─ ffmpeg 32kbps mono copy (OpenAI's 25MB cap)
                                 ├─ whisper-1, verbose_json, segment timestamps
                                 ├─ siteBody + audioTranscript ──> 'done'
                                 └─ update-usage: audiosGenerated +1
```

`whisper-1` rather than `gpt-4o-transcribe` because it is the model that returns
segment timestamps, and the timestamps are what make the transcript seekable.

Usage is ticked only once the transcript is stored — a failed call has cost the
user nothing they can hear.

`POST /v1/bookmarks/{id}/transcribe` (Parse session) is the second chance: a
retry after `failed`, or a first transcript for a recording whose device
declined one. It refuses with 402 when the allowance is spent rather than
queuing a job the worker will drop, so the client can offer the upgrade.

## Where recordings come from

| client | records | transcribes | notes |
|---|---|---|---|
| web | `MediaRecorder` | server | WebM/Opus in Chrome and Firefox, MP4/AAC in Safari; normalised here |
| iOS / macOS / visionOS | `AVAudioEngine` tap | on device, live | `SpeechAnalyzer`; server is the fallback |
| watchOS | the same Kit recorder | server | watchOS is on 11 and `SpeechAnalyzer` is 26 |
| share sheet | — | server | a voice memo or an audio file shared in |
| Shortcuts | — | on device, optional | `SaveAudioIntent` |

Everything but the web uploads to Parse itself and posts only a `fileUrl`.

## Indexing

Nothing to reconfigure — `type` and `subType` are already filterable, so the
Audio pill filters with `type = audio` out of the box.

**One pre-existing bug had to be fixed first.** `NOT_HIDDEN_FILTER` was
`(hiddenFrom = "" OR hiddenFrom NOT EXISTS)`, and Meilisearch equality never
matches an empty string. Documents written before the `hiddenFrom` column
existed have no such attribute and passed on `NOT EXISTS`, which is why the
library looked fine — but the document mapper writes `hiddenFrom: ""` on every
bookmark it indexes, so every *newly saved* bookmark of any type matched
neither clause and vanished from search, the grid, and every type, tag and
colour listing. It is `IS EMPTY` now
(`server/utils/meilisearchTrash.ts`, pinned by `npm run test:meiliScope`).

Two further changes:

- `SEARCH_RELEVANT_KEYS` (`v1/triggers/websites/afterSave`) gained `fileUrl`,
  `audioDuration`, `audioPeaks`, `transcriptStatus`. Without them a transcript
  landing on a row would not re-index, and the card would keep saying
  "Transcribing…" for ever.
- `meilisearchDocumentMapper` now carries those four plus `fileName`. The grid is
  served from the index, so a card that could not read them would have to wait
  for the full Parse row before it could draw a waveform or start playing.

## Ceilings

- One request per recording: about 100 minutes at the transcription bitrate.
  Past that `transcriptionCopy()` returns null and the row is marked `failed`.
  Chunking at silence boundaries is the upgrade.
- 100MB per file (`MAX_AUDIO_BYTES`), checked before the user object is loaded.
- `parse-compose`'s `validateFilename` allowlist — which lists `mp3`/`wav`/`mp4`
  — is short-circuited by an early `return null`, so nothing enforces it today.
  `isAudioBytes` is what actually gates an upload.

## Tests

`npm run test:audioFile` — container signatures (including a PDF and an HTML
error page wearing an audio filename), name handling, and, when ffmpeg is
installed, the WebM→AAC transcode, the MP3 passthrough and the waveform.
