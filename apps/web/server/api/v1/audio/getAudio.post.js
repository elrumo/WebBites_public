// server/api/v1/audio/getAudio.js
// import { createHmac } from 'crypto';

defineRouteMeta({
  openAPI: {
    tags: ['Audio'],
    summary: 'Generate audio streaming endpoint',
    description: 'Creates a signed token and returns an endpoint URL for streaming audio from text content',
    method: 'POST',
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
                  example: 'http://localhost:3004/v1/audio/streamAudio?token=eyJ3ZWJzaXRlSWQi...&text=Hello%20world&userId=user-456'
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
});

export default defineEventHandler(async (event) => {
  // `readBody` gives an object when the caller sets a JSON content type and a
  // raw string when it doesn't. Accept both — blindly `JSON.parse`-ing threw
  // "Unexpected token o" the moment a caller sent a proper Content-Type.
  let body = await readBody(event);
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      throw createError({ statusCode: 400, statusMessage: 'Invalid JSON body' });
    }
  }

  const { text, url, websiteID, voice, accent } = body || {};

  if (!text || !websiteID) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing required parameters: text and websiteID'
    });
  }

  let getAudio;
  try {
    getAudio = await backendFetch(event, 'v1/audio/getAudio', {
      method: 'POST',
      body: { text, websiteID, url, voice, accent }
    });
  } catch (error) {
    console.error('Error in getAudio endpoint:', error);
    throw createError({
      statusCode: error.statusCode || error.status || 502,
      statusMessage: error.statusMessage || error.message || 'Could not start audio generation'
    });
  }

  // A backend that answers 200 with `success:false` must not look like success
  // here, or the client happily builds a stream URL out of `undefined`.
  if (!getAudio?.endpoint) {
    throw createError({
      statusCode: 502,
      statusMessage: getAudio?.message || getAudio?.error || 'Audio generation did not return an endpoint'
    });
  }

  return {
    ...getAudio,
    apiKey: getCookie(event, 'wb_api_key')
  };
});

function removeHtmlTags(htmlString, stringLimit = 1000) {
  if(htmlString == undefined || htmlString == null) return '';

  try {
      // Remove content within <script> and </head> tags
      let cleanedString = htmlString.replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '');
      cleanedString = cleanedString.replace(/<head[^>]*>([\s\S]*?)<\/head>/gi, '');

      // Remove all remaining HTML tags
      cleanedString = cleanedString.replace(/<\/?[^>]+(>|$)/g, '');
      cleanedString = cleanedString.replace(/\\n/g, '');
      cleanedString = cleanedString.replace(/\s\s+/g, ' ');
      cleanedString = cleanedString.replaceAll('&nbsp', '');
      if(stringLimit != 0) cleanedString = cleanedString.substring(0, stringLimit);

      return cleanedString;
  } catch (error) {
      console.error('Error removing html', error);
      return htmlString
  }
}