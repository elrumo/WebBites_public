/**
 * What the "/" palette offers.
 *
 * Deliberately the same vocabulary, in the same order, as the native apps'
 * palette (`NoteBlockCatalogue.swift`): every entry is a block both editors
 * understand, so a note started on an iPhone and finished in the browser has
 * no blocks in it that the other side has to guess at.
 *
 * Each entry runs ordinary editor commands. Nothing here writes markup of its
 * own, which is what keeps the stored HTML unchanged.
 */

import { useNuxtApp } from '#app'

// Read at call time (inside the title/subtitle getters) so a locale change is picked up.
const t = (key) => useNuxtApp().$i18n.t(key)

// Group ids; their headings are `editor.slash.groups.<id>`.
export const SLASH_GROUPS = ['basic', 'media']

export const SLASH_COMMANDS = [
  {
    id: 'paragraph',
    get title() { return t('editor.slash.items.paragraph.title') },
    get subtitle() { return t('editor.slash.items.paragraph.subtitle') },
    icon: 'i-heroicons-bars-3-bottom-left',
    group: 'basic',
    keywords: ['paragraph', 'body', 'plain'],
    isActive: (editor) => editor.isActive('paragraph'),
    run: (chain) => chain.setParagraph().run(),
  },
  {
    id: 'heading1',
    get title() { return t('editor.slash.items.heading1.title') },
    get subtitle() { return t('editor.slash.items.heading1.subtitle') },
    icon: 'i-heroicons-h1',
    group: 'basic',
    keywords: ['h1', 'title', 'large'],
    isActive: (editor) => editor.isActive('heading', { level: 1 }),
    run: (chain) => chain.setNode('heading', { level: 1 }).run(),
  },
  {
    id: 'heading2',
    get title() { return t('editor.slash.items.heading2.title') },
    get subtitle() { return t('editor.slash.items.heading2.subtitle') },
    icon: 'i-heroicons-h2',
    group: 'basic',
    keywords: ['h2', 'subtitle'],
    isActive: (editor) => editor.isActive('heading', { level: 2 }),
    run: (chain) => chain.setNode('heading', { level: 2 }).run(),
  },
  {
    id: 'heading3',
    get title() { return t('editor.slash.items.heading3.title') },
    get subtitle() { return t('editor.slash.items.heading3.subtitle') },
    icon: 'i-heroicons-h3',
    group: 'basic',
    keywords: ['h3'],
    isActive: (editor) => editor.isActive('heading', { level: 3 }),
    run: (chain) => chain.setNode('heading', { level: 3 }).run(),
  },
  {
    id: 'bulletList',
    get title() { return t('editor.slash.items.bulletList.title') },
    get subtitle() { return t('editor.slash.items.bulletList.subtitle') },
    icon: 'i-heroicons-list-bullet',
    group: 'basic',
    keywords: ['ul', 'unordered', 'dot', 'point'],
    isActive: (editor) => editor.isActive('bulletList'),
    run: (chain) => chain.toggleBulletList().run(),
  },
  {
    id: 'orderedList',
    get title() { return t('editor.slash.items.orderedList.title') },
    get subtitle() { return t('editor.slash.items.orderedList.subtitle') },
    icon: 'i-heroicons-numbered-list',
    group: 'basic',
    keywords: ['ol', 'ordered', 'number', 'step'],
    isActive: (editor) => editor.isActive('orderedList'),
    run: (chain) => chain.toggleOrderedList().run(),
  },
  {
    id: 'taskList',
    get title() { return t('editor.slash.items.taskList.title') },
    get subtitle() { return t('editor.slash.items.taskList.subtitle') },
    icon: 'i-heroicons-check-circle',
    group: 'basic',
    keywords: ['todo', 'task', 'checkbox', 'tick', 'check'],
    isActive: (editor) => editor.isActive('taskList'),
    run: (chain) => chain.toggleTaskList().run(),
  },
  {
    id: 'blockquote',
    get title() { return t('editor.slash.items.blockquote.title') },
    get subtitle() { return t('editor.slash.items.blockquote.subtitle') },
    icon: 'i-heroicons-chat-bubble-bottom-center-text',
    group: 'basic',
    keywords: ['blockquote', 'cite', 'citation'],
    isActive: (editor) => editor.isActive('blockquote'),
    run: (chain) => chain.toggleBlockquote().run(),
  },
  {
    id: 'codeBlock',
    get title() { return t('editor.slash.items.codeBlock.title') },
    get subtitle() { return t('editor.slash.items.codeBlock.subtitle') },
    icon: 'i-heroicons-code-bracket',
    group: 'basic',
    keywords: ['pre', 'monospace', 'snippet', 'syntax'],
    isActive: (editor) => editor.isActive('codeBlock'),
    run: (chain) => chain.toggleCodeBlock().run(),
  },
  {
    id: 'horizontalRule',
    get title() { return t('editor.slash.items.horizontalRule.title') },
    get subtitle() { return t('editor.slash.items.horizontalRule.subtitle') },
    icon: 'i-heroicons-minus',
    group: 'basic',
    keywords: ['hr', 'rule', 'line', 'separator', 'break'],
    isActive: () => false,
    run: (chain) => chain.setHorizontalRule().run(),
  },
  {
    id: 'image',
    get title() { return t('editor.slash.items.image.title') },
    get subtitle() { return t('editor.slash.items.image.subtitle') },
    icon: 'i-heroicons-photo',
    group: 'media',
    keywords: ['picture', 'photo', 'upload', 'media'],
    isActive: () => false,
    // The picker is asynchronous, so the range is cleared first and the
    // command hands off to whatever the editor gave it.
    run: (chain, { addImage }) => {
      chain.run()
      addImage?.()
    },
  },
]

/**
 * The entries matching what has been typed after the "/".
 *
 * A prefix match sorts above a merely-contained one, so typing "co" offers
 * Code before anything that happens to contain "co". Ties keep catalogue
 * order: a palette that reshuffles under your fingers is worse than one that
 * doesn't filter at all.
 */
export function matchSlashCommands(query) {
  const needle = (query || '').trim().toLowerCase()
  if (!needle) return SLASH_COMMANDS

  return SLASH_COMMANDS
    .map((command, order) => {
      const terms = [command.title.toLowerCase(), ...command.keywords]
      if (terms.some((term) => term.startsWith(needle))) return { command, rank: 0, order }
      if (terms.some((term) => term.includes(needle))) return { command, rank: 1, order }
      return null
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map((entry) => entry.command)
}
