import { createHmac } from 'crypto'
import LZString from 'lz-string'

/**
 * The key audio stream tokens are signed with. There is deliberately no default: a fallback
 * would be a signing key anyone could read in this repository. Unset means audio tokens can
 * be neither made nor accepted.
 */
export function audioTokenSecret(): string {
  const secret = process.env.VITE_AUDIO_TOKEN_SECRET || process.env.AUDIO_TOKEN_SECRET
  if (!secret) throw new Error('VITE_AUDIO_TOKEN_SECRET is not set, so audio tokens cannot be signed or verified')
  return secret
}

/**
 * Verifies audio token signature
 * Token format: base64Payload.signature
 * @returns true if token is valid, false otherwise
 */
export function verifyAudioToken(token: string | undefined): boolean {
  if (!token) return false

  const [payloadBase64, signature] = token.split('.')
  if (!payloadBase64 || !signature) return false

  let secret: string
  try { secret = audioTokenSecret() } catch (error) { console.error('[audio-auth]', (error as Error).message); return false }

  const expectedSignature = createHmac('sha256', secret)
    .update(payloadBase64)
    .digest('base64url')

  return signature === expectedSignature
}

export type AudioTargetType = 'website' | 'rssItem'

/** OpenAI TTS voices the reader may pick from. Mirrored in the web app's `audioVoices`. */
export const AUDIO_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar'] as const
export type AudioVoice = (typeof AUDIO_VOICES)[number]
export const DEFAULT_AUDIO_VOICE: AudioVoice = 'nova'

/** Anything not on the list (old tokens, tampered bodies) reads with the default. */
export function normaliseVoice(voice: unknown): AudioVoice {
  return (AUDIO_VOICES as readonly string[]).includes(voice as string) ? (voice as AudioVoice) : DEFAULT_AUDIO_VOICE
}

/**
 * OpenAI ships no accent-specific voices; delivery is steered through the
 * `instructions` field instead, and these are the accents it renders
 * convincingly. Mirrored in the web app's `audioAccents`. 'american' is the
 * model's natural delivery, so it adds nothing to the instruction.
 */
export const AUDIO_ACCENTS = {
  american: '',
  british: 'Speak with a British English (Received Pronunciation) accent.',
  australian: 'Speak with an Australian English accent.',
  irish: 'Speak with an Irish English accent.',
  indian: 'Speak with an Indian English accent.',
  scottish: 'Speak with a Scottish English accent.',
} as const
export type AudioAccent = keyof typeof AUDIO_ACCENTS
export const DEFAULT_AUDIO_ACCENT: AudioAccent = 'american'

export function normaliseAccent(accent: unknown): AudioAccent {
  return typeof accent === 'string' && accent in AUDIO_ACCENTS ? (accent as AudioAccent) : DEFAULT_AUDIO_ACCENT
}

const BASE_SPEECH_INSTRUCTIONS =
  'You will be reading a news articles from a website, you have to sound soft, yet informative and comforting in tone'

/**
 * The instruction handed to the TTS model for a given accent. The accents are
 * English ones, so for a page known to be in another language they give way to
 * naming that language (`language` is its English name, e.g. 'German').
 */
export function speechInstructions(accent: unknown, language?: string): string {
  if (language && language !== 'English') {
    return `${BASE_SPEECH_INSTRUCTIONS}. The text is in ${language}; read it in natural ${language}.`
  }
  const extra = AUDIO_ACCENTS[normaliseAccent(accent)]
  return extra ? `${BASE_SPEECH_INSTRUCTIONS}. ${extra}` : BASE_SPEECH_INSTRUCTIONS
}

export interface AudioEndpointOptions {
  text: string
  userId: string
  /** The bookmark this audio belongs to, or 'none' when there is no row. */
  websiteId: string
  url?: string | null
  /**
   * Which class `streamAudio` should cache the finished MP3 on. Defaults to
   * 'website' so tokens minted by the original bookmark path — and any token
   * still in flight from before the RSS reader shipped — behave exactly as
   * they always have.
   */
  targetType?: AudioTargetType
  rssItemId?: string | null
  /** Which TTS voice to read with; unknown values fall back to the default. */
  voice?: string | null
  /** English accent to read with; unknown values fall back to the default. */
  accent?: string | null
}

/**
 * Mints the signed, short-lived streaming endpoint for a block of text.
 *
 * Shared by the bookmark audio route and the RSS article audio route so the
 * two can never drift on token shape, expiry or text compression — the reader
 * on the other end is a single handler that has to understand both.
 */
