import { HocuspocusProvider } from '@hocuspocus/provider'
import { unzlibSync } from 'fflate'
import * as Y from 'yjs'
import { create } from 'zustand'
import type { ProjectCrdtRuntime } from './crdt'
import { usePersistence } from './persistence'

const PRESENCE_COLORS = [
  '#2563EB',
  '#DC2626',
  '#059669',
  '#7C3AED',
  '#D97706',
  '#DB2777',
  '#0891B2',
  '#4F46E5',
] as const

const MAX_SELECTION_IDS = 200
const MAX_ID_LENGTH = 160

/** 표시용 접속자 역할 — 관리자(개발자·PM) / 사용자. presence 마커/배지 구분에 사용. */
export type PresenceRole = 'admin' | 'user'

export interface PresenceUser {
  id: string
  name: string
  color: string
  role: PresenceRole
}

export interface PresenceSelection {
  selectedTaskIds: string[]
  selectedCategoryIds: string[]
  selectedLinkId: string | null
}

export interface PresenceCursor {
  x: number
  y: number
}

export interface RemotePresence {
  clientId: number
  user: PresenceUser
  selection: PresenceSelection
  cursor: PresenceCursor | null
}

interface PresenceState {
  status: 'offline' | 'connecting' | 'connected' | 'error'
  remote: RemotePresence[]
  error: string | null
}

export const usePresence = create<PresenceState>(() => ({
  status: 'offline',
  remote: [],
  error: null,
}))

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function safeText(value: unknown, maxLength = MAX_ID_LENGTH): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim().slice(0, maxLength)
  return text || null
}

function safeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ids = new Set<string>()
  for (const candidate of value) {
    const id = safeText(candidate)
    if (id) ids.add(id)
    if (ids.size >= MAX_SELECTION_IDS) break
  }
  return [...ids]
}

function safeCoordinate(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000
    ? value
    : null
}

