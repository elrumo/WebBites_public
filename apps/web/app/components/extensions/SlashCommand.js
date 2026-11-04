import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export const SlashCommandPluginKey = new PluginKey('slashCommand')

const EMPTY = { active: false, query: '', from: null, to: null }

/**
 * Finds the "/" the caret is currently writing after, if there is one.
 *
 * The slash only counts at the start of a block or after whitespace, so a
 * slash inside `and/or` or a URL is just a slash. Code blocks never trigger:
 * a slash there is nearly always code.
 */
function findTrigger(state, shouldStay) {
  const { selection } = state
  if (!selection.empty) return null

  const { $from } = selection
  const parent = $from.parent
  if (!parent.isTextblock || parent.type.name === 'codeBlock') return null

  // Leaf nodes count as one character each, so offsets into this string map
  // one-to-one onto positions in the block.
  const before = parent.textBetween(0, $from.parentOffset, null, '￼')
  const index = before.lastIndexOf('/')
  if (index === -1) return null
  if (index > 0 && !/\s/.test(before[index - 1])) return null

  const query = before.slice(index + 1)
  if (query.includes('/') || query.includes('\n')) return null
  if (!shouldStay(query)) return null

  return { active: true, query, from: $from.start() + index, to: $from.pos }
}

/**
 * The "/" command palette's plumbing.
 *
 * The extension owns no UI and inserts nothing of its own: it tracks where the
 * slash is and what has been typed after it, hands that to whoever is drawing
 * the menu, and lets that menu run ordinary editor commands. Everything the
 * palette can do is something the bubble menu could already do, so the HTML it
 * produces is the HTML this editor has always produced — which is what keeps
 * notes written here readable by the native apps, and the other way round.
 */
export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addOptions() {
    return {
      /** Whether a query is still worth keeping the menu open for. */
      shouldStay: () => true,
      /** Called whenever the trigger appears, changes or goes away. */
      onStateChange: () => {},
      /** First refusal on key presses while the menu is open. */
      onKeyDown: () => false,
    }
  },

  addProseMirrorPlugins() {
    const options = this.options

    return [
      new Plugin({
        key: SlashCommandPluginKey,

        state: {
          init: () => ({ ...EMPTY, dismissedAt: null }),

          apply(tr, previous, oldState, state) {
            if (tr.getMeta(SlashCommandPluginKey)?.dismiss) {
              const current = findTrigger(state, options.shouldStay)
              return { ...EMPTY, dismissedAt: current ? current.from : null }
            }

            const match = findTrigger(state, options.shouldStay)
            if (!match) return { ...EMPTY, dismissedAt: null }

            // A dismissed slash stays dismissed until the caret leaves it, so
            // Escape doesn't reopen the menu on the very next keystroke.
            if (previous.dismissedAt !== null && previous.dismissedAt === match.from) {
              return { ...EMPTY, dismissedAt: previous.dismissedAt }
            }
            return { ...match, dismissedAt: null }
          },
        },

        props: {
          handleKeyDown(view, event) {
            if (!SlashCommandPluginKey.getState(view.state)?.active) return false
            return options.onKeyDown(event) === true
          },
        },

        view() {
          let previous = { ...EMPTY }

          return {
            update(view) {
              const next = SlashCommandPluginKey.getState(view.state)
              if (!next) return

              const unchanged =
                next.active === previous.active &&
                next.query === previous.query &&
                next.from === previous.from
              // The caret still moves the menu even when the query hasn't
              // changed — the window can scroll under it.
              if (unchanged && !next.active) return

              previous = { active: next.active, query: next.query, from: next.from }

              options.onStateChange({
                active: next.active,
                query: next.query,
                from: next.from,
                to: next.to,
                rect: next.active ? view.coordsAtPos(next.from) : null,
              })
            },

            destroy() {
              options.onStateChange({ ...EMPTY, rect: null })
            },
          }
        },
      }),
    ]
  },
})

/** Closes the menu without touching what has been typed. */
export function dismissSlashCommand(editor) {
  if (!editor) return
  editor.view.dispatch(editor.state.tr.setMeta(SlashCommandPluginKey, { dismiss: true }))
}