export function buildAudioStreamEndpoint(options: AudioEndpointOptions): string {
  const { text, userId, websiteId, url, targetType = 'website', rssItemId = null, voice, accent } = options

  const now = Date.now()
  const tokenPayload = {
    websiteId,
    userId,
    url,
    targetType,
    ...(rssItemId ? { rssItemId } : {}),
    voice: normaliseVoice(voice),
    accent: normaliseAccent(accent),
    timestamp: now,
    exp: Math.floor(now / 1000) + 600,
  }
  // Nothing signs or encrypts this payload's contents — the HMAC only proves we
  // minted it, and the base64 is readable by whoever holds the token. Never put
  // a credential in here; it used to carry the internal Basic user/pass, which
  // handed every signed-in user an internal-key equivalent.

  const payloadBase64 = Buffer.from(JSON.stringify(tokenPayload)).toString('base64')
  const signature = createHmac('sha256', audioTokenSecret())
    .update(payloadBase64)
    .digest('base64url')
  const token = `${payloadBase64}.${signature}`

  const audioServiceUrl = process.env.VITE_BACKEND_URL as string
  if (!audioServiceUrl) {
    throw new Error('VITE_BACKEND_URL is not configured, cannot build a stream endpoint')
  }
  const baseUrl = audioServiceUrl.endsWith('/') ? audioServiceUrl : `${audioServiceUrl}/`
  const encodedText = encodeURIComponent(LZString.compressToEncodedURIComponent(stripHtmlForSpeech(text, 8000)))

  return `${baseUrl}v1/audio/streamAudio?token=${token}&text=${encodedText}&userId=${userId}`
}

/**
 * Rough token count for the TTS input limit. OpenAI's TTS models reject
 * anything over 2000 tokens. ASCII prose runs ~4 chars/token; CJK and
 * other scripts can be a token per character, so those count one each.
 *
 * ponytail: heuristic, not a tokenizer. Chunks are sized well under the
 * limit so the error margin never matters; swap in js-tiktoken if it does.
 */
export function estimateSpeechTokens(text: string): number {
  let ascii = 0
  let other = 0
  for (const ch of text) {
    if (ch.charCodeAt(0) < 128) ascii++
    else other++
  }
  return Math.ceil(ascii / 4) + other
}

/** Whole articles cap here; past this a "listen" is a podcast. */
export const SPEECH_TEXT_LIMIT = 40_000

/**
 * Splits prose into pieces the TTS model accepts, breaking at sentence ends
 * so the voice never pauses mid-word between pieces. A single sentence past
 * the limit is cut at the last space before it.
 */
export function splitForSpeech(text: string, maxTokens = 1200): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  const sentences = clean.match(/[^.!?。！？]+[.!?。！？]+["'”’)]*\s*|[^.!?。！？]+$/g) || [clean]
  const parts: string[] = []
  let current = ''
  const push = () => {
    if (current.trim()) parts.push(current.trim())
    current = ''
  }
  for (const sentence of sentences) {
    if (estimateSpeechTokens(current + sentence) > maxTokens && current) push()
    if (estimateSpeechTokens(sentence) > maxTokens) {
      // One run-on sentence longer than a whole chunk: hard-wrap it on spaces.
      let rest = sentence
      while (estimateSpeechTokens(rest) > maxTokens) {
        let cut = Math.max(1, Math.floor(rest.length * maxTokens / estimateSpeechTokens(rest)) - 1)
        const space = rest.lastIndexOf(' ', cut)
        if (space > cut / 2) cut = space
        current += rest.slice(0, cut)
        push()
        rest = rest.slice(cut).trimStart()
      }
      current += rest
      continue
    }
    current += sentence
  }
  push()
  return parts
}

/** Speech input must be prose: tags, entities and collapsed runs all read badly. */
export function stripHtmlForSpeech(htmlString: string | undefined | null, stringLimit = 1000): string {
  if (htmlString === undefined || htmlString === null) return ''
  try {
    let cleaned = htmlString.replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '')
    cleaned = cleaned.replace(/<head[^>]*>([\s\S]*?)<\/head>/gi, '')
    // Block boundaries become a space before the tag strip. Without this
    // `<h1>Title</h1><p>Body.</p>` collapses to `TitleBody.` and the voice
    // reads the two as one word — which is most of what a feed body is, since
    // publishers ship wall-to-wall block markup with no whitespace between.
    // Inline tags are still removed without a space, so `<b>bold</b>face`
    // stays one word.
    cleaned = cleaned.replace(/<\/?(p|div|section|article|h[1-6]|li|ul|ol|tr|td|th|blockquote|pre|br|hr)\b[^>]*>/gi, ' ')
    cleaned = cleaned.replace(/<\/?[^>]+(>|$)/g, '')
    cleaned = cleaned.replace(/\\n/g, '')
    cleaned = cleaned.replace(/\s\s+/g, ' ')
    cleaned = cleaned.replaceAll('&nbsp', '')
    // Trim before the limit, so the cap applies to real content rather than to
    // the leading space the block-boundary pass leaves behind.
    cleaned = cleaned.trim()
    if (stringLimit !== 0) cleaned = cleaned.substring(0, stringLimit)
    return cleaned
  } catch {
    return htmlString || ''
  }
}
