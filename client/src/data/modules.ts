// Construction-management package modules (categories). The schedule (마일스톤)
// is the backbone; the rest hang off its dates/공종. Most are scaffolded
// placeholders for now — see PACKAGE_PLAN.md.

export type ModuleId =
  | 'dashboard' | 'schedule' | 'progress' | 'cost' | 'resource'
  | 'quality' | 'safety' | 'document' | 'permit' | 'commissioning' | 'risk' | 'report'

export type ModuleStatus = 'ready' | 'soon'

export interface ModuleDef {
  id: ModuleId
  label: string
  icon: string // emoji
  group: string
  status: ModuleStatus
  blurb: string
  plan: string[] // planned contents (shown on the placeholder)
}

export const GROUPS = ['개요', '공정', '사업비', '자원', '품질·안전', '문서·계약', '준공', '관리'] as const

export const MODULES: ModuleDef[] = [
  { id: 'dashboard', label: '대시보드', icon: '🏠', group: '개요', status: 'ready',
    blurb: '사업 전체 현황을 한눈에', plan: [] },
  { id: 'schedule', label: '공정관리', icon: '📅', group: '공정', status: 'ready',
    blurb: '마일스톤·CPM 공정표 (백본)', plan: [] },
  { id: 'progress', label: '진척·실적', icon: '📈', group: '공정', status: 'soon',
    blurb: '계획 대비 실적·지연',
    plan: ['공정별 % 진척 입력', '베이스라인 스냅샷', '계획선 vs 실적 표시', '지연 공정 하이라이트'] },
  { id: 'cost', label: '원가·예산', icon: '💰', group: '사업비', status: 'soon',
    blurb: '예산 대비 집행·기성',
    plan: ['공종별 예산/집행', '기성(청구·지급)', '경량 EVM(계획-실적)', '예산 소진율 카드'] },
  { id: 'resource', label: '인력·장비', icon: '👷', group: '자원', status: 'soon',
    blurb: '일자별 투입·부하',
    plan: ['공정별 인력/장비 태그', '일자별 부하 히트맵', '과투입(8h↑) 경고', '동원 계획'] },
  { id: 'quality', label: '품질·검측', icon: '✅', group: '품질·안전', status: 'soon',
    blurb: '검측·체크리스트·부적합',
    plan: ['검측요청(WIR)', '검측 체크리스트', '부적합(NCR) 관리', '공정 연계 검측 일정'] },
  { id: 'safety', label: '안전관리', icon: '🦺', group: '품질·안전', status: 'soon',
    blurb: '위험성평가·점검·사고',
    plan: ['위험성평가(JSA)', '안전점검 일지', '사고/아차사고 기록', '안전 지표 카드'] },
  { id: 'document', label: '문서·도면', icon: '📄', group: '문서·계약', status: 'soon',
    blurb: '도면·제출물·계약',
    plan: ['도면 목록·개정 이력', '제출물(submittal) 추적', '계약/변경 문서', '문서 검색'] },
  { id: 'permit', label: '인허가', icon: '📝', group: '문서·계약', status: 'soon',
    blurb: '인허가 항목 추적',
    plan: ['인허가 목록', '신청·승인·기한 추적', '공정 선행조건 연계', '기한 임박 알림'] },
  { id: 'commissioning', label: '시운전', icon: '🏗️', group: '준공', status: 'soon',
    blurb: '시운전 절차·준공',
    plan: ['시운전 절차 체크', '시험성적/기록', '준공·인계 체크리스트', '하자/보완 목록'] },
  { id: 'risk', label: '리스크·이슈', icon: '⚠️', group: '관리', status: 'soon',
    blurb: '이슈 로그·대응',
    plan: ['이슈/리스크 등록', '영향·발생가능성', '대응·담당·기한', '공정 영향 연계'] },
  { id: 'report', label: '보고서', icon: '📊', group: '관리', status: 'soon',
    blurb: '주간·월간 보고',
    plan: ['공정/원가/안전 요약 자동집계', '주간·월간 템플릿', '도면 출력 엔진으로 PDF', '배포 이력'] },
]

export const MODULE_MAP: Record<ModuleId, ModuleDef> = Object.fromEntries(
  MODULES.map((m) => [m.id, m]),
) as Record<ModuleId, ModuleDef>
