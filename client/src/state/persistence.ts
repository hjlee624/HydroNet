// 저장·동기화 '사실' 저장소(F01) — 화면에 뜨는 저장 문구를 연결 상태가 아니라
// **실제 영속 확정**에서 끌어낸다. 서버가 문서를 기록한 뒤 보내오는 확정 메시지
// (server/src/collab/index.js 의 sequence:persisted)와 IndexedDB flush 완료만이
// '완료'를 만들 수 있고, 미전송 변경(provider onUnsyncedChanges)이 하나라도 있으면
// 절대 완료로 표시하지 않는다.
//
// 의존성은 zustand 뿐 — store.ts / crdt.ts / authStore.ts 를 import 하지 않는다(순환 방지).
import { create } from 'zustand'

/** 이 문서가 실제로 어디에 저장되는가 — 협업 방(서버) vs 이 브라우저(로컬). */
export type PersistTarget = 'server' | 'local'

/** 협업 전송로(provider) 상태. usePresence.status 와 같은 어휘를 쓴다. */
export type PersistLink = 'offline' | 'connecting' | 'connected' | 'error'

/** 저장 상태 칩의 색/의미 구분. */
export type SaveTone = 'synced' | 'pending' | 'offline' | 'localonly' | 'error' | 'readonly'

export interface PersistenceState {
  target: PersistTarget
  link: PersistLink
  /** 서버 영속 확정 메시지를 받은 시각(클라 시계 — 서버·클라 시차로 표시가 뒤틀리지 않게). */
  serverConfirmedAt: number | null
  /** 서버가 알려온 확정 ISO 문자열(툴팁·상세 표시용). */
  serverConfirmedIso: string | null
  /** IndexedDB flush 가 실제로 끝난 시각. */
  localConfirmedAt: number | null
  /** 아직 서버로 보내지 못한 변경이 있는가(provider onUnsyncedChanges). */
  pending: boolean
  /** 마지막 '로컬 편집' 시각 — 이보다 오래된 확정은 완료가 아니다. */
  lastLocalChangeAt: number | null
  /** 사용자가 .json 파일로 백업한 시각(서버 동기화와 별개). */
  fileBackupAt: number | null
  /** 이 방에서 편집 권한이 없는가(조회 전용 입장). store.readOnly 를 그대로 반영한다. */
  readOnly: boolean
  /** 표시용 저장 위치 문구. */
  location: string
  setTarget: (target: PersistTarget, location: string) => void
  setLink: (link: PersistLink) => void
  setPending: (pending: boolean) => void
  setReadOnly: (readOnly: boolean) => void
  markServerPersisted: (iso: string) => void
  markLocalPersisted: () => void
  markLocalChange: () => void
  markFileBackup: () => void
}

const INITIAL = {
  target: 'local' as PersistTarget,
  link: 'offline' as PersistLink,
  serverConfirmedAt: null,
  serverConfirmedIso: null,
  localConfirmedAt: null,
  pending: false,
  lastLocalChangeAt: null,
  fileBackupAt: null,
  readOnly: false,
  location: '이 브라우저(로컬 저장소)',
}

export const usePersistence = create<PersistenceState>((set) => ({
  ...INITIAL,
  setTarget: (target, location) =>
    set((state) =>
      state.target === target && state.location === location
        ? state
        : // 저장 위치가 바뀌면 이전 대상의 확정 시각은 더 이상 이 문서의 사실이 아니다.
          //
          // fileBackupAt 도 **같이** 지운다. 예전에는 서버 확정 시각만 지워서, projA 를 파일로
          // 백업한 뒤 projB 로 갈아타면(connectProjectCollaboration 이 프로젝트 전환마다
          // setTarget 을 부른다) 칩이 projB 에 대해 '파일 백업 15:04 · 마지막 파일 백업 이후
          // 변경 없음'이라고 말했다 — 한 번도 백업한 적 없는 문서에 대해서. 확정 시각과 같은
          // 종류의 거짓말이므로 같은 자리에서 함께 지운다.
          {
            ...state,
            target,
            location,
            serverConfirmedAt: null,
            serverConfirmedIso: null,
            fileBackupAt: null,
          },
    ),
  setLink: (link) => set((state) => (state.link === link ? state : { ...state, link })),
  setPending: (pending) =>
    set((state) => (state.pending === pending ? state : { ...state, pending })),
  setReadOnly: (readOnly) =>
    set((state) => (state.readOnly === readOnly ? state : { ...state, readOnly })),
  markServerPersisted: (iso) => set({ serverConfirmedAt: Date.now(), serverConfirmedIso: iso }),
  markLocalPersisted: () => set({ localConfirmedAt: Date.now() }),
  markLocalChange: () => set({ lastLocalChangeAt: Date.now() }),
  markFileBackup: () => set({ fileBackupAt: Date.now() }),
}))

