import Parse from 'parse/node.js'
import type { H3Event } from 'h3'

import { sendEmail } from '../utils/serverUtils.js'
import importCompleteTemplate from '#root/emailTemplates/importCompleteTemplate'
import changePlanTemplate from '#root/emailTemplates/changePlanTemplate'
import welcomeTemplate from '#root/emailTemplates/welcomeTemplate'

Parse.initialize(
  process.env.VITE_PARSE_ID,
  process.env.VITE_PARSE_JS_KEY,
  process.env.VITE_PARSE_MASTER_KEY
)
Parse.serverURL = process.env.VITE_PARSE_URL

// Type definitions
interface SendEmailRequestBody {
  userId: string
  emailTemplate: EmailTemplateName
  subject?: string
  text?: string
}

type EmailTemplateName = 'importCompleteTemplate' | 'changePlanTemplate' | 'welcomeTemplate'

interface EmailSuccessResponse {
  success: boolean
  message: string
}

interface EmailTemplateConfig {
  html: string
  defaultSubject: string
  defaultText: string
}

defineRouteMeta({
  openAPI: {
    tags: ['Email'],
    summary: 'Send email to user',
    description: 'Sends an email to a user using predefined email templates with dynamic content replacement.',
    requestBody: {
      description: 'Email sending request data',
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              userId: {
                type: 'string',
                description: 'Parse User object ID',
                example: 'abc123def456'
              },
              emailTemplate: {
                type: 'string',
                description: 'Email template to use',
                enum: ['importCompleteTemplate', 'changePlanTemplate', 'welcomeTemplate'],
                example: 'importCompleteTemplate'
              },
              subject: {
                type: 'string',
                description: 'Email subject line (optional, uses template default if not provided)',
                example: 'Your bookmarks have been imported!'
              },
              text: {
                type: 'string',
                description: 'Email text content (optional, uses template default if not provided)',
                example: 'Your bookmarks have all been imported!'
              }
            },
            required: ['userId', 'emailTemplate']
          }
        }
      }
    },
    responses: {
      '200': {
        description: 'Email sent successfully',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: {
                  type: 'boolean',
                  example: true
                },
                message: {
                  type: 'string',
                  example: 'Test email sent successfully'
                }
              },
              required: ['success', 'message']
            }
          }
        }
      },
      '400': {
        description: 'Bad request - missing or invalid parameters',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                statusCode: {
                  type: 'integer',
                  example: 400
                },
                statusMessage: {
                  type: 'string',
                  example: 'Missing userId in request body'
                }
              }
            }
          }
        }
      },
      '404': {
        description: 'User not found',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                statusCode: {
                  type: 'integer',
                  example: 404
                },
                statusMessage: {
                  type: 'string',
                  example: 'User not found'
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
                  type: 'integer',
                  example: 500
                },
                statusMessage: {
                  type: 'string',
                  example: 'Failed to send test email'
                }
              }
            }
          }
        }
      }
    },
    'x-email-templates': {
      description: 'Available email templates and their purposes',
      templates: {
        'importCompleteTemplate': {
          description: 'Sent when bookmark import process is completed',
          defaultSubject: 'Your bookmarks have been imported!',
          defaultText: 'Your bookmarks have all been imported!',
          variables: ['{{name}}'],
          usage: 'Automatically sent after successful bookmark import completion'
        },
        'changePlanTemplate': {
          description: 'Sent when user plan is updated',
          defaultSubject: 'Your plan has been updated!',
          defaultText: 'Your plan has been updated!',
          variables: ['{{name}}'],
          usage: 'Automatically sent after plan change'
        }
      }
    },
    'x-side-effects': {
      description: 'Side effects of successful email sending',
      effects: [
        "Sends email through the configured provider (SMTP or Mailgun) to a user",
        "Replaces template variables with user data (e.g., {{name}} with user's name)",
        'Logs email sending results for debugging purposes'
      ]
    }
  }
})

export default defineEventHandler(async (event: H3Event): Promise<EmailSuccessResponse> => {
  const body = await readBody<SendEmailRequestBody>(event)

  const { userId, emailTemplate, subject: customSubject, text: customText } = body

  if (!userId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing userId in request body'
    })
  }

  if (!emailTemplate) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing emailTemplate in request body'
    })
  }

  try {
    const userQuery = new Parse.Query(Parse.User)
    const user = await userQuery.get(userId, { useMasterKey: true })
    
    if (!user) {
      throw createError({
        statusCode: 404,
        statusMessage: 'User not found'
      })
    }

    const userEmail = user.get('email') as string
    const name = (user.get('name') || user.get('username')) as string
    
    let emailHtml: string
    let subject: string
    let text: string

    const templates: Record<EmailTemplateName, EmailTemplateConfig> = {
      importCompleteTemplate: {
        html: importCompleteTemplate,
        defaultSubject: 'Your bookmarks have been imported!',
        defaultText: 'Your bookmarks have all been imported!'
      },
      changePlanTemplate: {
        html: changePlanTemplate,
        defaultSubject: 'Your plan has been updated!',
        defaultText: 'Your plan has been updated!'
      },
      welcomeTemplate: {
        html: welcomeTemplate,
        defaultSubject: 'Welcome to WebBites!',
        defaultText: 'Welcome to WebBites! We are glad to have you on board.'
      }
    }

    const template = templates[emailTemplate]
    
    if (!template) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid email template'
      })
    }

    emailHtml = template.html
    subject = customSubject || template.defaultSubject
    text = customText || template.defaultText

    const sent = await sendEmail({
      userEmail,
      emailHtml,
      subject,
      text,
      name
    })

    if (!sent.success) {
      throw createError({
        statusCode: 502,
        statusMessage: `Email was not sent: ${sent.reason}`
      })
    }

    return {
      success: true,
      message: `${name}, ${emailTemplate} email sent successfully`
    }
  } catch (error: any) {
    console.error('Error in email endpoint:', error)
    if (error?.statusCode) throw error
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to send email'
    })
  }
})