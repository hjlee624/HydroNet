import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// Isolated HTTP fixture: never reads or changes the running service's documents.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sequence-documents-'))
process.env.HN_DATA_DIR = path.join(root, 'data')
process.env.HN_DOCUMENT_DIR = path.join(root, 'documents')
process.env.HN_AUTOSAVE_DIR = path.join(root, 'autosave')
process.env.HN_ERROR_LOG = path.join(root, 'error.log')
process.env.AUTH_ENABLED = '0'
process.env.AUTH_JWT_SECRET = 'documents-smoke-isolated-test-secret'
const { app } = await import('../src/index.js')
const server = await new Promise((resolve) => {
  const listener = app.listen(0, '127.0.0.1', () => resolve(listener))
})
const url = `http://127.0.0.1:${server.address().port}/api/projects/fixture/documents`
const upload = (body) => fetch(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})
try {
  for (const [body, status, message] of [
    [{ moduleId: 'quality', base64: '' }, 400, '파일 내용이 비어 있습니다.'],
    [{ moduleId: '../bad', base64: 'aGVsbG8=' }, 400, '올바른 문서 모듈이 아닙니다.'],
    [{ moduleId: 'quality', base64: Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64') }, 413, '문서는 파일당 8MB까지 업로드할 수 있습니다.'],
  ]) {
    const response = await upload(body)
    assert.equal(response.status, status, message)
    assert.equal((await response.json()).error, message)
  }
  assert.deepEqual(await (await fetch(url)).json(), [], 'invalid uploads leave no documents')
  const response = await upload({ moduleId: 'quality', name: 'test.txt', base64: 'aGVsbG8=' })
  assert.equal(response.status, 201)
  const document = await response.json()
  assert.equal(await (await fetch(`${url}/${document.id}/content`)).text(), 'hello')
  assert.equal((await (await fetch(url)).json()).length, 1)
  assert.equal((await fetch(`${url}/${document.id}`, { method: 'DELETE' })).status, 200)
  // Unexpected storage errors stay generic; do not expose filesystem paths.
  await fs.writeFile(path.join(root, 'documents', 'broken'), 'not a directory')
  const failed = await fetch(url.replace('/fixture/', '/broken/'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ moduleId: 'quality', base64: 'aGVsbG8=' }),
  })
  assert.equal(failed.status, 500)
  assert.deepEqual(await failed.json(), { error: '서버 오류가 발생했습니다.' })
  console.log('DOCUMENTS SMOKE PASS: validation status/message, no invalid writes, upload/list/download/delete')
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  await fs.rm(root, { recursive: true, force: true })
}