export function presenceColorFor(userId: string): string {
  let hash = 2166136261
  for (let index = 0; index < userId.length; index += 1) {
    hash ^= userId.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return PRESENCE_COLORS[(hash >>> 0) % PRESENCE_COLORS.length]
}

/** Treat awareness as untrusted network input and return only the UI-safe shape. */
export function sanitizeRemotePresence(state: unknown, clientId: number): RemotePresence | null {
  if (!Number.isSafeInteger(clientId) || clientId < 0) return null
  const raw = asRecord(state)
  const rawUser = asRecord(raw?.user)
  const id = safeText(rawUser?.id)
  const name = safeText(rawUser?.name, 80)
  if (!id || !name) return null
  // 역할은 신뢰 불가 입력 — 화이트리스트만 허용(그 외 '사용자'로 강등).
  const role: PresenceRole = rawUser?.role === 'admin' ? 'admin' : 'user'

  const rawSelection = asRecord(raw?.selection)
  const selectedLinkId = safeText(rawSelection?.selectedLinkId)
  const rawCursor = asRecord(raw?.cursor)
  const x = safeCoordinate(rawCursor?.x)
  const y = safeCoordinate(rawCursor?.y)

  return {
    clientId,
    user: {
      id,
      name,
      // Never trust a remote CSS color. Identity-derived colors are stable and safe.
      color: presenceColorFor(id),
      role,
    },
    selection: {
      selectedTaskIds: safeIds(rawSelection?.selectedTaskIds),
      selectedCategoryIds: safeIds(rawSelection?.selectedCategoryIds),
      selectedLinkId,
    },
    cursor: x === null || y === null ? null : { x, y },
  }
}

export function extractRemotePresences(
  states: Array<{ clientId: number; [key: string]: unknown }>,
  localClientId: number,
): RemotePresence[] {
  return states
    .filter((state) => state.clientId !== localClientId)
    .map((state) => sanitizeRemotePresence(state, state.clientId))
    .filter((state): state is RemotePresence => state !== null)
    .sort((left, right) => left.clientId - right.clientId)
}

/** 서버 영속 확정 메시지 타입(server/src/collab/index.js 의 store 훅과 한 쌍). */
const PERSIST_MESSAGE_TYPE = 'sequence:persisted'
/**
 * 확정 payload(JSON 문자열)의 상한. 신뢰 불가 입력이므로 상한 자체는 유지한다.
 *
 * 회귀 이력: 예전 상한은 4096B 였고 확정에는 **압축하지 않은** 상태벡터가 실렸다. 상태벡터는
 * '이 문서에 한 번이라도 쓴 적이 있는 clientID' 마다 한 항목을 갖고, 새로고침·새 탭마다
 * clientID 가 새로 발급된다. 즉 항목 수는 접속자 수가 아니라 **누적 세션 수**로 늘어난다.
 * 실측: 세션 500개 → payload 4036B(통과), 세션 508개 → 4100B(파싱 실패). 그 순간부터
 * parseServerPersistMessage 가 **모든** 확정을 버려서 칩이 영원히 '서버 확정 대기…'로 굳었다
 * — 2년짜리 프로젝트라면 몇 명만 있어도 쉽게 도달하는 숫자다.
 * 지금은 ① 상태벡터를 deflate 압축해 싣고(svz), ② 상한을 크게 올리되, ③ 그래도 넘치면
 * 서버가 상태벡터를 빼고 **집계값(cs/cn/dl)** 만 실어 보낸다. '확정 없음'으로 무너지지 않는다.
 */
export const MAX_STATELESS_LENGTH = 49_152
/**
 * 압축 해제한 상태벡터 원본의 하드 상한(바이트). 압축폭탄 방어선이다 — 서버가 선언한
 * 원본 길이(svn)가 이 값을 넘으면 해제 자체를 하지 않고, 해제 결과 길이가 선언과 다르면 버린다.
 */
export const MAX_ACK_SV_BYTES = 131_072

/** 서버 영속 확정 1건 — '언제'와 '무엇을' 기록했는지. */
export interface ServerPersistAck {
  /** 서버가 알려온 확정 ISO 시각. */
  at: string
  /** 서버가 방금 파일에 쓴 문서의 clientID→다음 clock(Y 상태벡터). 없거나 형식 위반이면 null. */
  clocks: Map<number, number> | null
  /**
   * 서버가 방금 파일에 쓴 문서의 **삭제 총량**(삭제된 clock 개수).
   * 없거나 형식 위반이면 null = '삭제에 대해서는 아무것도 증명하지 못한 확정'.
   */
  deleted: number | null
  /**
   * 상태벡터를 통째로 싣지 못할 만큼 clientID 가 많을 때 쓰는 **집계 증명**: 기록한
   * 상태벡터의 clock 총합. 단조 증가한다(clock 은 줄지 않는다).
   */
  clockSum: number | null
  /** 같은 목적의 집계 증명: 기록한 상태벡터의 clientID 개수. 역시 단조 증가한다. */
  clientCount: number | null
}

/** 이 문서의 로컬 사실 요약 — '서버가 내 것을 다 담았는가' 판정의 좌변. */
export interface LocalDocDigest {
  /** 문서 **전체** 상태벡터(clientID→다음 clock). 내 clientID 하나가 아니다. */
  clocks: Map<number, number>
  /** 이 문서의 삭제 총량. 삭제는 clock 을 전진시키지 않으므로 따로 센다. */
  deleted: number
}

/** base64 문자열 → 바이트. 형식 위반이면 예외를 던진다(호출부가 null 로 흡수). */
function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** 0 이상의 정수 필드만 통과(그 외는 '증명 없음' = null). */
function safeCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

/**
 * 확정에 실린 Y 상태벡터를 꺼낸다. 신뢰 불가 입력이므로 실패는 전부 null.
 *
 * 지금 서버는 deflate(zlib) 압축본을 `svz`(base64)로, 압축 전 원본 길이를 `svn`으로 싣는다.
 * `svn` 이 하드 상한 안에 있을 때만, 그리고 **딱 그 길이만큼** 해제됐을 때만 받아들인다
 * (압축폭탄으로 메모리를 먹이거나 잘린 벡터를 진짜인 척 통과시킬 수 없게).
 * `sv`(비압축 base64)는 예전 서버와의 호환 경로로만 남긴다.
 */
function decodeAckStateVector(record: Record<string, unknown>): Map<number, number> | null {
  const packed = record.svz
  if (typeof packed === 'string' && packed) {
    const rawLength = safeCount(record.svn)
    if (rawLength === null || rawLength === 0 || rawLength > MAX_ACK_SV_BYTES) return null
    try {
      // out 버퍼를 선언 길이+1 로만 잡는다 = 하드 어서션. 더 길면 잘려서 길이 검사에 걸린다.
      const bytes = unzlibSync(base64ToBytes(packed), { out: new Uint8Array(rawLength + 1) })
      if (bytes.length !== rawLength) return null
      return Y.decodeStateVector(bytes)
    } catch {
      return null
    }
  }
  const legacy = record.sv
  if (typeof legacy !== 'string' || !legacy || legacy.length > MAX_STATELESS_LENGTH) return null
  try {
    return Y.decodeStateVector(base64ToBytes(legacy))
  } catch {
    return null
  }
}

/**
 * 서버 영속 확정(stateless) 메시지를 파싱한다. awareness 와 마찬가지로 네트워크에서
 * 온 신뢰 불가 입력이므로, 형식을 조금이라도 벗어나면 전부 무시(null)한다.
 */
export function parseServerPersistMessage(payload: unknown): ServerPersistAck | null {
  if (typeof payload !== 'string' || payload.length > MAX_STATELESS_LENGTH) return null
  let raw: unknown
  try {
    raw = JSON.parse(payload)
  } catch {
    return null
  }
  const record = asRecord(raw)
  if (record?.type !== PERSIST_MESSAGE_TYPE) return null
  const iso = typeof record.at === 'string' ? record.at : null
  if (!iso || !Number.isFinite(Date.parse(iso))) return null
  return {
    at: iso,
    clocks: decodeAckStateVector(record),
    deleted: safeCount(record.dl),
    clockSum: safeCount(record.cs),
    clientCount: safeCount(record.cn),
  }
}

/**
 * 이 문서의 삭제 총량(삭제된 clock 개수).
 *
 * Yjs 의 삭제는 새 struct 를 만들지 않아 어떤 clientID 의 clock 도 올리지 않는다. 삭제 집합은
 * 줄지 않으므로 이 값은 단조 증가하고, 범위가 어떻게 쪼개져 있든(=피어별 인코딩 차이) 총량은
 * 같으므로 서버가 기록한 state 에서 센 값(server/src/collab/index.js 의 deletedClockCount)과
 * 직접 비교할 수 있다.
 */
export function deletedClockCount(doc: Y.Doc): number {
  let total = 0
  for (const ranges of Y.createDeleteSetFromStructStore(doc.store).clients.values()) {
    for (const range of ranges) total += range.len
  }
  return total
}

/** 이 문서의 로컬 사실 요약(전체 상태벡터 + 삭제 총량). */
export function localDocDigest(doc: Y.Doc): LocalDocDigest {
  return {
    clocks: Y.decodeStateVector(Y.encodeStateVector(doc)),
    deleted: deletedClockCount(doc),
  }
}

/**
 * 이 확정이 '내 문서의 내용까지' 담고 있는가 — '서버 동기화 완료'를 켤 자격 판정.
 *
 * 확정 브로드캐스트는 방 전체에 가고, hocuspocus 의 디바운스(500ms)는 내 마지막 타이핑이
 * 서버 RAM 에만 있는 동안에도 그 직전 상태를 파일에 쓴 뒤 확정을 쏜다. 시각만 비교하면
 * 그 확정이 '내 편집이 기록됐다'로 읽힌다.
 *
 * 판정은 **한 clientID 의 clock 하나**가 아니라 두 축을 본다. 예전 방식(내 clientID clock
 * 하나만 비교)은 두 곳에서 뚫렸다.
 *   ① 삭제·되돌리기: Yjs 삭제는 clock 을 전혀 올리지 않아, 삭제 **이전**의 확정이 그대로
 *      통과했다(방금 추가한 공정을 Ctrl+Z 로 되돌린 직후 '완료'가 켜졌다).
 *   ② 새로고침: 재접속하면 Y.Doc 의 clientID 가 새로 발급돼 내 clock 이 0 이 되고, 문서가
 *      옛 clientID 로 복원된 내용을 통째로 들고 있어도 판정이 '증명할 것 없음'으로 무너졌다.
 * 그래서 ⓐ 로컬 상태벡터의 **모든** clientID 에 대해 확정이 그 clock 이상을 담고 있고,
 * ⓑ 확정의 삭제 총량이 내 삭제 총량 이상일 때만 완료로 인정한다. 둘 다 단조 증가라
 * clientID 가 바뀌어도, 남의 내용을 지워도 성립한다.
 *
 * 증명이 없는 확정(구서버·형식 위반 sv/dl)은 완료로 쓰지 않는다. 단, 문서가 통째로 비어
 * 있으면(상태벡터도 삭제도 없음) 증명할 것 자체가 없으므로 그대로 인정한다.
 *
 * 비교는 등호가 아니라 **이상(>=)** 이다. 서버가 나보다 앞서 있는 경우(내가 아직 못 받은
 * 남의 편집까지 기록)를 거짓 미완료로 굳히지 않기 위해서다 — 영구 '대기'는 거짓 '완료'만큼
 * 나쁜 표시다. 남의 업데이트는 store 보다 먼저 브로드캐스트되므로 확정을 처리하는 시점의
 * 내 문서는 이미 그 내용을 담고 있고, 실제로 앞서는 일은 거의 생기지 않는다.
 */
export function ackCoversLocalChanges(ack: ServerPersistAck, local: LocalDocDigest): boolean {
  if (local.clocks.size === 0 && local.deleted === 0) return true
  if (ack.clocks) {
    for (const [clientId, clock] of local.clocks) {
      if ((ack.clocks.get(clientId) ?? 0) < clock) return false
    }
  } else {
    // 강한 증명(상태벡터)을 실을 수 없을 만큼 clientID 가 많은 문서 — 집계 증명으로 내려앉는다.
    //
    // 왜 '아무것도 인정하지 않음'이 아닌가: 상태벡터는 이 문서에 한 번이라도 쓴 clientID 마다
    // 한 항목이고 새로고침마다 새 clientID 가 생기므로, 오래 쓴 프로젝트에서는 어떤 상한을
    // 두든 언젠가 넘는다. 거기서 확정을 전량 버리면 칩은 **영구히** '서버 확정 대기…'가 된다
    // — 거짓 완료만큼 나쁜 거짓말이다.
    // clock 총합·clientID 개수·삭제 총량은 모두 단조 증가하므로 `확정 ⊇ 내 문서 ⇒ 세 값 모두
    // 이상(>=)`이 성립한다(필요조건). 역은 보장되지 않으므로 이 경로는 상태벡터 대조보다
    // 약하다 — 그래서 서버는 실을 수 있는 한 언제나 상태벡터를 싣고, 이 경로는 최후 수단이다.
    if (ack.clockSum === null || ack.clientCount === null) return false
    let localClockSum = 0
    for (const clock of local.clocks.values()) localClockSum += clock
    if (ack.clockSum < localClockSum) return false
    if (ack.clientCount < local.clocks.size) return false
  }
  if (local.deleted > 0 && ack.deleted === null) return false
  if (ack.deleted !== null && ack.deleted < local.deleted) return false
  return true
}

export interface CollaborationSession {
  readonly provider: HocuspocusProvider
  setSelection: (selection: PresenceSelection) => void
  setCursor: (cursor: PresenceCursor | null) => void
  destroy: () => void
}

interface ConnectOptions {
  runtime: ProjectCrdtRuntime
  projectId: string
  projectGrant: string
  user: { id: string; name: string; role: PresenceRole }
}

function websocketUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${window.location.host}/collab`
}

async function fetchCollaborationTicket(projectId: string, projectGrant: string): Promise<string> {
  const response = await fetch(
    `/api/auth/projects/${encodeURIComponent(projectId)}/collab-ticket`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { authorization: `Bearer ${projectGrant}` },
    },
  )
  const payload = (await response.json().catch(() => null)) as {
    ticket?: unknown
    error?: unknown
  } | null
  if (!response.ok || typeof payload?.ticket !== 'string') {
    throw new Error(
      typeof payload?.error === 'string'
        ? payload.error
        : `Collaboration ticket failed (${response.status})`,
    )
  }
  return payload.ticket
}

export async function connectProjectCollaboration({
  runtime,
  projectId,
  projectGrant,
  user,
}: ConnectOptions): Promise<CollaborationSession> {
  if (runtime.projectId !== projectId) {
    throw new Error(`CRDT runtime project mismatch: ${runtime.projectId} != ${projectId}`)
  }
  await runtime.ready

  usePresence.setState({ status: 'connecting', remote: [], error: null })
  // 저장 위치는 '연결됐다'가 아니라 '어느 방에 붙는가'로 정한다. 확정 시각은 서버 메시지로만 채워진다.
  const persistence = usePersistence.getState()
  persistence.setTarget('server', `서버 협업 방 · ${projectId}`)
  persistence.setLink('connecting')
  let provider: HocuspocusProvider
  try {
    provider = new HocuspocusProvider({
      url: websocketUrl(),
      name: projectId,
      document: runtime.doc,
      token: () => fetchCollaborationTicket(projectId, projectGrant),
      flushDelay: 50,
      onStatus: ({ status }) => {
        const nextStatus =
          status === 'connected' ? 'connected' : status === 'connecting' ? 'connecting' : 'offline'
        if (nextStatus === 'offline') runtime.completeProviderHydration()
        usePresence.setState({
          status: nextStatus,
          ...(nextStatus === 'offline' ? { remote: [] } : {}),
        })
        usePersistence.getState().setLink(nextStatus)
      },
      onSynced: ({ state }) => {
        if (state) runtime.completeProviderHydration()
      },
      // 서버가 문서를 실제로 기록한 뒤에만 보내는 확정 메시지 — '서버 동기화 완료'의 유일한 근거.
      // 그리고 그 확정이 **내 편집을 담고 있을 때만** 완료로 인정한다(ackCoversLocalChanges).
      onStateless: ({ payload }) => {
        const ack = parseServerPersistMessage(payload)
        if (!ack) return
        if (!ackCoversLocalChanges(ack, localDocDigest(runtime.doc))) return
        usePersistence.getState().markServerPersisted(ack.at)
      },
      // 미전송 변경 개수는 provider 가 직접 알려준다(추정 금지).
      onUnsyncedChanges: ({ number }) => {
        usePersistence.getState().setPending(number > 0)
      },
      onAuthenticationFailed: ({ reason }) => {
        runtime.completeProviderHydration()
        usePresence.setState({ status: 'error', remote: [], error: reason })
        usePersistence.getState().setLink('error')
      },
      onAwarenessChange: ({ states }) => {
        usePresence.setState({ remote: extractRemotePresences(states, runtime.doc.clientID) })
      },
    })
  } catch (error) {
    // Offline/disabled collaboration still permits IndexedDB-backed editing.
    runtime.completeProviderHydration()
    usePersistence.getState().setLink('error')
    throw error
  }

  provider.setAwarenessField('user', {
    id: user.id,
    name: user.name,
    color: presenceColorFor(user.id),
    role: user.role,
  } satisfies PresenceUser)
  provider.setAwarenessField('selection', {
    selectedTaskIds: [],
    selectedCategoryIds: [],
    selectedLinkId: null,
  } satisfies PresenceSelection)
  provider.setAwarenessField('cursor', null)

  let destroyed = false
  return {
    provider,
    setSelection: (selection) => {
      if (!destroyed) provider.setAwarenessField('selection', selection)
    },
    setCursor: (cursor) => {
      if (!destroyed) provider.setAwarenessField('cursor', cursor)
    },
    destroy: () => {
      if (destroyed) return
      destroyed = true
      runtime.completeProviderHydration()
      provider.awareness?.setLocalState(null)
      provider.destroy()
      usePresence.setState({ status: 'offline', remote: [], error: null })
      usePersistence.getState().setLink('offline')
    },
  }
}

let activeSession: CollaborationSession | null = null

export function setActiveCollaborationSession(session: CollaborationSession | null): void {
  if (activeSession === session) return
  activeSession?.destroy()
  activeSession = session
}

export function publishPresenceSelection(selection: PresenceSelection): void {
  activeSession?.setSelection(selection)
}

export function publishPresenceCursor(cursor: PresenceCursor | null): void {
  activeSession?.setCursor(cursor)
}

export function clearActiveCollaborationSession(): void {
  setActiveCollaborationSession(null)
}
