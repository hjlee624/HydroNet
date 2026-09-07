import fs from 'node:fs/promises'
import path from 'node:path'
import { Database } from '@hocuspocus/extension-database'
import { Hocuspocus } from '@hocuspocus/server'
import nodeAdapter from 'crossws/adapters/node'
import * as Y from 'yjs'
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

  // #14: 멤버/역할 변경·해임·계정 비활성/삭제가 '이미 열려 있는' collab 연결에 반영되도록
  // 활성 연결을 강제로 닫는다. 재접속 시 authenticateProjectToken 이 최신 저장소 기준으로
  // 재검증하므로 해임=거부 / 강등=권한 재적용된다(연결 시점 스냅샷 권위 문제 해소).
  const closeConnection = (connection) => {
    try {
      connection.close({ code: 4003, reason: 'access-revoked' })
      return true
    } catch {
      return false
    }
  }
  const revokeProjectAccess = (projectId, userId) => {
    const document = hocuspocus.documents.get(projectId)
    if (!document) return 0
    let closed = 0
    for (const connection of document.getConnections()) {
      if (!userId || connection?.context?.userId === userId) {
        if (closeConnection(connection)) closed++
      }
    }
    return closed
  }
  const revokeUser = (userId) => {
    if (!userId) return 0
    let closed = 0
    for (const document of hocuspocus.documents.values()) {
      for (const connection of document.getConnections()) {
        if (connection?.context?.userId === userId && closeConnection(connection)) closed++
      }
    }
    return closed
  }

  // #19: 스냅샷/백업이 최초 시드 JSON이 아니라 '라이브 CRDT' 상태를 반영하도록,
  // 로드된 문서는 메모리 상태를, 아니면 마지막 flush 된 저장 바이너리를 돌려준다.
  const fetchLiveState = async (documentName) => {
    if (!isDocumentName(documentName)) return null
    const loaded = hocuspocus.documents.get(documentName)
    if (loaded) return Y.encodeStateAsUpdate(loaded)
    return rawStorage.fetch(documentName)
  }

  // #20: 프로젝트 삭제 시 라이브 CRDT(ydoc .bin/row) + 레거시 시드 JSON을 함께 정리한다.
  // 활성 연결을 먼저 닫고 문서가 완전히 언로드(최종 flush 포함)된 뒤 삭제해 '삭제 후 재생성'을 막는다.
  const deleteProjectState = async (documentName) => {
    if (!isDocumentName(documentName)) return
    hocuspocus.closeConnections(documentName)
    const deadline = Date.now() + 3_000
    while (hocuspocus.documents.has(documentName) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    try {
      await storage.delete?.(documentName)
    } catch (error) {
      logger.error?.('deleteProjectState: ydoc 삭제 실패', error)
    }
    await fs.unlink(path.join(dataDir, `${documentName}.json`)).catch(() => {})
  }

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
    revokeProjectAccess,
    revokeUser,
    fetchLiveState,
    deleteProjectState,
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
