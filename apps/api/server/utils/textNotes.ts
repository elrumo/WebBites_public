import Parse from 'parse/node.js'
import { createError } from 'h3'
import { getUserWithPlan, getBookmarkQuota } from './plans'
import { initParseForBoards } from './boardUtils'

/**
 * Creating a text-note bite. `routes/v1/content/saveNote.ts` (the apps and the
 * save pipeline) and the MCP `save_note` tool both come through here, so the
 * bookmark quota is checked in one place — the route used to skip it, which
 * made notes the one way past a full plan.
 */

export interface CreateTextNoteInput {
  userId: string
  /** The note body as the apps store it: HTML. */
  textNote: string
  tags?: string[]
  savedFrom?: string
  customId?: string
}

export async function createTextNote(input: CreateTextNoteInput): Promise<Parse.Object> {
  initParseForBoards()
  const { user, plan } = await getUserWithPlan(input.userId)

  if (getBookmarkQuota(user, plan).exceeded) {
    throw createError({
      statusCode: 402,
      statusMessage: 'You have reached your bookmark limit. Upgrade your plan to save more.',
      data: { errorType: 'UsageError', quotaKind: 'bookmarks' },
    })
  }

  const website = new Parse.Object('websites')
  website.setACL(new Parse.ACL(user as Parse.User))
  website.set('url', ' ')
  website.set('user', user)
  website.set('textNote', input.textNote)
  website.set('tags', input.tags || [])
  website.set('type', 'textNote')
  website.set('savedFrom', input.savedFrom || '')
  if (input.customId) website.set('customId', input.customId)

  await website.save(null, { useMasterKey: true })
  return website
}
