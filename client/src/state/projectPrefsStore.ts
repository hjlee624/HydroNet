// 프로젝트 목록 개인 설정(F08) — 최근 열기 · 즐겨찾기 + 목록 필터의 순수 함수.
//
// 저장 위치: **사용자별 localStorage**(`sequence:recentProjects:<uid>` / `sequence:favProjects:<uid>`).
// 서버 테이블·라우트를 늘리지 않고 완료 기준을 만족시키는 가장 작은 슬라이스다. 대신 PC 를
// 바꾸면 초기화된다 — 서버 동기화는 후속 과제(scopedOut).
//
// 권한에 대하여: 이 모듈은 **입력으로 받은 배열에서 고르기만 한다**. 새 프로젝트를 만들어 내지
// 않으므로, 서버가 이미 권한으로 걸러 내려준 목록(/api/auth/projects) 위에서 어떤 탭·검색을
// 쓰더라도 권한 범위는 그대로다. filterProjects 의 출력은 항상 입력의 부분집합이다.

import { create } from 'zustand'

/** 최근 목록 보관 개수. 카드 그리드 한두 줄 분량. */
const RECENT_MAX = 8

const recentKey = (uid: string) => `sequence:recentProjects:${uid || 'local'}`
const favKey = (uid: string) => `sequence:favProjects:${uid || 'local'}`

function loadIds(key: string): string[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function saveIds(key: string, ids: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(ids))
  } catch {
    /* 비브라우저/프라이빗 모드 — 이번 세션에만 적용된다 */
  }
}

interface ProjectPrefsState {
  uid: string
  /** 최근 입장 프로젝트 id — 최신순, 최대 RECENT_MAX 개. */
  recent: string[]
  favourites: string[]
  initForUser: (uid: string) => void
  /** 실제 '입장 성공' 시점에만 호출한다(카드 클릭이 아니라 enter() 성공). */
  pushRecent: (projectId: string) => void
  toggleFavourite: (projectId: string) => void
}

export const useProjectPrefs = create<ProjectPrefsState>()((set, get) => ({
  uid: 'local',
  recent: loadIds(recentKey('local')),
  favourites: loadIds(favKey('local')),

  initForUser: (uid) => {
    const next = uid || 'local'
    if (get().uid === next) return
    set({ uid: next, recent: loadIds(recentKey(next)), favourites: loadIds(favKey(next)) })
  },

  pushRecent: (projectId) => {
    if (!projectId) return
    const { uid, recent } = get()
    const next = [projectId, ...recent.filter((id) => id !== projectId)].slice(0, RECENT_MAX)
    saveIds(recentKey(uid), next)
    set({ recent: next })
  },

  toggleFavourite: (projectId) => {
    if (!projectId) return
    const { uid, favourites } = get()
    const next = favourites.includes(projectId)
      ? favourites.filter((id) => id !== projectId)
      : [...favourites, projectId]
    saveIds(favKey(uid), next)
    set({ favourites: next })
  },
}))

/** 목록 탭 — 기본은 '내 프로젝트'(개발자만 '전체'로 시작한다). */
export type ProjectTab = 'mine' | 'fav' | 'recent' | 'all'

export const PROJECT_TABS: { id: ProjectTab; label: string }[] = [
  { id: 'mine', label: '내 프로젝트' },
  { id: 'fav', label: '★ 즐겨찾기' },
  { id: 'recent', label: '🕒 최근' },
  { id: 'all', label: '전체' },
]

/** filterProjects 가 보는 최소 형태 — authStore 의 ProjectSummary 가 이 모양을 만족한다. */
export interface FilterableProject {
  id: string
  name: string
  canEdit?: boolean
  sample?: boolean
}

/** 대소문자·앞뒤 공백 무시 부분일치(TemplateDialog 의 검색과 같은 결). */
export function matchProjectName(p: FilterableProject, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return (p.name || p.id).toLowerCase().includes(needle)
}

/**
 * 탭 + 이름 검색을 적용한다. **출력은 언제나 projects 의 부분집합**이다 —
 * favourites/recent 에 남아 있는 옛 id(권한이 사라졌거나 삭제된 프로젝트)는 입력에 없으므로
 * 결과에도 나타나지 않는다. 검색이 목록에 없던 프로젝트를 드러낼 수 없다는 뜻이다.
 */
export function filterProjects<T extends FilterableProject>(
  projects: T[],
  tab: ProjectTab,
  q: string,
  recent: string[],
  favourites: string[],
): T[] {
  let base: T[]
  if (tab === 'mine') {
    // 내가 편집 권한을 가진(=배정된) 프로젝트. 체험존은 '내 것'이 아니라 공용 샘플이다.
    base = projects.filter((p) => p.canEdit !== false && !p.sample)
  } else if (tab === 'fav') {
    const fav = new Set(favourites)
    base = projects.filter((p) => fav.has(p.id))
  } else if (tab === 'recent') {
    // 최근 순서를 유지하되, 입력 목록에 남아 있는 것만 고른다.
    const byId = new Map(projects.map((p) => [p.id, p]))
    base = recent.map((id) => byId.get(id)).filter((p): p is T => p !== undefined)
  } else {
    base = projects
  }
  return base.filter((p) => matchProjectName(p, q))
}
