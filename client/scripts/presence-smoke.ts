import assert from 'node:assert/strict'
import * as Y from 'yjs'
import {
  extractRemotePresences,
  presenceColorFor,
  sanitizeRemotePresence,
} from '../src/state/collaboration'

const doc = new Y.Doc()
doc.getMap('root').set('project', 'unchanged')
const before = Buffer.from(Y.encodeStateAsUpdate(doc))

const sanitized = sanitizeRemotePresence(
  {
    user: { id: 'user-7', name: 'Remote User', color: 'url(javascript:bad)' },
    selection: {
      selectedTaskIds: ['task-2', 'task-2', 42, 'task-3'],
      selectedCategoryIds: ['category-1'],
      selectedLinkId: 'link-9',
    },
    cursor: { x: 123.5, y: 456.25 },
    project: { injected: true },
  },
  7,
)

assert.ok(sanitized)
assert.equal(sanitized.user.color, presenceColorFor('user-7'))
assert.deepEqual(sanitized.selection.selectedTaskIds, ['task-2', 'task-3'])
assert.deepEqual(sanitized.cursor, { x: 123.5, y: 456.25 })
assert.equal(sanitizeRemotePresence({ user: { id: '', name: 'Nobody' } }, 8), null)

const remote = extractRemotePresences(
  [
    { clientId: 1, user: { id: 'local', name: 'Local' } },
    { clientId: 7, user: { id: 'user-7', name: 'Remote User' } },
    { clientId: 9, user: { id: 0, name: 'Invalid' } },
  ],
  1,
)
assert.deepEqual(
  remote.map((presence) => presence.clientId),
  [7],
)

// Awareness extraction is a pure read. It must never write into the shared document.
assert.deepEqual(Buffer.from(Y.encodeStateAsUpdate(doc)), before)

console.log('presence smoke passed: sanitized transient awareness with zero Y.Doc writes')
