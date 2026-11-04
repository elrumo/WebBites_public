import { captureException } from '#root/server/utils/sentry.js';

import { defineEventHandler, readBody, createError } from 'h3';
import { validateInternalApiKey } from '#root/server/utils/api-keys';
import { requireUserId } from '#root/server/utils/requireUser';
import { createTextNote } from '#root/server/utils/textNotes';

// Define OpenAPI documentation for this route
defineRouteMeta({
    openAPI: {
        tags: ["Notes"],
        description: "Save a text note to the user's collection",
        requestBody: {
            description: "Note information to save",
            required: true,
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        required: ["userId", "textNote"],
                        properties: {
                            userId: {
                                type: "string",
                                description: "ID of the user saving the note"
                            },
                            textNote: {
                                type: "string",
                                description: "The text content of the note"
                            },
                            tags: {
                                type: "array",
                                items: { type: "string" },
                                description: "Tags to associate with the note",
                                default: []
                            }
                        }
                    }
                }
            },
        },
        responses: {
            "200": {
                description: "Note successfully saved",
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                status: {
                                    type: "string",
                                    example: "ok"
                                },
                                websiteId: {
                                    type: "string",
                                    description: "The ID of the saved note"
                                }
                            }
                        }
                    }
                }
            },
            "402": {
                description: "Bookmark quota reached (`data.errorType` is `UsageError`)"
            },
            "400": {
                description: "Invalid request parameters",
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                statusCode: {
                                    type: "number",
                                    example: 400
                                },
                                statusMessage: {
                                    type: "string",
                                    example: "No user ID provided"
                                }
                            }
                        }
                    }
                }
            },
            "500": {
                description: "Server error during note saving",
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                statusCode: {
                                    type: "number",
                                    example: 500
                                },
                                statusMessage: {
                                    type: "string",
                                    example: "Error saving note"
                                }
                            }
                        }
                    }
                }
            }
        }
    }
});

interface SaveNoteBody {
    userId: string;
    textNote: string;
    tags?: string[];
    savedFrom?: string;
    customId?: string;
}

export default defineEventHandler(async (event) => {
    console.log("[saveNote] Trying to save note");

    try {
        const rawBody = await readBody(event);
        const body = (typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody) as SaveNoteBody;

        // Users save notes as themselves; only the pipeline may name another user.
        if (!validateInternalApiKey(event)) body.userId = await requireUserId(event);

        // Validate required fields
        if (!body.userId) {
            throw createError({
                statusCode: 400,
                statusMessage: 'No user ID provided'
            });
        }

        if (!body.textNote) {
            throw createError({
                statusCode: 400,
                statusMessage: 'No text note provided'
            });
        }

        // Quota-checked (402 when the plan is full) and shared with MCP's save_note.
        const website = await createTextNote({
            userId: body.userId,
            textNote: body.textNote,
            tags: body.tags,
            savedFrom: body.savedFrom,
            customId: body.customId,
        });

        console.log("Note saved successfully: ", body.userId);

        return {
            status: 'ok',
            websiteId: website.id
        };
    } catch (error) {
        console.log("error saving textNote: ", error);
        captureException(error);

        // If it's already a createError, re-throw it
        if (error.statusCode) {
            throw error;
        }

        // Otherwise, wrap it in a generic error
        throw createError({
            statusCode: 500,
            statusMessage: 'Error saving note'
        });
    }
});
