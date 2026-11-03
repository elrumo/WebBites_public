/**
 * Three-way merge utility for TipTap HTML content.
 *
 * Given a base (last-known server version), local (current editor), and
 * remote (incoming LiveQuery update), produces a merged HTML string.
 *
 * Strategy:
 *  1. Strip HTML tags to get plain text for diffing.
 *  2. Split into paragraphs (by block-level tags or newlines).
 *  3. Compute a simple line-level diff against base.
 *  4. If both sides changed the *same* paragraph, flag a conflict.
 *  5. Otherwise, apply both sets of changes on top of base.
 *
 * Returns { merged: string, hadConflict: boolean }.
 * If the merge is too messy, returns { merged: null, hadConflict: true }
 * so the caller can fall back to a notification-only approach.
 */

function stripTags(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function toLines(html) {
  return stripTags(html).split('\n').map(l => l.trim())
}

/**
 * Compute which lines changed between base and version.
 * Returns a Map<lineIndex, newContent>.
 */
function diffLines(baseLines, versionLines) {
  const changes = new Map()
  const maxLen = Math.max(baseLines.length, versionLines.length)
  for (let i = 0; i < maxLen; i++) {
    const base = baseLines[i] ?? ''
    const ver = versionLines[i] ?? ''
    if (base !== ver) {
      changes.set(i, ver)
    }
  }
  return changes
}

/**
 * Attempt a three-way merge on HTML content.
 *
 * @param {string} base   – last known server version (before user started editing)
 * @param {string} local  – current editor content
 * @param {string} remote – incoming server version from LiveQuery
 * @returns {{ merged: string|null, hadConflict: boolean, conflictLines: number[] }}
 */
export function mergeTextNote(base, local, remote) {
  // Fast path: remote is identical to what we already have
  if (local === remote) {
    return { merged: local, hadConflict: false, conflictLines: [] }
  }

  // Fast path: remote is identical to base → no external changes
  if (remote === base) {
    return { merged: local, hadConflict: false, conflictLines: [] }
  }

  // Fast path: local is identical to base → user hasn't changed anything
  if (local === base) {
    return { merged: remote, hadConflict: false, conflictLines: [] }
  }

  const baseLines = toLines(base)
  const localLines = toLines(local)
  const remoteLines = toLines(remote)

  const localChanges = diffLines(baseLines, localLines)
  const remoteChanges = diffLines(baseLines, remoteLines)

  // Check for overlapping changes (conflicts)
  const conflictLines = []
  for (const [idx] of localChanges) {
    if (remoteChanges.has(idx)) {
      conflictLines.push(idx)
    }
  }

  // If more than 30% of changed lines conflict, bail out — too messy to auto-merge
  const totalChanged = new Set([...localChanges.keys(), ...remoteChanges.keys()]).size
  if (totalChanged > 0 && conflictLines.length / totalChanged > 0.3) {
    return { merged: null, hadConflict: true, conflictLines }
  }

  // Merge: start from the longer of local/remote line arrays, apply non-conflicting changes
  const mergedLines = [...(localLines.length >= remoteLines.length ? localLines : remoteLines)]

  // Apply remote changes that don't conflict
  for (const [idx, content] of remoteChanges) {
    if (!localChanges.has(idx)) {
      mergedLines[idx] = content
    }
  }

  // For conflict lines, keep the local version (user is actively editing)
  // but flag the conflict

  // Reconstruct as paragraphs wrapped in <p> tags
  const merged = mergedLines
    .filter(l => l !== undefined)
    .map(l => l === '' ? '<p></p>' : `<p>${l}</p>`)
    .join('')

  return { merged, hadConflict: conflictLines.length > 0, conflictLines }
}

/**
 * Check if two HTML strings represent meaningfully different content
 * (ignoring whitespace-only differences).
 */
export function hasContentChanged(oldHtml, newHtml) {
  if (!oldHtml && !newHtml) return false
  if (!oldHtml || !newHtml) return true
  return stripTags(oldHtml) !== stripTags(newHtml)
}
