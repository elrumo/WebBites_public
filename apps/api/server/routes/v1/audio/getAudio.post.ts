// server/api/v1/audio/getAudio.js
import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import Parse from 'parse/node.js'
import { validateApiKeyFromEvent } from '../../../utils/api-keys'
import { buildAudioStreamEndpoint } from '../../../utils/audio-auth'
import { getUserWithPlan, getAudioQuota } from '../../../utils/plans'

Parse.initialize(
  process.env.VITE_PARSE_ID as string,
  process.env.VITE_PARSE_JS_KEY as string,
  process.env.VITE_PARSE_MASTER_KEY as string
)
Parse.serverURL = process.env.VITE_PARSE_URL as string

defineRouteMeta({
        openAPI: {
            tags: ['Audio'],
            summary: 'Generate audio streaming endpoint',
            description: 'Creates a signed token and returns an endpoint URL for streaming audio from text content',
            parameters: [
                {
                    name: 'authorization',
                    in: 'header',
                    description: 'Bearer API key used for authentication on /v1 routes',
                    required: true,
                    schema: {
                        type: 'string',
                        example: 'Bearer api_key_abc123'
                    }
                }
            ],
            requestBody: {
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                        required: ['text', 'websiteID'],
                        properties: {
                            text: {
                                type: 'string',
                                description: 'Text content to convert to audio (HTML tags will be stripped)',
                                example: 'Hello world, this is some text to convert to audio.'
                            },
                            websiteID: {
                                type: 'string',
                                description: 'Website identifier (required)',
                                example: 'website-123'
                            },
                            userId: {
                                type: 'string',
                                description: 'User identifier (optional)',
                                example: 'user-456'
                            },
                            sessionToken: {
                                type: 'string',
                                description: 'Session token (optional)',
                                example: 'session-123'
                            },
                            url: {
                                type: 'string',
                                description: 'Source URL (optional)',
                                example: 'https://example.com/page'
                            }
                        }
                    }
                }
            }
        },
        responses: {
            200: {
                description: 'Success response with audio streaming endpoint',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                success: {
                                    type: 'boolean',
                                    example: true
                                },
                                endpoint: {
                                    type: 'string',
                                    description: 'URL endpoint for streaming audio with embedded token. When called, this endpoint will stream audio/mpeg content or return error responses.',
                                    example: 'http://localhost:3003/v1/audio/streamAudio?token=eyJ3ZWJzaXRlSWQi...&text=Hello%20world&userId=user-456'
                                }
                            }
                        }
                    }
                }
            },
            400: {
                description: 'Bad request - missing required parameters or parsing error',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                success: {
                                    type: 'boolean',
                                    example: false
                                },
                                error: {
                                    type: 'string',
                                    enum: [
                                        'Missing required parameters',
                                        'Error parsing body'
                                    ],
                                    example: 'Missing required parameters'
                                }
                            }
                        }
                    }
                }
            },
            500: {
                description: 'Internal server error',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                success: {
                                    type: 'boolean',
                                    example: false
                                },
                                error: {
                                    type: 'string',
                                    description: 'Error message describing what went wrong',
                                    example: 'Unknown error occurred'
                                }
                            }
                        }
                    }
                }
            }
        },
        'x-endpoint-behavior': {
            description: 'When the returned endpoint URL is called, it will behave as follows',
            responses: {
                200: {
                    description: 'Audio stream - MP3 format',
                    content: {
                        'audio/mpeg': {
                            schema: {
                                type: 'string',
                                format: 'binary',
                                description: 'Streamed MP3 audio content'
                            }
                        }
                    },
                    headers: {
                        'Content-Type': {
                            description: 'audio/mpeg',
                            schema: { type: 'string' }
                        },
                        'Transfer-Encoding': {
                            description: 'chunked',
                            schema: { type: 'string' }
                        },
                        'Cache-Control': {
                            description: 'no-store, no-cache, must-revalidate, proxy-revalidate',
                            schema: { type: 'string' }
                        }
                    }
                },
                400: {
                    description: 'ValidationError - Bad request from streamAudio endpoint',
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    success: { type: 'boolean', example: false },
                                    message: { type: 'string' },
                                    error: {
                                        type: 'string',
                                        enum: [
                                            'No token provided',
                                            'No text provided',
                                            'User ID is required',
                                            'Invalid user ID',
                                            'User plan not found'
                                        ]
                                    },
                                    errorType: { type: 'string', example: 'ValidationError' }
                                }
                            }
                        }
                    }
                },
                401: {
                    description: 'TokenError - Invalid or expired token',
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    success: { type: 'boolean', example: false },
                                    message: { type: 'string' },
                                    error: {
                                        type: 'string',
                                        enum: [
                                            'Invalid token format',
                                            'Invalid token signature',
                                            'Malformed token payload',
                                            'Token has expired'
                                        ]
                                    },
                                    errorType: { type: 'string', example: 'TokenError' }
                                }
                            }
                        }
                    }
                },
                403: {
                    description: 'UsageError - Usage limit exceeded',
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    success: { type: 'boolean', example: false },
                                    message: { type: 'string' },
                                    error: {
                                        type: 'string',
                                        example: 'Usage limit reached, please upgrade your plan'
                                    },
                                    errorType: { type: 'string', example: 'UsageError' }
                                }
                            }
                        }
                    }
                },
                500: {
                    description: 'ServerError - Internal server error from streamAudio endpoint',
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    success: { type: 'boolean', example: false },
                                    message: { type: 'string' },
                                    error: { type: 'string' },
                                    errorType: { type: 'string', example: 'ServerError' }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
})

