import fs from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'
import { Database } from '@hocuspocus/extension-database'
import { Hocuspocus } from '@hocuspocus/server'
import nodeAdapter from 'crossws/adapters/node'
import * as Y from 'yjs'
import { authenticateProjectToken } from './auth.js'
import { createOriginPolicy } from './origin.js'
import { createSeededYDocStorage, decodeProjectFromState } from './seed.js'
import { createFileYDocStorage, createRepoYDocStorage, isDocumentName } from './storage.js'
import { createVersionArchive } from './versions.js'

/**
 * 기록한 state 안의 **삭제 총량**(삭제된 clock 개수).
 *
 * Yjs 의 삭제는 새 struct 를 만들지 않아 상태벡터(clock)를 전혀 전진시키지 않는다. 그래서
 * sv 만 실어 보내면 '내가 방금 지웠다 / Ctrl+Z 로 방금 추가를 되돌렸다'가 확정에 전혀
 * 반영되지 않고, 삭제 **이전**에 만들어진 확정도 clock 비교를 통과해 '서버 동기화 완료'로
 * 읽힌다. 삭제 총량은 범위가 어떻게 쪼개지든(=인코딩 차이) 불변이라 두 피어가 같은 값을
 * 계산하고, 삭제 집합은 줄지 않으므로 단조 증가한다.
 * 클라이언트 대응: client/src/state/collaboration.ts 의 deletedClockCount / localDocDigest.
 */
export function deletedClockCount(state) {
  let total = 0
  for (const ranges of Y.decodeUpdate(state).ds.clients.values()) {
    for (const range of ranges) total += range.len
  }
  return total
}

/**
 * 확정에 실을 수 있는 **압축 상태벡터(base64)** 의 상한.
 *
 * 클라이언트의 payload 상한(MAX_STATELESS_LENGTH = 49_152B)보다 넉넉히 작게 잡아, 나머지
 * JSON 필드(at/dl/cs/cn/svn)를 더해도 절대 넘지 않게 한다. 이걸 넘으면 상태벡터를 **빼고**
 * 집계값만 실어 보낸다 — 클라이언트가 확정을 전량 버려 칩이 영구히 '대기'로 굳는 것보다
 * 약한 증명이라도 보내는 편이 정직하다(client/src/state/collaboration.ts 의 판정 참조).
 */
export const MAX_ACK_SVZ_B64 = 32_768

/**
 * 지금 막 파일에 쓴 state 로부터 확정 메시지 본문을 만든다(순수 함수 — 테스트 대상).
 *
 * 싣는 것:
 *   sv 압축본(svz) + 압축 전 원본 길이(svn) : '무엇을 기록했는가'의 강한 증명.
 *   cs(clock 총합) · cn(clientID 개수)      : svz 를 못 실을 때 쓰는 집계 증명(단조 증가).
 *   dl(삭제 총량)                            : 삭제는 clock 을 올리지 않으므로 별도 축.
 * cs/cn 은 svz 를 실을 때도 항상 함께 보낸다 — 필드 유무로 서버 버전을 추측하게 만들지 않는다.
 */
export function buildPersistAck(state, at = new Date().toISOString()) {
  const sv = Y.encodeStateVectorFromUpdate(state)
  const clocks = Y.decodeStateVector(sv)
  let clockSum = 0
  for (const clock of clocks.values()) clockSum += clock
  const ack = {
    type: 'sequence:persisted',
    at,
    dl: deletedClockCount(state),
    cs: clockSum,
    cn: clocks.size,
  }
  const svz = zlib.deflateSync(Buffer.from(sv)).toString('base64')
  if (svz.length <= MAX_ACK_SVZ_B64) {
    ack.svz = svz
    ack.svn = sv.length
  }
  return ack
}

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
    // F15: 영속 시점 버전 보관(프로젝트 ID 폴더). versionsDir 이 없으면 보관 기능 자체를 끈다.
    versionsDir = null,
    versionKeep = 20,
    versionIntervalMs = 600_000,
  } = options
  const rawStorage =
    authBackend === 'pg'
      ? createRepoYDocStorage(repo)
      : createFileYDocStorage(path.join(dataDir, 'ydocs'))
  const storage = createSeededYDocStorage(rawStorage, dataDir)
  const isAllowedOrigin = createOriginPolicy(allowedOrigins)
  const versions = versionsDir
    ? createVersionArchive({
        root: versionsDir,
        decode: decodeProjectFromState,
        keep: versionKeep,
        minIntervalMs: versionIntervalMs,
        logger,
      })
    : null

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
        store: async ({ documentName, state, document }) => {
          await storage.store(documentName, state)
          // F15: 기록이 끝난 뒤에만 버전 이력을 남긴다(스로틀은 아카이브가 판단).
          if (versions) await versions.retain(documentName, state)
          // F01: 서버가 '실제로 기록을 마쳤다'는 사실만 방 전체에 알린다. 클라이언트의
          // '서버 동기화 완료' 표시는 오직 이 메시지로만 켜진다 — 연결 상태로 지어내지 않는다.
          // store 가 실패하면 위에서 throw 되어 이 줄에 도달하지 않는다(= 확정 없음).
          //
          // 확정에는 **무엇을 기록했는지**(sv)를 같이 싣는다. 방 전체 브로드캐스트라 시각만
          // 보내면 "내 편집이 빠진 저장"의 확정도 남의 화면에서 '완료'로 읽힌다(디바운스
          // 500ms 안에서 실제로 일어난다). sv 는 지금 막 파일에 쓴 그 state 의 상태벡터라
          // (document 현재값이 아니라) 아직 기록되지 않은 편집을 절대 포함하지 않는다.
          //
          // sv 는 **삽입만** 증명한다. 삭제(및 '방금 추가한 것의 Ctrl+Z')는 clock 을 올리지
          // 않으므로 삭제 총량(dl)을 함께 싣는다. 둘 다 지금 막 파일에 쓴 state 에서 뽑는다.
          //
          // 상태벡터는 '이 문서에 한 번이라도 쓴 clientID' 마다 한 항목이고 새로고침·새 탭마다
          // clientID 가 새로 발급되므로 누적 세션 수만큼 늘어난다. 그래서 압축해 싣고
          // (buildPersistAck), 그래도 상한을 넘으면 집계값만 싣는다 — 예전처럼 payload 가
          // 상한을 넘겨 클라이언트가 **모든** 확정을 버리는(칩 영구 '대기') 일이 없도록.
          try {
            document?.broadcastStateless(JSON.stringify(buildPersistAck(state)))
          } catch (error) {
            logger.error?.('persist 확정 브로드캐스트 실패', error)
          }
        },
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
    // 삭제된 프로젝트의 버전 이력도 함께 정리 — 고아 스냅샷이 남지 않도록.
    if (versions) {
      await versions.removeProject(documentName).catch((error) => {
        logger.error?.('deleteProjectState: 버전 이력 삭제 실패', error)
      })
    }
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
    versions,
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
