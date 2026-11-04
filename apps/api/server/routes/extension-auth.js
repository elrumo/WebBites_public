import { defineEventHandler, getCookie, createError } from 'h3'
import Parse from 'parse/node.js';
import { verifySession } from '../utils/sessionCache.js';

// Initialize Parse with your server details
Parse.initialize(import.meta.env.VITE_PARSE_ID, import.meta.env.VITE_PARSE_JS_KEY, import.meta.env.VITE_PARSE_MASTER_KEY);
Parse.serverURL = import.meta.env.VITE_PARSE_URL;

// Define OpenAPI documentation for this route
defineRouteMeta({
  openAPI: {
    tags: ["Authentication"],
    description: "Authenticate a user via session token from cookies for Chrome extension",
    parameters: [
      {
        name: "parse.session",
        in: "cookie",
        description: "Parse session token for authentication",
        required: true,
        schema: {
          type: "string"
        }
      }
    ],
    responses: {
      "200": {
        description: "User successfully authenticated",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: {
                  type: "boolean",
                  example: true
                },
                userId: {
                  type: "string",
                  description: "ID of the authenticated user"
                },
                username: {
                  type: "string",
                  description: "Username of the authenticated user"
                },
                email: {
                  type: "string",
                  description: "Email of the authenticated user"
                },
                sessionToken: {
                  type: "string",
                  description: "Session token for the authenticated user"
                },
                expiresAt: {
                  type: "string",
                  description: "Expiration date of the session token"
                }
              }
            }
          }
        }
      },
      "401": {
        description: "Authentication failed",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                statusCode: {
                  type: "integer",
                  example: 401
                },
                statusMessage: {
                  type: "string",
                  example: "Not authenticated"
                }
              }
            }
          }
        }
      },
      "500": {
        description: "Server error during authentication",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                statusCode: {
                  type: "integer",
                  example: 500
                },
                statusMessage: {
                  type: "string",
                  example: "Authentication failed"
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
  try {
    const sessionToken = getCookie(event, 'parse.session')

    if (!sessionToken) {
      throw createError({
        statusCode: 401,
        statusMessage: 'No session token'
      })
    }

    // Use cached session verification
    const user = await verifySession(sessionToken)

    if (!user) {
      throw createError({
        statusCode: 401,
        statusMessage: 'Invalid session'
      });
    }

    // Get session details for expiresAt
    const sessionQuery = new Parse.Query(Parse.Session);
    sessionQuery.equalTo('sessionToken', sessionToken);
    const session = await sessionQuery.first({ useMasterKey: true });
    const expiresAt = session?.get('expiresAt');

    // Add CORS headers for Chrome extension
    event.node.res.setHeader('Access-Control-Allow-Origin', event.node.req.headers.origin || '*');
    event.node.res.setHeader('Access-Control-Allow-Credentials', 'true');
    event.node.res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    event.node.res.setHeader('Access-Control-Allow-Headers',
      'Content-Type, Authorization, Accept, X-Parse-Application-Id, X-Parse-Session-Token, X-Requested-With');

    // Return user data and auth details
    return {
      success: true,
      userId: user.id,
      username: user.get('username'),
      email: user.get('email'),
      sessionToken: sessionToken,
      expiresAt: expiresAt
    };

  } catch (error) {
    const sessionToken = getCookie(event, 'parse.session')

    // console.error('Extension auth error:', {
    log('Extension auth error:', {
      error,
      event: JSON.stringify(event),
      sessionToken
    });

    // If error is already a H3Error (from createError)
    if (error.statusCode) {
      throw error;
    }

    // Otherwise create a generic error
    throw createError({
      statusCode: 500,
      statusMessage: 'Authentication failed'
    });
  }
});