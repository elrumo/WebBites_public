import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import type { JevImages, JevRequest, JevResponse } from '../types/jev.types'

type LiteLLMModelKind = 'text' | 'multimodal'

/**
 * AI settings. Any OpenAI-compatible endpoint works (OpenAI itself, Ollama, vLLM, a LiteLLM
 * proxy...):
 *
 *   AI_API_KEY          the key (LITELLM_API_KEY is read too)
 *   AI_API_BASE_URL     the server root, without /v1 (LITELLM_API_BASE_URL is read too)
 *   AI_TEXT_MODEL       model for text tasks, e.g. gpt-4o-mini (LITELLM_TEXT_MODEL)
 *   AI_MULTIMODAL_MODEL model for tasks with images; defaults to the text model
 *   AI_API_STYLE        "openai" sends model names exactly as configured; "litellm" prefixes
 *                       them with a vendor (openai/gpt-4o) the way a LiteLLM proxy routes.
 *                       Defaults to litellm when LITELLM_API_BASE_URL is set, else openai.
 *
 * With no key and base URL, every AI feature is simply unavailable (`aiConfigured()`).
 */
const aiEnv = (name: string, legacy: string): string | undefined =>
  process.env[`AI_${name}`] || process.env[`LITELLM_${legacy}`] || undefined

export function aiStyle(): 'openai' | 'litellm' {
  const explicit = (process.env.AI_API_STYLE || '').toLowerCase()
  if (explicit === 'openai' || explicit === 'litellm') return explicit
  return process.env.LITELLM_API_BASE_URL && !process.env.AI_API_BASE_URL ? 'litellm' : 'openai'
}

/** Whether an AI endpoint is configured at all. */
export function aiConfigured(): boolean {
  return Boolean(aiEnv('API_KEY', 'API_KEY') && aiEnv('API_BASE_URL', 'API_BASE_URL'))
}

/**
 * Every backend AI call goes through the configured endpoint.
 * The two SDKs build request URLs differently, so the base URL is applied differently:
 *   - Anthropic appends `/v1/messages` → give it the proxy root.
 *   - OpenAI appends `/chat/completions` etc. to a base that already ends in `/v1`.
 */
function litellm() {
  const apiKey = aiEnv('API_KEY', 'API_KEY')
  const baseURL = aiEnv('API_BASE_URL', 'API_BASE_URL')?.replace(/\/+$/, '')
  if (!apiKey || !baseURL) {
    throw new Error('No AI endpoint is configured (set AI_API_KEY and AI_API_BASE_URL)')
  }
  return { apiKey, baseURL }
}

/** Anthropic SDK client routed through the LiteLLM proxy. */
export function getAnthropic(): Anthropic {
  const { apiKey, baseURL } = litellm()
  return new Anthropic({ apiKey, baseURL })
}

/**
 * OpenAI SDK client routed through the LiteLLM proxy. `tag` names the kind of
 * call (e.g. 'getAiSummary') so the proxy's logs and spend can be filtered by it.
 */
export function getOpenAI(tag?: string): OpenAI {
  const { apiKey, baseURL } = litellm()
  return new OpenAI({
    apiKey,
    baseURL: `${baseURL}/v1`,
    defaultHeaders: tag ? { 'x-litellm-tags': tag } : undefined
  })
}

/** The Jev model sent to TypeSafe. Pin a version (`jev-1.13.0`) once thresholds are tuned against it. */
export function getJevModel(): string {
  return process.env.LITELLM_JEV_MODEL?.trim() || 'jev-latest'
}

/**
 * TypeSafe's Jev through the LiteLLM proxy's TypeSafe pass-through
 * (`/typesafe/v1/systemone`, LiteLLM ≥ 1.103). Jev is not a chat model, so
 * there is no OpenAI-SDK route for it. The proxy holds TYPESAFE_API_KEY; this
 * side only sends the LiteLLM key, and spend is logged under the versioned
 * model TypeSafe reports. `tag` works as in getOpenAI.
 * Pictures (`request.assets`) need TypeSafe's opt-in header. LiteLLM releases
 * up to 1.107.0-dev.2 drop it on the built-in route, so image requests go to
 * LITELLM_JEV_IMAGES_PATH when set: a custom pass-through on the proxy with
 * `forward_headers: true` (see docs/boards-feature-architecture.md).
 * https://docs.litellm.ai/docs/pass_through/typesafe
 */
