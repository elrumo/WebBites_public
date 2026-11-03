import Parse from 'parse/node';
import { ensureParseInitialized } from '../utils/parseRuntime'
import { verifySession } from '../utils/sessionCache'

export default defineEventHandler(async (event) => {
    ensureParseInitialized()
    try {
        let body = await readBody(event)
        let note = body.noteToSave;

        // Bind the note to the authenticated user rather than trusting the
        // body-provided userId (backendFetch only proves "some logged-in user").
        const sessionToken = getCookie(event, 'parse.session')
        const sessionUser = await verifySession(sessionToken)
        if (sessionUser && note.userId && note.userId !== sessionUser.id) {
            throw createError({ statusCode: 403, statusMessage: 'userId does not match the authenticated user' })
        }

        let noteToSave = {
            userId: sessionUser ? sessionUser.id : note.userId,
            textNote: note.textNote,
            tags: note.tags,
            savedFrom: note.savedFrom,
            customId: note.customId,
        }
        
        let savedNoteId = await backendFetch(event, "v1/content/saveNote", {
            method: 'POST',
            body: noteToSave
        });
        // let savedNoteId = await Parse.Cloud.run("saveNote", noteToSave);

        return { savedNoteId }
    } catch (error) {
        console.log('error saving note: ', error);
        return { error }
    }
})
