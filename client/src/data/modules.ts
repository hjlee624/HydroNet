// Construction-management package modules (categories). The schedule (마일스톤)
// is the backbone; the rest hang off its dates/공종. Most are scaffolded
// placeholders for now — see PACKAGE_PLAN.md.

export type ModuleId =
  | 'dashboard'
  | 'schedule'
  | 'progress'
  | 'cost'
  | 'boq'
  | 'resource'
  | 'quality'
  | 'safety'
  | 'document'
  | 'permit'
  | 'commissioning'
  | 'risk'
  | 'report'

export type ModuleStatus = 'ready' | 'soon'

/** 기록형 모듈의 한 컬럼(필드) 정의. `RecordModule`이 이 스키마로 표/입력을 그린다. */
export interface ModuleField {
  /** ModuleRecord.values 의 키. */
  key: string
  label: string
  type?: 'text' | 'date' | 'num' | 'select'
  /** type==='select' 일 때의 선택지. */
  options?: string[]
  /** 넓은 컬럼(내용/명칭 등 긴 텍스트). */
  wide?: boolean
  /** 계산 컬럼(입력 없음). 두 숫자 필드를 곱(mul)/차(sub)로 자동 산출. 예: 금액=수량×단가, 잔액=예산-집행. */
  compute?: { op: 'mul' | 'sub'; keys: [string, string] }
  /** 합계 행에서 제외(단가·수량처럼 합산이 무의미한 컬럼). */
  noTotal?: boolean
}

export interface ModuleDef {
  id: ModuleId
  label: string
  icon: string // emoji
  group: string
  status: ModuleStatus
  blurb: string
  plan: string[] // planned contents (shown on the placeholder)
  /** 기록형 모듈이면 표 컬럼 스키마. 있으면 RecordModule로 렌더한다. */
  fields?: ModuleField[]
}

export const GROUPS = [
  '개요',
  '공정',
  '사업비',
  '자원',
  '품질·안전',
  '문서·계약',
  '준공',
  '관리',
] as const

