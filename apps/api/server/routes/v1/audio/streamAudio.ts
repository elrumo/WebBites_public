import { defineEventHandler, getQuery, sendStream, setResponseHeaders } from 'h3'
import { Readable } from 'stream'
import { getOpenAIAudio } from '#root/server/utils/aiClients'
import LZString from 'lz-string'
import Parse from 'parse/node.js'
import { createHmac } from 'crypto'
import { sendToQstash, getPartitionedQueue, createFileName } from '../../../utils/serverUtils.js'
import { getUserWithPlan, getAudioQuota } from '../../../utils/plans'
import { normaliseVoice, speechInstructions, splitForSpeech, stripHtmlForSpeech, SPEECH_TEXT_LIMIT } from '../../../utils/audio-auth'
import { contentLanguageName } from '../../../utils/aiLanguage'
import { audioTokenSecret } from '#root/server/utils/audio-auth'

Parse.initialize(
  process.env.VITE_PARSE_ID as string,
  process.env.VITE_PARSE_JS_KEY as string,
  process.env.VITE_PARSE_MASTER_KEY as string
)
Parse.serverURL = process.env.VITE_PARSE_URL as string


// Built on first use: a deployment without an OpenAI key must still be able to load this module.
let audioClient: ReturnType<typeof getOpenAIAudio> | null = null
const openai = new Proxy({} as ReturnType<typeof getOpenAIAudio>, {
  get: (_target, prop) => Reflect.get((audioClient ??= getOpenAIAudio()) as object, prop),
})

defineRouteMeta({
  openAPI: {
    tags: ['Audio'],
    summary: 'Stream AI-generated audio from text',
    description:
      'Streams MP3 audio content generated from text using OpenAI TTS. Requires a signed token for authentication and user validation.',
    parameters: [
      {
        name: 'token',
        in: 'query',
        required: true,
        description:
          'Signed JWT-like token containing websiteId, userId, url, timestamp, expiration, and auth credentials',
        schema: { type: 'string' },
      },
      {
        name: 'text',
        in: 'query',
        required: true,
        description: 'Text content to convert to speech (URL encoded)',
        schema: { type: 'string' },
      },
      {
        name: 'userId',
        in: 'query',
        required: false,
        description: 'User identifier (optional, also included in token)',
        schema: { type: 'string' },
      },
    ],
  },
})

class TokenError extends Error {
  statusCode: number
  constructor(message: string) {
    super(message)
    this.name = 'TokenError'
    this.statusCode = 401
  }
}

class ValidationError extends Error {
  statusCode: number
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
    this.statusCode = 400
  }
}

class UsageError extends Error {
  statusCode: number
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
    this.statusCode = 403
  }
}

