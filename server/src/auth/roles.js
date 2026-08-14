// 역할(그룹) 모델 + 권한 판정 — 순수 함수(DB·요청 비의존)라 단독 테스트 가능.
//   developer : 전체 접속 + 모든 프로젝트 수정 + 사용자/프로젝트 관리. 접속코드 면제.
//   pm        : 담당 프로젝트 멤버 관리·접속코드 설정 + 수정. 담당 프로젝트 코드 면제.
//   user      : 부여받은 프로젝트에 접속코드 입력 후 입장·수정.
export const ROLES = ['developer', 'pm', 'user']
export const isRole = (r) => ROLES.includes(r)

/** 프로젝트 내 역할(멤버십). PM은 관리, user는 편집만. */
export const PROJECT_ROLES = ['pm', 'user']

/** 본부(조직 단위) 키 — client/src/data/divisions.ts 와 동일하게 유지. */
export const DIVISION_KEYS = new Set([
  'strategy',
  'water-env',
  'water-res',
  'land',
  'railway',
  'road',
  'plant',
  'cm',
  'overseas',
  'bizdev',
  'safety',
])
export const isDivision = (d) => DIVISION_KEYS.has(d)

export const isDeveloper = (user) => user?.role === 'developer'

/** 이 사용자가 모든 프로젝트에 접근 가능한가(개발자만). */
export const canAccessAll = (user) => isDeveloper(user)

/** membership = { projectId, role('pm'|'user') } | null (해당 프로젝트에서의 멤버십). */
export function canEnterProject(user, membership) {
  if (isDeveloper(user)) return true
  return !!membership // 멤버여야 입장 가능
}

/** 접속코드 입력을 면제받는가(개발자 · 그 프로젝트의 PM). user 멤버는 코드 필요. */
export function accessCodeExempt(user, membership) {
  if (isDeveloper(user)) return true
  return membership?.role === 'pm'
}

/** 프로젝트 편집 권한(개발자 · 멤버). */
export function canEditProject(user, membership) {
  return isDeveloper(user) || !!membership
}

/** 프로젝트 멤버·접속코드 관리 권한(개발자 · 그 프로젝트 PM). */
export function canManageProject(user, membership) {
  return isDeveloper(user) || membership?.role === 'pm'
}

/** 새 프로젝트 생성 권한(개발자 · 프로젝트 관리자). 일반 사용자는 불가. */
export function canCreateProject(user) {
  return isDeveloper(user) || user?.role === 'pm'
}

/** 사용자 계정·프로젝트 생성 등 시스템 관리(개발자 전용). */
export function canAdmin(user) {
  return isDeveloper(user)
}

// ── 본부(division) 기반 접근 판정 ────────────────────────────────────────────
/** 같은 본부인가 — 사용자·프로젝트 모두 본부가 있고 동일. 개발자는 division 무관(전체). */
export function sameDivision(user, project) {
  return !!user?.division && !!project?.division && user.division === project.division
}

/** 목록/조회 가능 — 개발자(전체) 또는 같은 본부. */
export function canSeeProject(user, project) {
  return isDeveloper(user) || sameDivision(user, project)
}

/**
 * 입장 가능 — 개발자, 배정 멤버(담당), 또는 같은 본부 PM(조회용 입장).
 * 사용자(user)는 배정(membership)된 프로젝트만 입장 가능(같은 본부라도 미배정이면 목록만).
 */
export function canEnterProjectDiv(user, project, membership) {
  if (isDeveloper(user)) return true
  if (membership) return true
  // 체험존(sample): 같은 본부면 배정 없이 누구나 입장.
  if (project?.sample && sameDivision(user, project)) return true
  return user?.role === 'pm' && sameDivision(user, project)
}

/** 편집 가능 — 개발자·배정 멤버(담당), 그리고 체험존은 같은 본부 누구나. 그 외(조회 입장)는 읽기전용. */
export function canEditProjectDiv(user, project, membership) {
  if (isDeveloper(user) || membership) return true
  if (project?.sample && sameDivision(user, project)) return true
  return false
}