export async function askJev(request: JevRequest, tag?: string, timeoutMs?: number): Promise<JevResponse> {
  const { apiKey, baseURL } = litellm()
  const hasImages = Object.keys(request.assets ?? {}).length > 0
  const imagesPath = process.env.LITELLM_JEV_IMAGES_PATH?.trim()
  const path = hasImages && imagesPath ? `/${imagesPath.replace(/^\/+/, '')}` : '/typesafe/v1/systemone'
  // One budget for the call and its retries.
  const signal = AbortSignal.timeout(timeoutMs ?? (hasImages ? 30_000 : 15_000))
  let response: Response
  for (let attempt = 0; ; attempt++) {
    response = await fetch(`${baseURL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(hasImages ? { 'TypeSafe-Danger-Zone-Images': 'true' } : {}),
        ...(tag ? { 'x-litellm-tags': tag } : {})
      },
      body: JSON.stringify({ ...request, model: request.model || getJevModel() }),
      signal
    })
    // TypeSafe asks for backoff on 429 (rate limit) and 529 (overloaded).
    if ((response.status !== 429 && response.status !== 529) || attempt === 2) break
    await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt))
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300)
    throw new Error(`Jev via LiteLLM failed: ${response.status} ${detail}`)
  }
  const result = await response.json() as JevResponse
  if (!result?.answers || typeof result.answers !== 'object') {
    throw new Error('Jev via LiteLLM returned no answers')
  }
  return result
}

/**
 * Runs `run` with the pictures, and again without them if that fails. Images
 * are experimental on TypeSafe's side (one rejected image fails the whole
 * request), so a bad picture costs the picture, not the answer.
 */
export async function withImageFallback<T>(
  images: JevImages | null,
  run: (images: JevImages | null) => Promise<T>
): Promise<T> {
  if (images) {
    try {
      return await run(images)
    } catch (error: any) {
      console.error('[jev] image request failed, retrying without images:', error?.message)
    }
  }
  return run(null)
}

/**
 * The one exception to the proxy: speech and transcription go straight to
 * OpenAI. The proxy has no TTS or Whisper deployment, and its audio routes
 * answer any model with a bare 500, which reached the apps as
 * "Network problem: 500 Internal server error".
 * ponytail: route through the proxy again once it serves gpt-4o-mini-tts and whisper-1.
 */
export function getOpenAIAudio(): OpenAI {
  const apiKey = process.env.OPENAI_API_AUDIO_KEY || process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('Speech and transcription need OPENAI_API_KEY (or OPENAI_API_AUDIO_KEY)')
  return new OpenAI({ apiKey, baseURL: process.env.OPENAI_API_AUDIO_BASE_URL || undefined })
}

/** Whether speech and transcription can be used on this deployment. */
export function audioConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_AUDIO_KEY || process.env.OPENAI_API_KEY)
}

/**
 * MiMo model groups are registered bare on the LiteLLM proxy (`mimo-v2.5-pro`,
 * `mimo-v2.5`, …). Any vendor prefix (`openai/mimo-…`, `xiaomi/mimo-…`) resolves
 * to a model group with no deployments, so MiMo names are always sent bare.
 * Returns the bare MiMo name, or null for anything else.
 */
function normalizeMimoModelId(model: string): string | null {
  const bare = model.includes('/') ? model.split('/').pop()!.trim() : model
  return /^mimo/i.test(bare) ? bare : null
}

function resolveModelId({
  vendor,
  model,
  defaultVendor,
  defaultModel
}: {
  vendor?: string
  model?: string
  defaultVendor: string
  defaultModel: string
}): string {
  const trimmedModel = model?.trim()

  const mimoId = normalizeMimoModelId(trimmedModel || defaultModel || '')
  if (mimoId) return mimoId

  if (trimmedModel?.includes('/')) return trimmedModel

  const finalVendor = vendor?.trim() || defaultVendor
  const finalModel = trimmedModel || defaultModel

  return `${finalVendor}/${finalModel}`
}

const DEFAULT_DIRECT_MODEL = 'gpt-4o-mini'

function envModel(kind: LiteLLMModelKind): string {
  const textModel = aiEnv('TEXT_MODEL', 'TEXT_MODEL')

  if (aiStyle() === 'openai') {
    // A direct endpoint takes the name as configured, with no vendor routing prefix.
    return (kind === 'multimodal' ? aiEnv('MULTIMODAL_MODEL', 'MULTIMODAL_MODEL') : undefined) || textModel || DEFAULT_DIRECT_MODEL
  }

  if (kind === 'multimodal') {
    return resolveModelId({
      vendor: process.env.LITELLM_MULTIMODAL_VENDOR,
      model: aiEnv('MULTIMODAL_MODEL', 'MULTIMODAL_MODEL'),
      defaultVendor: 'openai',
      defaultModel: textModel
    })
  }

  return resolveModelId({
    vendor: process.env.LITELLM_TEXT_VENDOR,
    model: textModel,
    defaultVendor: 'openai',
    defaultModel: textModel
  })
}

export function getTextModel(override?: string | null): string {
  const trimmedOverride = override?.trim()
  if (aiStyle() === 'openai') return trimmedOverride || envModel('text')
  return trimmedOverride
    ? resolveModelId({
        model: trimmedOverride,
        defaultVendor: process.env.LITELLM_TEXT_VENDOR || 'openai',
        defaultModel: process.env.LITELLM_TEXT_MODEL || 'mimo-v2.5'
      })
    : envModel('text')
}

export function getMultimodalModel(override?: string | null): string {
  const trimmedOverride = override?.trim()
  if (aiStyle() === 'openai') return trimmedOverride || envModel('multimodal')
  return trimmedOverride
    ? resolveModelId({
        model: trimmedOverride,
        defaultVendor: process.env.LITELLM_MULTIMODAL_VENDOR || 'openai',
        defaultModel: process.env.LITELLM_MULTIMODAL_MODEL || 'gpt-4o'
      })
    : envModel('multimodal')
}
