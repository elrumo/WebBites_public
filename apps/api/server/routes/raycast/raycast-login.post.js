import { defineEventHandler, readBody, createError } from 'h3'
import Parse from 'parse/node.js'

Parse.initialize(import.meta.env.VITE_PARSE_ID, import.meta.env.VITE_PARSE_JS_KEY, import.meta.env.VITE_PARSE_MASTER_KEY)
Parse.serverURL = import.meta.env.VITE_PARSE_URL

defineRouteMeta({
  openAPI: {
    tags: ["Raycast Authentication"],
    description: "Authenticate user for Raycast extension and return Parse session token",
    requestBody: {
      description: "User login credentials",
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              username: {
                type: "string",
                description: "User's username or email",
                example: "user@example.com"
              },
              password: {
                type: "string",
                description: "User's password",
                example: "securePassword123"
              }
            },
            required: ["username", "password"]
          }
        }
      }
    },
    responses: {
      "200": {
        description: "Login successful",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: {
                  type: "boolean",
                  example: true
                },
                sessionToken: {
                  type: "string",
                  description: "Parse session token for authenticated requests",
                  example: "r:abc123def456..."
                },
                user: {
                  type: "object",
                  properties: {
                    id: {
                      type: "string",
                      description: "User's unique ID"
                    },
                    username: {
                      type: "string",
                      description: "User's username"
                    },
                    email: {
                      type: "string",
                      description: "User's email address"
                    }
                  }
                }
              }
            }
          }
        }
      },
      "400": {
        description: "Missing required fields",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                statusCode: { type: "integer", example: 400 },
                statusMessage: { type: "string", example: "Username and password are required" }
              }
            }
          }
        }
      },
      "401": {
        description: "Invalid credentials",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                statusCode: { type: "integer", example: 401 },
                statusMessage: { type: "string", example: "Invalid username or password" }
              }
            }
          }
        }
      },
      "500": {
        description: "Server error",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                statusCode: { type: "integer", example: 500 },
                statusMessage: { type: "string", example: "Login failed" }
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
    const { username, password } = await readBody(event)

    if (!username || !password) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Username and password are required'
      })
    }

    try {
      const user = await Parse.User.logIn(username, password)
      
      return {
        success: true,
        sessionToken: user.getSessionToken(),
        user: {
          id: user.id,
          username: user.get('username'),
          email: user.get('email')
        }
      }

    } catch (parseError) {
      console.error('Parse login error:', parseError)
      throw createError({
        statusCode: 401,
        statusMessage: 'Invalid username or password'
      })
    }

  } catch (error) {
    console.error('Raycast login error:', error)
    
    if (error.statusCode) {
      throw error
    }
    
    throw createError({
      statusCode: 500,
      statusMessage: 'Login failed'
    })
  }
})