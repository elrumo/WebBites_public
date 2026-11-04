import { defineEventHandler, readBody, createError } from 'h3'
import Parse from 'parse/node.js';

// Initialize Parse
Parse.initialize(import.meta.env.VITE_PARSE_ID, import.meta.env.VITE_PARSE_JS_KEY, import.meta.env.VITE_PARSE_MASTER_KEY);
Parse.serverURL = import.meta.env.VITE_PARSE_URL;

// Define OpenAPI metadata
defineRouteMeta({
  openAPI: {
    tags: ['Authentication'],
    summary: 'Verify session token',
    description: 'Validates a Parse session token and returns user information',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['sessionToken'],
            properties: {
              sessionToken: {
                type: 'string',
                description: 'Parse session token to verify',
                example: 'r:pnktnjyb996sj4p156gjtp4im'
              }
            }
          }
        }
      }
    },
    responses: {
      '200': {
        description: 'Token verification successful',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: {
                  type: 'boolean',
                  example: true
                },
                user: {
                  type: 'object',
                  properties: {
                    id: {
                      type: 'string',
                      description: 'User object ID',
                      example: 'abc123def456'
                    },
                    username: {
                      type: 'string',
                      description: 'Username',
                      example: 'john_doe'
                    },
                    email: {
                      type: 'string',
                      format: 'email',
                      description: 'User email address',
                      example: 'john@example.com'
                    }
                  },
                  required: ['id', 'username', 'email']
                }
              },
              required: ['success', 'user']
            }
          }
        }
      },
      '400': {
        description: 'Bad request - missing session token',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                statusCode: {
                  type: 'number',
                  example: 400
                },
                statusMessage: {
                  type: 'string',
                  example: 'No token provided'
                }
              }
            }
          }
        }
      },
      '401': {
        description: 'Unauthorized - invalid session token',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                statusCode: {
                  type: 'number',
                  example: 401
                },
                statusMessage: {
                  type: 'string',
                  example: 'Invalid token'
                }
              }
            }
          }
        }
      },
      '500': {
        description: 'Internal server error',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                statusCode: {
                  type: 'number',
                  example: 500
                },
                statusMessage: {
                  type: 'string',
                  example: 'Token verification failed'
                }
              }
            }
          }
        }
      }
    }
  }
})

export default defineEventHandler(async (event) => {
  try {
    // Handle OPTIONS request for CORS preflight
    if (event.node.req.method === 'OPTIONS') {
      event.node.res.setHeader('Access-Control-Allow-Origin', event.node.req.headers.origin || '*');
      event.node.res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      event.node.res.setHeader('Access-Control-Allow-Headers', 
        'Content-Type, Authorization, Accept, X-Parse-Application-Id, X-Parse-Session-Token, X-Requested-With');
      event.node.res.setHeader('Access-Control-Allow-Credentials', 'true');
      event.node.res.setHeader('Access-Control-Max-Age', '86400');
      event.node.res.statusCode = 204;
      event.node.res.end();
      return;
    }
    
    // Get token from request body
    const body = await readBody(event)
    const { sessionToken } = body
    
    if (!sessionToken) {
      throw createError({
        statusCode: 400,
        statusMessage: 'No token provided'
      })
    }
    
    // Verify the token using a server-safe approach
    let user
    try {
      // Query the session by token
      const sessionQuery = new Parse.Query(Parse.Session);
      sessionQuery.equalTo('sessionToken', sessionToken);
      const session = await sessionQuery.first({ useMasterKey: true });
      
      if (!session) {
        throw new Error('Session not found');
      }
      
      // Get the user pointer from the session
      const userPointer = session.get('user');
      
      // Query the user directly by ID
      const userQuery = new Parse.Query(Parse.User);
      user = await userQuery.get(userPointer.id, { useMasterKey: true });
      
      if (!user) {
        throw new Error('User not found');
      }
      
      console.log("Successfully validated token and found user");
      
    } catch (error) {
      console.error('Token validation error:', error);
      throw createError({
        statusCode: 401,
        statusMessage: 'Invalid token'
      });
    }
    
    // Add CORS headers for Chrome extension
    event.node.res.setHeader('Access-Control-Allow-Origin', event.node.req.headers.origin || '*');
    event.node.res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    return {
      success: true,
      user: {
        id: user.id,
        username: user.get('username'),
        email: user.get('email')
      }
    }
  } catch (error) {
    console.error('Token verification error:', error)
    
    // If error is already a H3Error (from createError)
    if (error.statusCode) {
      throw error
    }
    
    // Otherwise create a generic error
    throw createError({
      statusCode: 500,
      statusMessage: 'Token verification failed'
    })
  }
})