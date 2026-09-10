import assert from 'node:assert/strict'
import { signCollabToken } from '../src/auth/crypto.js'
import { authenticateProjectToken } from '../src/collab/auth.js'

const user = { id: 'fixture-user', role: 'user', active: true }
const project = { id: 'fixture-project', active: true }
const repo = {
  getUser: async () => user,
  getProject: async () => project,
  getMembership: async () => ({ role: 'user' }),
}
const token = await signCollabToken(user.id, project.id, 'user', true)
assert.equal((await authenticateProjectToken(repo, token, project.id)).canEdit, true)
project.active = false
await assert.rejects(authenticateProjectToken(repo, token, project.id), {
  reason: 'permission-denied',
})
project.active = true
assert.equal((await authenticateProjectToken(repo, token, project.id)).canEdit, true)
project.active = false
user.role = 'developer'
const developerToken = await signCollabToken(user.id, project.id, 'developer', true)
assert.equal((await authenticateProjectToken(repo, developerToken, project.id)).canEdit, true)
console.log('PASS: active → inactive (same ticket denied) → active')