export default defineEventHandler(async (event) => {
  try {
    const origin = event.node.req.headers.origin || '*'
    const res = event.node.res

    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept')
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Access-Control-Max-Age', '86400')

    if (event.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }

    const query = getQuery(event) as { token?: string; text?: string }
    let { token, text } = query

    if (!token) throw new ValidationError('No token provided')
    if (!text) throw new ValidationError('No text provided')

    const [payloadBase64, signature] = token.split('.')
    if (!payloadBase64 || !signature) throw new TokenError('Invalid token format')
    
    const decompressed = LZString.decompressFromEncodedURIComponent(text)
    if (!decompressed) throw new ValidationError('Failed to decompress text')
    text = decompressed

    const expectedSignature = createHmac('sha256', audioTokenSecret())
      .update(payloadBase64)
      .digest('base64url')
    if (signature !== expectedSignature) throw new TokenError('Invalid token signature')

    let payload: any
    try {
      const payloadStr = Buffer.from(payloadBase64, 'base64').toString()
      payload = JSON.parse(payloadStr)
    } catch {
      throw new TokenError('Malformed token payload')
    }

    const currentTime = Math.floor(Date.now() / 1000)
    if (payload.exp && payload.exp < currentTime) throw new TokenError('Token has expired')

    // `targetType` is absent from every token minted before the RSS reader
    // existed, and those tokens stay valid for ten minutes after a deploy —
    // so the default has to be 'website' or in-flight bookmark playback breaks.
    const { websiteId, userId, url, rssItemId, targetType = 'website', voice, accent } = payload
    if (!userId) throw new ValidationError('User ID is required')

    const { user, plan } = await getUserWithPlan(userId)
      .catch(() => {
        throw new ValidationError('Invalid user ID')
      })

    if (getAudioQuota(user, plan).exceeded) {
      throw new UsageError('Usage limit reached, please upgrade your plan')
    }

    // The query text is what the client had on hand, which for a bookmark is a
    // 1000-char preview and for anything is capped by URL length. The row holds
    // the full extraction, so read from there and keep the query as a fallback.
    const article = await resolveArticleText({ targetType, websiteId, rssItemId }).catch((error: any) => {
      console.error('[streamAudio] could not read article text from row:', error?.message)
      return { text: '', language: undefined }
    })
    const parts = splitForSpeech(article.text || text)
    if (!parts.length) throw new ValidationError('No text provided')

    const synthesise = (input: string) =>
      openai.audio.speech.create({
        model: 'gpt-4o-mini-tts',
        // ponytail: the finished MP3 is cached per row regardless of voice, so an
        // article generated once keeps its first voice. Key the cache on voice if
        // that ever matters.
        voice: normaliseVoice(voice),
        input,
        response_format: 'mp3',
        instructions: speechInstructions(accent, contentLanguageName(article.language)),
        speed: 1.0,
      })

    // The model takes at most 2000 tokens per request, so a whole article is
    // read piece by piece and the MP3 frames are concatenated on the wire —
    // one continuous stream to the client, one usage tick, one cached file.
    // The first piece is awaited before headers go out so a rejected request
    // still answers as JSON rather than an empty audio body.
    const firstBody: any = (await synthesise(parts[0])).body
    if (!firstBody) throw new Error('Text-to-speech response had no body')

    const responseBody = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for (let i = 0; i < parts.length; i++) {
            const body: any = i === 0 ? firstBody : (await synthesise(parts[i])).body
            if (!body) throw new Error('Text-to-speech response had no body')
            const reader = toWebStream(body).getReader()
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              controller.enqueue(value)
            }
          }
          controller.close()
        } catch (error) {
          console.error('[streamAudio] generation failed mid-article:', (error as any)?.message)
          controller.error(error)
        }
      },
    })

    const bufferChunks: Buffer[] = []
    let usageRecorded = false

    const recordUsage = () => {
      if (usageRecorded) return
      usageRecorded = true
      Promise.resolve(
        sendToQstash(
          {
            type: 'update-usage',
            data: {
              typeOfUsage: 'audiosGenerated',
              userId: userId,
              subOrAdd: 'add',
              number: 1,
            },
          },
          { isBatch: false, queueName: getPartitionedQueue('updateUsage') }
        )
      ).catch((error: any) => console.error('[streamAudio] usage update failed:', error?.message))
    }

    // Cache the finished MP3 against whichever row asked for it. RSS items
    // are shared across subscribers, so one generation serves everyone who
    // opens that article afterwards.
    const persistAudio = async () => {
      const shouldCacheOnRssItem = targetType === 'rssItem' && rssItemId
      const shouldCacheOnWebsite = targetType === 'website' && websiteId && websiteId !== 'none' && url
      if (!shouldCacheOnRssItem && !shouldCacheOnWebsite) return
      try {
        const buffer = Buffer.concat(bufferChunks)
        const fileName = createFileName(userId, `audio`, 'mp3', 'streamAudio-1')
        const parseFile = new Parse.File(fileName, { base64: buffer.toString('base64') }, 'audio/mpeg')

        if (shouldCacheOnRssItem) {
          const item = await new Parse.Query('rssItems').get(rssItemId, { useMasterKey: true })
          if (item) {
            await parseFile.save({ useMasterKey: true })
            item.set('articleAudio', parseFile)
            item.set('articleAudioUrl', parseFile.url())
            await item.save(null, { useMasterKey: true })
          }
        } else {
          const website = await new Parse.Query('websites').get(websiteId, { useMasterKey: true })
          if (website) {
            website.set('articleAudio', parseFile)
            await website.save(null, { useMasterKey: true })
          }
        }
      } catch (saveError: any) {
        console.error('[streamAudio] could not persist audio:', saveError?.message)
      }
    }

    // Hand h3 a web stream instead of res.write()-ing chunks. Under the Bun
    // preset event.node.res is a shim that buffers every write and only emits
    // the response (with a Content-Length) at res.end(), so nothing reached the
    // wire until the whole ~50s generation finished — long past BunnyCDN's 30s
    // origin timeout, which answered the client with a 502 while usage had
    // already been counted. A returned ReadableStream is flushed as it fills.
    const collector = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (chunk.length === 0) return
        bufferChunks.push(Buffer.from(chunk))
        recordUsage()
        controller.enqueue(chunk)
      },
      flush() {
        persistAudio()
      },
    })

    setResponseHeaders(event, {
      'Content-Type': 'audio/mpeg',
      'Accept-Ranges': 'none',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    })

    return sendStream(event, responseBody.pipeThrough(collector))
  } catch (error: any) {
    const res = event.node.res
    if (!res.headersSent) {
      res.statusCode = error.statusCode || 500
      return {
        success: false,
        message: error.message,
        error: error.message,
        errorType: error.name || 'ServerError',
      }
    } else {
      res.end()
      return error
    }
  }
})

