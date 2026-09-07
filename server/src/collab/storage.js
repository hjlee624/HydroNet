import fs from 'node:fs/promises'
import path from 'node:path'

export const isDocumentName = (name) =>
  typeof name === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(name)

export function createFileYDocStorage(directory) {
  const writeChains = new Map()
  const fileFor = (name) => {
    if (!isDocumentName(name)) throw new Error('invalid-document-name')
    return path.join(directory, `${name}.bin`)
  }

  const serializeWrite = (name, task) => {
    const previous = writeChains.get(name) ?? Promise.resolve()
    const current = previous.then(task, task)
    const tail = current.catch(() => {})
    writeChains.set(name, tail)
    tail.finally(() => {
      if (writeChains.get(name) === tail) writeChains.delete(name)
    })
    return current
  }

  return {
    backend: 'file',
    directory,
    async fetch(documentName) {
      const file = fileFor(documentName)
      try {
        return await fs.readFile(file)
      } catch (error) {
        if (error.code === 'ENOENT') return null
        throw error
      }
    },
    async store(documentName, state) {
      const file = fileFor(documentName)
      await serializeWrite(documentName, async () => {
        await fs.mkdir(directory, { recursive: true })
        const temp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
        try {
          await fs.writeFile(temp, state)
          await fs.rename(temp, file)
        } catch (error) {
          await fs.unlink(temp).catch(() => {})
          throw error
        }
      })
    },
    async delete(documentName) {
      // 프로젝트 삭제 시 라이브 CRDT 바이너리(.bin) 정리 — 고아·민감정보 잔존 방지.
      const file = fileFor(documentName)
      await serializeWrite(documentName, async () => {
        await fs.unlink(file).catch((error) => {
          if (error.code !== 'ENOENT') throw error
        })
        await fs.unlink(`${file}.seed.lock`).catch(() => {})
      })
    },
    async seed(documentName, state) {
      const file = fileFor(documentName)
      const lock = `${file}.seed.lock`
      await fs.mkdir(directory, { recursive: true })
      for (let attempt = 0; attempt < 100; attempt++) {
        let handle
        try {
          handle = await fs.open(lock, 'wx')
          const existing = await this.fetch(documentName)
          if (existing) return existing
          await this.store(documentName, state)
          return Buffer.from(state)
        } catch (error) {
          if (error.code !== 'EEXIST') throw error
          const existing = await this.fetch(documentName)
          if (existing) return existing
          const stat = await fs.stat(lock).catch(() => null)
          if (stat && Date.now() - stat.mtimeMs > 30_000) await fs.unlink(lock).catch(() => {})
          await new Promise((resolve) => setTimeout(resolve, 25))
        } finally {
          if (handle) {
            await handle.close().catch(() => {})
            await fs.unlink(lock).catch(() => {})
          }
        }
      }
      throw new Error(`timed-out-seeding-document:${documentName}`)
    },
  }
}

export function createRepoYDocStorage(repo) {
  if (
    typeof repo.fetchYDoc !== 'function' ||
    typeof repo.storeYDoc !== 'function' ||
    typeof repo.seedYDoc !== 'function'
  ) {
    throw new Error('PostgreSQL repository does not implement Y.Doc persistence')
  }
  return {
    backend: 'pg',
    fetch: (documentName) => repo.fetchYDoc(documentName),
    store: (documentName, state) => repo.storeYDoc(documentName, state),
    seed: (documentName, state) => repo.seedYDoc(documentName, state),
    delete: (documentName) => repo.deleteYDoc(documentName),
  }
}
