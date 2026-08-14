// 역할(그룹) 모델 + 권한 판정 — 순수 함수(DB·요청 비의존)라 단독 테스트 가능.
//   developer : 전체 접속 + 모든 프로젝트 수정 + 사용자/프로젝트 관리. 접속코드 면제.
//   pm        : 담당 프로젝트 멤버 관리·접속코드 설정 + 수정. 담당 프로젝트 코드 면제.
//   user      : 부여받은 프로젝트에 접속코드 입력 후 입장·수정.
export const ROLES = ['developer', 'pm', 'user']
export const isRole = (r) => ROLES.includes(r)

/** 프로젝트 내 역할(멤버십). PM은 관리, user는 편집만. */
export const PROJECT_ROLES = ['pm', 'user']

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