/**
 * The full article text for the row an audio token points at: the extracted
 * article file first (the same content the readers render), then the flat
 * `siteBody` / RSS text columns. Empty when the row has neither.
 */
async function resolveArticleText(target: {
  targetType: string
  websiteId?: string
  rssItemId?: string
}): Promise<{ text: string; language?: string }> {
  const { targetType, websiteId, rssItemId } = target
  let html = ''
  let plain = ''
  let language: string | undefined
  if (targetType === 'rssItem' && rssItemId) {
    const item = await new Parse.Query('rssItems').get(rssItemId, { useMasterKey: true })
    plain = item.get('extractedText') || item.get('rssContentText') || ''
    html = plain ? '' : await fetchText(item.get('extractedFileUrl') || item.get('extractedFile')?.url?.())
  } else if (targetType === 'website' && websiteId && websiteId !== 'none') {
    const website = await new Parse.Query('websites').get(websiteId, { useMasterKey: true })
    html = await fetchText(website.get('siteBodyFileUrl') || website.get('siteBodyFile')?.url?.())
    plain = website.get('siteBody') || ''
    language = website.get('language')
  }
  const fromHtml = stripHtmlForSpeech(html, 0)
  // The file is the canonical extraction; the column is a copy of it and can
  // be older or shorter, so it only wins when the file has nothing to say.
  const best = fromHtml.length >= 200 ? fromHtml : stripHtmlForSpeech(plain, 0)
  return { text: best.slice(0, SPEECH_TEXT_LIMIT), language }
}

async function fetchText(url?: string | null): Promise<string> {
  if (!url) return ''
  const response = await fetch(url)
  return response.ok ? await response.text() : ''
}

/**
 * Normalises the OpenAI SDK's body to a web ReadableStream. Under Bun (the
 * production runtime) it already is one; under Node's fetch shim it is a
 * Node Readable.
 */
function toWebStream(body: any): ReadableStream<Uint8Array> {
  if (typeof body.getReader === 'function') return body
  return Readable.toWeb(body) as ReadableStream<Uint8Array>
}
