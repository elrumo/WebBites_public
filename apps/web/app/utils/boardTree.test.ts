import { expect, test } from 'bun:test'
import { applyMove, canDrop, planDrop, type TreeBoard } from './boardTree'

// Work/ (folder) holds Design (folder, holds Moodboard) and Notes; Inbox is a top-level board.
const boards: TreeBoard[] = [
  { id: 'work', kind: 'folder', parentId: null, path: [], sortIndex: 0 },
  { id: 'design', kind: 'folder', parentId: 'work', path: ['work'], sortIndex: 0 },
  { id: 'mood', kind: 'board', parentId: 'design', path: ['work', 'design'], sortIndex: 0 },
  { id: 'notes', kind: 'board', parentId: 'work', path: ['work'], sortIndex: 1 },
  { id: 'inbox', kind: 'board', parentId: null, path: [], sortIndex: 1 },
  { id: 'theirs', kind: 'board', parentId: null, path: [], sortIndex: 5, role: 'viewer' },
]

test('a board cannot be a drop target for nesting; a folder can', () => {
  expect(canDrop(boards, 'inbox', 'notes', 'inside')).toBe(false)
  expect(canDrop(boards, 'inbox', 'design', 'inside')).toBe(true)
})

test('a folder cannot go into itself or its own subtree', () => {
  expect(canDrop(boards, 'work', 'design', 'inside')).toBe(false)
  expect(canDrop(boards, 'work', 'mood', 'before')).toBe(false)
  expect(canDrop(boards, 'work', 'work', 'after')).toBe(false)
})

test('shared boards are neither dragged nor dropped on', () => {
  expect(canDrop(boards, 'theirs', 'work', 'inside')).toBe(false)
  expect(canDrop(boards, 'inbox', 'theirs', 'after')).toBe(false)
})

test('dropping inside a folder appends', () => {
  expect(planDrop(boards, 'inbox', 'work', 'inside')).toEqual({ parentId: 'work', orderedIds: ['design', 'notes', 'inbox'] })
})

test('dropping before / after a row reorders among its siblings', () => {
  expect(planDrop(boards, 'notes', 'design', 'before')).toEqual({ parentId: 'work', orderedIds: ['notes', 'design'] })
  expect(planDrop(boards, 'inbox', 'work', 'before')).toEqual({ parentId: null, orderedIds: ['inbox', 'work'] })
})

test('dropping next to a nested row pulls it out to that level', () => {
  expect(planDrop(boards, 'mood', 'inbox', 'after')).toEqual({ parentId: null, orderedIds: ['work', 'inbox', 'mood'] })
})

test('a drop that changes nothing is null', () => {
  expect(planDrop(boards, 'design', 'notes', 'before')).toBeNull()
  expect(planDrop(boards, 'notes', 'design', 'after')).toBeNull()
})

test('applyMove rewrites parent, order and the paths below a moved folder', () => {
  const next = applyMove(boards, null, ['work', 'inbox', 'design'])
  const get = (id: string) => next.find(b => b.id === id)!
  expect(get('design')).toMatchObject({ parentId: null, path: [], sortIndex: 2 })
  expect(get('mood').path).toEqual(['design'])
  expect(get('inbox').sortIndex).toBe(1)
  expect(get('notes').path).toEqual(['work'])
})
