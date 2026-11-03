/**
 * Plain text → the HTML a text-note bite stores. Kept free of Parse and h3 so
 * it can be tested on its own (`npm run test:textNotes`).
 *
 * Assistants hand us plain text, and the apps render `textNote` as HTML, so
 * every character that means something in HTML is escaped: a note is never a
 * way to put markup (or script) in front of the user.
 */

export function escapeNoteHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Blank lines separate paragraphs; single newlines become `<br>`. A title, when
 * given, becomes the first line as an `<h1>` — the apps title a note by its
 * first line, so that is where it has to go to show up everywhere.
 */
export function plainTextToNoteHtml(text: string, title?: string | null): string {
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${block.split('\n').map(escapeNoteHtml).join('<br>')}</p>`)

  const heading = title?.trim() ? `<h1>${escapeNoteHtml(title.trim())}</h1>` : ''
  return heading + paragraphs.join('')
}
