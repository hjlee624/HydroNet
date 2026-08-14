import path from 'node:path'
import { Database } from '@hocuspocus/extension-database'
import { Hocuspocus } from '@hocuspocus/server'
import nodeAdapter from 'crossws/adapters/node'
import { authenticateProjectToken } from './auth.js'
import { createOriginPolicy } from './origin.js'
import { createSeededYDocStorage } from './seed.js'
import { createFileYDocStorage, createRepoYDocStorage, isDocumentName } from './storage.js'

function waitForDocumentsToUnload(hocuspocus) {
  if (hocuspocus.getDocumentsCount() === 0) return Promise.resolve()
  return new Promise((resolve) => {
    hocuspocus.configuration.extensions.push({
      afterUnloadDocument({ instance }) {
        if (instance.getDocumentsCount() === 0) resolve()
      },
    })
    hocuspocus.closeConnections()
    hocuspocus.flushPendingStores()
  })
}

export function attachCollaborationServer(httpServer, options) {
  const {
    repo,
    authBackend = repo.backend,
    dataDir,
    allowedOrigins,
    timeout = 30_000,
    logger = console,
  } = options
  const rawStorage =
    authBackend === 'pg'
      ? createRepoYDocStorage(repo)
      : createFileYDocStorage(path.join(dataDir, 'ydocs'))
  const storage = createSeededYDocStorage(rawStorage, dataDir)
  const isAllowedOrigin = createOriginPolicy(allowedOrigins)

  const hocuspocus = new Hocuspocus({
    quiet: true,
    timeout,
    debounce: 500,
    maxDebounce: 5_000,
    unloadImmediately: true,
    maxUnauthenticatedQueueSize: 256 * 1024,
    maxUnauthenticatedQueueMessages: 64,
    maxPendingDocuments: 4,
    extensions: [
      new Database({
        fetch: ({ documentName }) => storage.fetch(documentName),
        store: ({ documentName, state }) => storage.store(documentName, state),
      }),
    ],
    async onAuthenticate({ token, documentName, connectionConfig }) {
      if (!isDocumentName(documentName)) throw new Error('invalid-document-name')
      const context = await authenticateProjectToken(repo, token, documentName)
      // 편집 권한(담당/개발자)만 문서 쓰기 허용. 같은 본부 PM 조회 입장 등은 읽기전용 연결.
      connectionConfig.readOnly = !context.canEdit
      return context
    },
  })

  const websocket = nodeAdapter({
    idleTimeout: 30,
    hooks: {
      upgrade(request) {
        const url = new URL(request.url)
        if (url.pathname !== '/collab') return new Response('Not Found', { status: 404 })
        if (!isAllowedOrigin(request)) return new Response('Forbidden', { status: 403 })
      },
      open(peer) {
        peer._sequenceCollab = hocuspocus.handleConnection(peer.websocket, peer.request)
      },
      message(peer, message) {
        peer._sequenceCollab?.handleMessage(message.uint8Array())
      },
      close(peer, event) {
        peer._sequenceCollab?.handleClose({ code: event.code, reason: event.reason })
      },
      error(peer, error) {
        logger.error?.(`Collaboration WebSocket error (${peer.id})`, error)
      },
    },
  })

  const onUpgrade = (request, socket, head) => {
    let pathname = ''
    try {
      pathname = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname
    } catch {
      socket.destroy()
      return
    }
    if (pathname !== '/collab') {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    websocket.handleUpgrade(request, socket, head).catch((error) => {
      logger.error?.('Collaboration upgrade failed', error)
      socket.destroy()
    })
  }
  httpServer.on('upgrade', onUpgrade)

  let destroyPromise
  return {
    hocuspocus,
    storage,
    websocket,
    destroy() {
      destroyPromise ??= (async () => {
        httpServer.off('upgrade', onUpgrade)
        await waitForDocumentsToUnload(hocuspocus)
        await websocket.close(1001, 'server-shutdown')
        await hocuspocus.hooks('onDestroy', { instance: hocuspocus })
      })()
      return destroyPromise
    },
  }
}