/** describeSaveStatus 가 보는 사실들만 추린 입력(스모크 테스트에서 그대로 조립한다). */
export type SaveStatusInput = Pick<
  PersistenceState,
  'target' | 'link' | 'serverConfirmedAt' | 'localConfirmedAt' | 'pending' | 'lastLocalChangeAt'
> &
  Partial<Pick<PersistenceState, 'readOnly'>>

export interface SaveStatusView {
  tone: SaveTone
  label: string
  detail: string
}

/** epoch ms → 'HH:MM'. 값이 없으면 빈 문자열. */
export function formatClock(at: number | null): string {
  if (at === null) return ''
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * 저장 상태 표시 모델 — 순수 함수(테스트 대상).
 *
 * 판정 순서가 곧 안전 규칙이다. 연결이 되어 있다는 사실만으로는 절대 '완료'가 되지
 * 않으며, 미전송 변경이 있거나 확정 시각이 마지막 로컬 편집보다 오래됐으면 '전송 대기'다.
 */
export function describeSaveStatus(state: SaveStatusInput): SaveStatusView {
  const { target, link, serverConfirmedAt, localConfirmedAt, pending, lastLocalChangeAt } = state
  const readOnly = state.readOnly === true

  // 1) 단독 편집(협업 방 밖) — 서버에는 아무것도 올라가지 않는다. 있는 그대로 말한다.
  if (target === 'local') {
    const localStale =
      localConfirmedAt === null ||
      (lastLocalChangeAt !== null && localConfirmedAt < lastLocalChangeAt)
    return {
      tone: 'localonly',
      label: '로컬만 저장',
      detail: localStale
        ? '이 브라우저에 기록 대기 — 서버에는 올라가지 않습니다'
        : `${formatClock(localConfirmedAt)} 이 브라우저에 기록됨 — 서버에는 올라가지 않습니다`,
    }
  }

  // 2) 인증·연결 오류 — 전송로 자체가 죽었다.
  if (link === 'error') return { tone: 'error', label: '동기화 오류', detail: '서버 미반영' }

  // 3) 끊김/연결 중 — 지금 보낸 편집은 서버에 없다.
  if (link !== 'connected')
    return {
      tone: 'offline',
      label: '연결 끊김',
      detail: '서버 미반영 — 재연결 시 자동 전송',
    }

  // 4) 조회 전용 입장 — 서버가 이 연결의 업데이트를 애초에 받지 않는다(readOnly 연결).
  //    hocuspocus 는 거부한 업데이트에도 SyncStatus(false) 로 답하고 provider 는 적용된
  //    업데이트만 미전송 카운터에서 뺀다. 그래서 여기서 pending 을 먼저 보면 조회 전용
  //    사용자의 칩이 세션 내내 '전송 대기…'로 굳는다 — 보낼 것 자체가 없는데도.
  if (readOnly)
    return {
      tone: 'readonly',
      label: '조회 전용',
      detail: '편집 권한이 없어 이 화면의 변경은 서버로 전송되지 않습니다',
    }

  // 5) 미전송 변경 존재 — 연결돼 있어도 완료가 아니다.
  if (pending) return { tone: 'pending', label: '전송 대기…', detail: '변경을 서버로 보내는 중' }

  // 6) 아직 서버의 기록 확정을 한 번도 못 받았다.
  if (serverConfirmedAt === null)
    return { tone: 'pending', label: '서버 확정 대기…', detail: '서버 기록 확인 전' }

  // 7) 확정은 있었지만 그 뒤에 또 편집됐다 — 최신 내용은 아직 확정 전.
  if (lastLocalChangeAt !== null && serverConfirmedAt < lastLocalChangeAt)
    return {
      tone: 'pending',
      label: '서버 확정 대기…',
      detail: `최근 확정 ${formatClock(serverConfirmedAt)} 이후 변경됨`,
    }

  return {
    tone: 'synced',
    label: `서버 동기화 완료 · ${formatClock(serverConfirmedAt)}`,
    detail: '서버가 이 내용을 기록했습니다',
  }
}
