import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const MAX_BYTES = 8 * 1024 * 1024
const ID_RE = /^[A-Za-z0-9_-]{1,100}$/

const safeName = (value) =>
  String(value || 'document')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .slice(0, 180)

export function createDocumentStore(rootDir) {
  const projectDir = (projectId) => path.join(rootDir, projectId)
  const metaFile = (projectId, id) => path.join(projectDir(projectId), `${id}.json`)
  const blobFile = (projectId, id) => path.join(projectDir(projectId), `${id}.bin`)

  async function list(projectId) {
    let names = []
    try {
      names = await fs.readdir(projectDir(projectId))
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }
    const items = []
    for (const name of names.filter((n) => n.endsWith('.json'))) {
      try {
        items.push(JSON.parse(await fs.readFile(path.join(projectDir(projectId), name), 'utf8')))
      } catch {
        // 손상된 메타 한 건이 전체 문서함을 막지 않게 제외한다.
      }
    }
    return items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  }

  async function put(projectId, input) {
    const raw = String(input?.base64 || '').replace(/^data:[^;]+;base64,/, '')
    const bytes = Buffer.from(raw, 'base64')
    if (!bytes.length) throw Object.assign(new Error('파일 내용이 비어 있습니다.'), { status: 400 })
    if (bytes.length > MAX_BYTES)
      throw Object.assign(new Error('문서는 파일당 8MB까지 업로드할 수 있습니다.'), { status: 413 })
    const id = randomUUID()
    const meta = {
      id,
      moduleId: String(input?.moduleId || ''),
      category: String(input?.category || '기타').slice(0, 80),
      name: safeName(input?.name),
      mimeType: String(input?.mimeType || 'application/octet-stream').slice(0, 120),
      size: bytes.length,
      createdAt: new Date().toISOString(),
      revision: String(input?.revision || '').slice(0, 40),
      status: String(input?.status || '').slice(0, 40),
    }
    if (!ID_RE.test(meta.moduleId))
      throw Object.assign(new Error('올바른 문서 모듈이 아닙니다.'), { status: 400 })
    await fs.mkdir(projectDir(projectId), { recursive: true })
    await fs.writeFile(blobFile(projectId, id), bytes, { flag: 'wx' })
    await fs.writeFile(metaFile(projectId, id), JSON.stringify(meta, null, 2), { flag: 'wx' })
    return meta
  }

  async function get(projectId, id) {
    if (!ID_RE.test(id)) return null
    try {
      const meta = JSON.parse(await fs.readFile(metaFile(projectId, id), 'utf8'))
      const bytes = await fs.readFile(blobFile(projectId, id))
      return { meta, bytes }
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
  }

  async function remove(projectId, id) {
    if (!ID_RE.test(id)) return false
    const found = await get(projectId, id)
    if (!found) return false
    await Promise.all([
      fs.unlink(metaFile(projectId, id)).catch(() => {}),
      fs.unlink(blobFile(projectId, id)).catch(() => {}),
    ])
    return true
  }

  return { list, put, get, remove, rootDir, maxBytes: MAX_BYTES }
}