class UsageError extends Error {
  statusCode: number
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
    this.statusCode = 403
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

class AuthError extends Error {
  statusCode: number
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
    this.statusCode = 401
  }
}

interface GetAudioRequestBody {
  text: string
  websiteID: string
  userId?: string
  sessionToken?: string
  url?: string
  voice?: string
  accent?: string
}

export default defineEventHandler(async (event) => {
  try {
    let body: Partial<GetAudioRequestBody> = await readBody(event)

    console.log('[getAudio] Getting audio: ', body?.websiteID)

    if (typeof body === 'string') {
      try {
        body = JSON.parse(body)
      } catch (error) {
        throw new ValidationError('Error parsing body')
      }
    }

    const { text: rawText, url, websiteID, voice, accent } = (body || {}) as Partial<GetAudioRequestBody>

    const userId = await validateApiKeyFromEvent(event)
    if (!userId) {
      throw new AuthError('Missing or invalid API key')
    }

    if (!rawText || !websiteID) {
      throw new ValidationError('Missing required parameters: text and websiteID')
    }

    const { user, plan } = await getUserWithPlan(userId)
      .catch(() => { throw new ValidationError('Invalid user ID') })

    if (getAudioQuota(user, plan).exceeded) {
      throw new UsageError('Usage limit reached, please upgrade your plan')
    }

    // Token minting lives in audio-auth so the RSS article route mints the
    // exact same shape; `targetType` is left at its 'website' default here.
    const endpoint = buildAudioStreamEndpoint({
      text: rawText,
      userId,
      websiteId: websiteID,
      url,
      voice,
      accent,
    })

    // Not logged: the endpoint carries the signed stream token in its query
    // string, and anyone reading the logs could replay it.
    return { success: true, endpoint }
  } catch (error: any) {
    // Answer with a real status code. Returning 200 + `{success:false}` left
    // both clients unable to tell failure from success: the web app built a
    // stream URL from `undefined`, and the native app reported an opaque
    // decoding error instead of the actual reason (or the upgrade prompt).
    const statusCode = error?.statusCode || 500
    const message = error?.message || 'Unknown error occurred'
    if (statusCode >= 500) console.error('[getAudio] failed:', message)
    setResponseStatus(event, statusCode)
    return {
      success: false,
      message,
      error: message,
      errorType: error?.name || 'ServerError',
    }
  }
})