export const MODULES: ModuleDef[] = [
  {
    id: 'dashboard',
    label: '대시보드',
    icon: '🏠',
    group: '개요',
    status: 'ready',
    blurb: '사업 전체 현황을 한눈에',
    plan: [],
  },
  {
    id: 'schedule',
    label: '공정관리',
    icon: '📅',
    group: '공정',
    status: 'ready',
    blurb: '마일스톤·CPM 공정표 (백본)',
    plan: [],
  },
  {
    id: 'progress',
    label: '진척·실적',
    icon: '📈',
    group: '공정',
    status: 'soon',
    blurb: '계획 대비 실적·지연',
    plan: [
      '공정별 % 진척 입력',
      '베이스라인 스냅샷',
      '계획선 vs 실적 표시',
      '지연 공정 하이라이트',
    ],
  },
  {
    id: 'cost',
    label: '프로젝트 예산',
    icon: '💰',
    group: '사업비',
    status: 'soon',
    blurb: '사업 예산 대비 집행·잔액',
    plan: [
      '구분별(공사비·설계비·감리비·보상비·예비비) 예산',
      '집행액·잔액 자동',
      '예산 소진율(보고서 집계)',
    ],
    fields: [
      {
        key: 'group',
        label: '구분',
        type: 'select',
        options: ['공사비', '설계비', '감리비', '보상비', '행정/기타', '예비비'],
      },
      { key: 'item', label: '항목', wide: true },
      { key: 'budget', label: '예산(천원)', type: 'num' },
      { key: 'spent', label: '집행(천원)', type: 'num' },
      { key: 'balance', label: '잔액(천원)', compute: { op: 'sub', keys: ['budget', 'spent'] } },
      { key: 'note', label: '비고', wide: true },
    ],
  },
  {
    id: 'boq',
    label: '공사 사업비',
    icon: '🧮',
    group: '사업비',
    status: 'soon',
    blurb: '공사비 수량·내역(단가·금액)',
    plan: [
      '공종별 품목·규격·단위',
      '수량 × 단가 = 금액 자동',
      '내역 합계(공사비)',
      '적산/내역서 기반',
    ],
    fields: [
      { key: 'category', label: '공종' },
      { key: 'item', label: '품목', wide: true },
      { key: 'spec', label: '규격' },
      { key: 'unit', label: '단위' },
      { key: 'qty', label: '수량', type: 'num', noTotal: true },
      { key: 'price', label: '단가(원)', type: 'num', noTotal: true },
      { key: 'amount', label: '금액(원)', compute: { op: 'mul', keys: ['qty', 'price'] } },
      { key: 'note', label: '비고' },
    ],
  },
  {
    id: 'resource',
    label: '인력·장비',
    icon: '👷',
    group: '자원',
    status: 'soon',
    blurb: '일자별 투입·부하',
    plan: ['공정별 인력/장비 태그', '일자별 부하 히트맵', '과투입(8h↑) 경고', '동원 계획'],
    fields: [
      { key: 'type', label: '구분', type: 'select', options: ['인력', '장비'] },
      { key: 'name', label: '명칭', wide: true },
      { key: 'task', label: '공정/공종' },
      { key: 'date', label: '투입일', type: 'date' },
      { key: 'qty', label: '수량', type: 'num' },
      { key: 'note', label: '비고' },
    ],
  },
  {
    id: 'quality',
    label: '품질·검측',
    icon: '✅',
    group: '품질·안전',
    status: 'soon',
    blurb: '검측·체크리스트·부적합',
    plan: ['검측요청(WIR)', '검측 체크리스트', '부적합(NCR) 관리', '공정 연계 검측 일정'],
    fields: [
      {
        key: 'type',
        label: '구분',
        type: 'select',
        options: ['검측요청(WIR)', '부적합(NCR)', '체크리스트'],
      },
      { key: 'target', label: '대상', wide: true },
      { key: 'category', label: '공종' },
      { key: 'date', label: '일자', type: 'date' },
      { key: 'status', label: '상태', type: 'select', options: ['대기', '합격', '불합격', '재검'] },
      { key: 'note', label: '비고', wide: true },
    ],
  },
  {
    id: 'safety',
    label: '안전관리',
    icon: '🦺',
    group: '품질·안전',
    status: 'soon',
    blurb: '위험성평가·점검·사고',
    plan: ['위험성평가(JSA)', '안전점검 일지', '사고/아차사고 기록', '안전 지표 카드'],
    fields: [
      {
        key: 'type',
        label: '구분',
        type: 'select',
        options: ['위험성평가', '안전점검', '사고/아차사고'],
      },
      { key: 'content', label: '내용', wide: true },
      { key: 'location', label: '위치/공종' },
      { key: 'date', label: '일자', type: 'date' },
      { key: 'level', label: '위험도', type: 'select', options: ['상', '중', '하'] },
      { key: 'action', label: '조치', wide: true },
    ],
  },
  {
    id: 'document',
    label: '문서·도면',
    icon: '📄',
    group: '문서·계약',
    status: 'soon',
    blurb: '도면·제출물·계약',
    plan: ['도면 목록·개정 이력', '제출물(submittal) 추적', '계약/변경 문서', '문서 검색'],
    fields: [
      { key: 'type', label: '구분', type: 'select', options: ['도면', '제출물', '계약/변경'] },
      { key: 'name', label: '문서명', wide: true },
      { key: 'number', label: '번호' },
      { key: 'rev', label: '개정' },
      { key: 'date', label: '일자', type: 'date' },
      { key: 'status', label: '상태', type: 'select', options: ['작성중', '제출', '승인', '반려'] },
    ],
  },
  {
    id: 'permit',
    label: '인허가',
    icon: '📝',
    group: '문서·계약',
    status: 'soon',
    blurb: '인허가 항목 추적',
    plan: ['인허가 목록', '신청·승인·기한 추적', '공정 선행조건 연계', '기한 임박 알림'],
    fields: [
      { key: 'name', label: '인허가명', wide: true },
      { key: 'agency', label: '기관' },
      { key: 'applied', label: '신청일', type: 'date' },
      { key: 'approved', label: '승인일', type: 'date' },
      { key: 'due', label: '기한', type: 'date' },
      { key: 'status', label: '상태', type: 'select', options: ['준비', '신청', '승인', '반려'] },
    ],
  },
  {
    id: 'commissioning',
    label: '시운전',
    icon: '🏗️',
    group: '준공',
    status: 'soon',
    blurb: '시운전 절차·준공',
    plan: ['시운전 절차 체크', '시험성적/기록', '준공·인계 체크리스트', '하자/보완 목록'],
    fields: [
      {
        key: 'type',
        label: '구분',
        type: 'select',
        options: ['시운전 절차', '시험성적', '준공/인계', '하자/보완'],
      },
      { key: 'item', label: '항목', wide: true },
      { key: 'date', label: '일자', type: 'date' },
      { key: 'result', label: '결과', type: 'select', options: ['예정', '진행', '합격', '불합격'] },
      { key: 'note', label: '비고', wide: true },
    ],
  },
  {
    id: 'risk',
    label: '리스크·이슈',
    icon: '⚠️',
    group: '관리',
    status: 'soon',
    blurb: '이슈 로그·대응',
    plan: ['이슈/리스크 등록', '영향·발생가능성', '대응·담당·기한', '공정 영향 연계'],
    fields: [
      { key: 'type', label: '구분', type: 'select', options: ['리스크', '이슈'] },
      { key: 'content', label: '내용', wide: true },
      { key: 'impact', label: '영향', type: 'select', options: ['상', '중', '하'] },
      { key: 'likelihood', label: '가능성', type: 'select', options: ['상', '중', '하'] },
      { key: 'response', label: '대응', wide: true },
      { key: 'owner', label: '담당' },
      { key: 'due', label: '기한', type: 'date' },
      { key: 'status', label: '상태', type: 'select', options: ['열림', '진행', '종료'] },
    ],
  },
  {
    id: 'report',
    label: '보고서',
    icon: '📊',
    group: '관리',
    status: 'soon',
    blurb: '주간·월간 보고',
    plan: [
      '공정/원가/안전 요약 자동집계',
      '주간·월간 템플릿',
      '도면 출력 엔진으로 PDF',
      '배포 이력',
    ],
  },
]

export const MODULE_MAP: Record<ModuleId, ModuleDef> = Object.fromEntries(
  MODULES.map((m) => [m.id, m]),
) as Record<ModuleId, ModuleDef>
