import assert from 'node:assert/strict'
import { planFolderWraps } from './boardFolders'

// A > B > C, plus a lone board D. A and B have children, so both get a folder.
const { wraps, rows } = planFolderWraps([
  { id: 'A', parentId: null, path: [], sortIndex: 3 },
  { id: 'B', parentId: 'A', path: ['A'], sortIndex: 0 },
  { id: 'C', parentId: 'B', path: ['A', 'B'], sortIndex: 0 },
  { id: 'D', parentId: null, path: [], sortIndex: 1 },
])

assert.equal(wraps.length, 2)
const [fa, fb] = wraps.map((wrap) => wrap.folderId)
assert.deepEqual(wraps[0], { boardId: 'A', folderId: fa, parentId: null, path: [], sortIndex: 3 })
// B's folder sits where B was: inside A's folder.
assert.deepEqual(wraps[1], { boardId: 'B', folderId: fb, parentId: fa, path: [fa], sortIndex: 1 })
assert.deepEqual(rows.get('A'), { id: 'A', parentId: fa, path: [fa], sortIndex: 0 })
assert.deepEqual(rows.get('B'), { id: 'B', parentId: fb, path: [fa, fb], sortIndex: 0 })
assert.deepEqual(rows.get('C'), { id: 'C', parentId: fb, path: [fa, fb], sortIndex: 1 })
assert.deepEqual(rows.get('D'), { id: 'D', parentId: null, path: [], sortIndex: 1 })
console.log('boardFolders ok')
