import { HocuspocusProvider } from '@hocuspocus/provider'
import { create } from 'zustand'
import type { ProjectCrdtRuntime } from './crdt'

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
      },
      onSynced: ({ state }) => {
        if (state) runtime.completeProviderHydration()
      },
      onAuthenticationFailed: ({ reason }) => {
        runtime.completeProviderHydration()
        usePresence.setState({ status: 'error', remote: [], error: reason })
      },
      onAwarenessChange: ({ states }) => {
        usePresence.setState({ remote: extractRemotePresences(states, runtime.doc.clientID) })
      },
    })
  } catch (error) {
    // Offline/disabled collaboration still permits IndexedDB-backed editing.
    runtime.completeProviderHydration()
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
