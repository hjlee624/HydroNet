// ─────────────────────────────────────────────────────────────────────────────
// 시설물 유형(facility type) 분류 + 유형별 "시공 패키지" 프리셋.
//
// 새 사업을 시작할 때 사용자가 설계 단계(타당성/기본/실시/시공)와 함께 시설물 유형을
// 고르면, 그 유형의 표준 공사 패키지로 예정공정표·마일스톤(시공 공정표)이 세팅된다.
//
// 핵심 아이디어(요구사항 5): 한 패키지(예: 상부댐)는 한 줄(row)에서 여러 세부공정이
// 옆으로 이어진다 — 굴착 → 축조 → 페이스슬라브 → 충수. RowDef.steps 가 같은 row에
// 순차(FS) 배치되고, 패키지(공종) 안에 여러 row를 둘 수 있다(상부댐/하부댐 등).
//
// 마일스톤은 '주요 마일스톤' 패키지 한 곳에서만 절대 시점(atMonth)으로 찍는다(작업 행
// 끝에 별도 ◆를 두지 않아 종료 마일스톤이 중복되지 않게). 착공/준공 시점은 실제 공정
// 체인 시작·종료와 정합한다.
//
// 데이터 출처: 한수원 「양수발전소 건설공정」영상(양수발전 패키지 4종) + 댐·수력 시설
// 표준 시공 공정 딥리서치(RESEARCH_facility_packages.json, 콘크리트중력/아치/필댐
// (코어형·CFRD)/복합댐(CSG)/가동보/안전성강화/농업용 저수지).
// ─────────────────────────────────────────────────────────────────────────────

import { applyCascade } from '../engine/scheduling'
import { lanePalette } from '../styles/theme'
import type { Category, Link, Task } from '../types/model'
import { CIVIL_FACILITIES, CIVIL_GROUP_LABELS } from './civilFacilities'

/** 새 사업 창에서 고르는 시설물 유형. */
export interface FacilityType {
  key: string
  label: string
  icon: string
  /** 분류 그룹 키 (FACILITY_GROUPS). 수자원·댐은 'dam', 토목 다분야는 civilFacilities.ts. */
  group: string
  desc: string
}

/** 시설물 분야(그룹) — 신규 도면 창의 묶음/필터·정렬에 사용(정의 순서 = 표시 순서). */
export interface FacilityGroup {
  key: string
  label: string
}
export const FACILITY_GROUPS: FacilityGroup[] = [
  ...Object.entries(CIVIL_GROUP_LABELS).map(([key, label]) => ({ key, label })),
  { key: 'dam', label: '수자원·댐' },
]

// 수자원·댐(수력부) 9종 — 기존 정의 유지, 분야 그룹만 'dam' 으로 통합.
const DAM_FACILITY_TYPES: FacilityType[] = [
  {
    key: 'concrete-gravity',
    label: '콘크리트 중력댐',
    icon: '🧱',
    group: 'dam',
    desc: '본체 콘크리트(RCCD/주상블록) + 여수로·취수 — 신규 다목적댐의 표준형',
  },
  {
    key: 'concrete-arch',
    label: '아치식댐',
    icon: '🌉',
    group: 'dam',
    desc: '양안 정착부 + 아치 본체(블록분할·관로냉각·수축이음 그라우팅) — 협곡 지형',
  },
  {
    key: 'earth-core',
    label: '중심코어형 록필댐(ECRD)',
    icon: '⛰️',
    group: 'dam',
    desc: '점토 차수코어 + 필터·트랜지션·사석존 성토 — 소양강·충주형',
  },
  {
    key: 'rockfill-cfrd',
    label: '표면차수벽형 석괴댐(CFRD)',
    icon: '🪨',
    group: 'dam',
    desc: '플린스 + 록존 성토 + 콘크리트 표면차수벽(페이스슬라브) — 양수발전 댐 표준',
  },
  {
    key: 'composite-csg',
    label: '복합댐(CSG/하드필)',
    icon: '🧩',
    group: 'dam',
    desc: '상류 필존 + 하류 콘크리트(CSG·계단식)존 — 극한강우 월류 대응',
  },
  {
    key: 'barrage',
    label: '가동보 / 고정보',
    icon: '🚧',
    group: 'dam',
    desc: '고정보(콘크리트 월류부) + 가동보 수문 + 어도 — 하천 횡단 취수·수위조절',
  },
  {
    key: 'agricultural',
    label: '농업용 저수지',
    icon: '🌾',
    group: 'dam',
    desc: '균일형 흙댐 성토(또는 둑높이기) + 여수토·취수 — 농업용수 확보',
  },
  {
    key: 'pumped',
    label: '양수발전(상·하부 저수지)',
    icon: '⚡',
    group: 'dam',
    desc: '상·하부댐(CFRD) + 터널·수압관로 + 지하발전소 + 옥외변전소 (한수원 영상 기반)',
  },
  {
    key: 'dam-rehab',
    label: '기존 댐 안전성 강화',
    icon: '🛠️',
    group: 'dam',
    desc: '정밀안전진단 + 치수능력증대(비상여수로)·댐체 보강·내진보강·설비 개량 — 리모델링',
  },
]

// 전사공통(토목 다분야) 시설물 = 댐 9종 + civilFacilities.ts 의 토목 유형들.
export const FACILITY_TYPES: FacilityType[] = [
  ...DAM_FACILITY_TYPES,
  ...CIVIL_FACILITIES.map(
    (f): FacilityType => ({
      key: f.key,
      label: f.label,
      icon: f.icon,
      group: f.group,
      desc: f.desc,
    }),
  ),
]

export const facilityLabel = (key?: string): string =>
  FACILITY_TYPES.find((f) => f.key === key)?.label ?? ''

// ── 프리셋 데이터 구조 ───────────────────────────────────────────────────────
/** 한 줄의 세부공정. atMonth가 있으면 절대 시점(개월), 없으면 같은 row 앞 공정 종료에 이어 붙음. */
interface Step {
  name: string
  months: number
  ms?: boolean
  atMonth?: number
}
/** 패키지 안의 한 줄(row): 세부공종 라벨(선택) + 시작 시점(개월) + 순차 공정들. */
interface Row {
  sub?: string
  startMonth: number
  steps: Step[]
}
/** 시공 패키지(=공종 레인). */
interface Pkg {
  name: string
  rows: Row[]
}
interface Scheme {
  packages: Pkg[]
}

const M = 30 // 개략 1개월 = 30일

/**
 * 시설물 유형 → 시공 공정표(공종/공정/연결) 생성. 같은 row의 공정은 FS로 옆으로
 * 이어지고(굴착→축조→…), 각 공정의 row(=레인 내 줄)를 명시해 한 줄 패키지를 만든다.
 */
export function buildFacilitySchedule(scheme: Scheme): {
  categories: Category[]
  tasks: Task[]
  links: Link[]
} {
  const categories: Category[] = []
  const tasks: Task[] = []
  const links: Link[] = []
  let li = 0
  scheme.packages.forEach((pkg, ci) => {
    const catId = `fc-${ci}`
    categories.push({
      id: catId,
      name: pkg.name,
      color: lanePalette[ci % lanePalette.length],
      collapsed: false,
      order: ci,
    })
    pkg.rows.forEach((row, ri) => {
      let cursor = Math.round(row.startMonth * M)
      let prevId: string | null = null
      row.steps.forEach((st, si) => {
        const id = `ft-${ci}-${ri}-${si}`
        const startDay = st.atMonth != null ? Math.round(st.atMonth * M) : cursor
        const dur = st.ms ? 0 : Math.round(st.months * M)
        tasks.push({
          id,
          categoryId: catId,
          name: st.ms ? `◆ ${st.name}` : st.name,
          start: startDay,
          duration: dur,
          isMilestone: !!st.ms,
          row: ri,
          ...(row.sub ? { subName: row.sub } : {}),
        })
        // 같은 줄에서 앞 공정과 이어질 때만 화살표(절대시점 마일스톤은 독립 배치).
        if (prevId && st.atMonth == null)
          links.push({ id: `fl-${++li}`, from: prevId, to: id, type: 'FS', lag: 0 })
        prevId = id
        cursor = startDay + dur
      })
    })
  })
  const consistent = applyCascade(tasks, links).tasks
  return { categories, tasks: consistent, links }
}

// ── 유형별 프리셋 ────────────────────────────────────────────────────────────
// 양수발전 — 한수원 건설공정 영상 기반(7개년, 4대 공사). 상·하부댐은 CFRD: 굴착→축조→페이스슬라브→충수.
const PUMPED: Scheme = {
  packages: [
    {
      name: '주요 마일스톤',
      rows: [
        {
          startMonth: 0,
          steps: [
            { name: '착공', months: 0, ms: true, atMonth: 0 },
            { name: '지하발전소 굴착 완료', months: 0, ms: true, atMonth: 40 },
            { name: '담수(충수)', months: 0, ms: true, atMonth: 62 },
            { name: '준공', months: 0, ms: true, atMonth: 80 },
            { name: '상업운전', months: 0, ms: true, atMonth: 84 },
          ],
        },
      ],
    },
    {
      name: '가설공',
      rows: [
        {
          startMonth: 0,
          steps: [
            { name: '가설건물·진입도로', months: 6 },
            { name: '공사용 전력·용수', months: 5 },
          ],
        },
      ],
    },
    {
      name: '터널공사',
      rows: [
        {
          sub: '모선·진입',
          startMonth: 3,
          steps: [
            { name: '모선터널 굴착', months: 12 },
            { name: '진입터널 굴착', months: 8 },
          ],
        },
        {
          sub: '도수·수압',
          startMonth: 26,
          steps: [
            { name: '도수터널 굴착', months: 12 },
            { name: '수압관로(철관) 굴착·설치', months: 12 },
          ],
        },
        {
          sub: '취수·방수',
          startMonth: 54,
          steps: [
            { name: '취수구 축조', months: 8 },
            { name: '방수구 축조', months: 6 },
          ],
        },
      ],
    },
    {
      name: '지하발전소공사',
      rows: [
        {
          startMonth: 18,
          steps: [
            { name: '지하발전소 굴착', months: 18 },
            { name: '구조물 축조', months: 14 },
            { name: '크레인 설치', months: 4 },
            { name: '발전설비 설치', months: 12 },
          ],
        },
      ],
    },
    {
      name: '댐공사',
      rows: [
        {
          sub: '상부댐(CFRD)',
          startMonth: 24,
          steps: [
            { name: '굴착', months: 8 },
            { name: '축조(성토)', months: 14 },
            { name: '페이스슬라브(차수)', months: 8 },
            { name: '충수', months: 4 },
          ],
        },
        {
          sub: '하부댐(CFRD)',
          startMonth: 26,
          steps: [
            { name: '굴착', months: 8 },
            { name: '축조(성토)', months: 12 },
            { name: '페이스슬라브(차수)', months: 7 },
            { name: '충수', months: 4 },
          ],
        },
      ],
    },
    {
      name: '옥외변전소공사',
      rows: [
        {
          startMonth: 48,
          steps: [
            { name: 'Switch Yard 조성', months: 8 },
            { name: '전력설비건물 신축', months: 10 },
            { name: '행정동 신축', months: 8 },
          ],
        },
      ],
    },
    {
      name: '시운전',
      rows: [
        {
          startMonth: 72,
          steps: [
            { name: '무부하·단독 시험', months: 4 },
            { name: '부하·양수운전 종합시운전', months: 4 },
          ],
        },
      ],
    },
  ],
}

// 콘크리트 중력댐(신규) — RCCD/주상블록, 약 5.5개년(준공 ≈ 69mo)
const CONCRETE_GRAVITY: Scheme = {
  packages: [
    {
      name: '주요 마일스톤',
      rows: [
        {
          startMonth: 0,
          steps: [
            { name: '착공', months: 0, ms: true, atMonth: 0 },
            { name: '유수전환 완료', months: 0, ms: true, atMonth: 24 },
            { name: '본체 타설 착수', months: 0, ms: true, atMonth: 30 },
            { name: '담수', months: 0, ms: true, atMonth: 60 },
            { name: '준공', months: 0, ms: true, atMonth: 69 },
          ],
        },
      ],
    },
    {
      name: '가설공·부지조성',
      rows: [
        {
          startMonth: 0,
          steps: [
            { name: '진입도로·가교', months: 4 },
            { name: '가설건물·시험실', months: 3 },
            { name: '배치플랜트·골재설비', months: 5 },
            { name: '벌개제근·부지조성', months: 4 },
          ],
        },
      ],
    },
    {
      name: '유수전환·가물막이',
      rows: [
        { sub: '가배수', startMonth: 6, steps: [{ name: '가배수터널 굴착·라이닝', months: 15 }] },
        {
          sub: '가물막이',
          startMonth: 21,
          steps: [
            { name: '상류 가물막이', months: 5 },
            { name: '하류 가물막이', months: 3 },
            { name: '유수전환·건식화', months: 2 },
          ],
        },
      ],
    },
    {
      name: '기초굴착·기초처리',
      rows: [
        {
          startMonth: 24,
          steps: [
            { name: '기초굴착(발파·정리)', months: 7 },
            { name: '기초면 정리·덴탈콘크리트', months: 3 },
            { name: '압밀그라우팅', months: 4 },
            { name: '커튼그라우팅·배수공', months: 6 },
          ],
        },
      ],
    },
    {
      name: '댐체 콘크리트(RCCD)',
      rows: [
        {
          sub: '본체',
          startMonth: 30,
          steps: [
            { name: '시험배합·시험타설', months: 3 },
            { name: '댐체 콘크리트 타설(RCD)', months: 22 },
          ],
        },
        {
          sub: '부속',
          startMonth: 33,
          steps: [{ name: '감사랑(갤러리)·계측기 매설', months: 16 }],
        },
      ],
    },
    {
      name: '여수로(조절부·도류부·감세공)',
      rows: [
        {
          startMonth: 26,
          steps: [
            { name: '접근수로 기초굴착', months: 6 },
            { name: '조절부(물넘이) 콘크리트', months: 8 },
            { name: '도류부 콘크리트', months: 7 },
            { name: '감세공', months: 6 },
          ],
        },
      ],
    },
    {
      name: '취수·방류·수문',
      rows: [
        { sub: '취수', startMonth: 44, steps: [{ name: '취수탑 기초·본체', months: 12 }] },
        {
          sub: '수문',
          startMonth: 44,
          steps: [
            { name: '방류수문(라디알게이트) 제작·설치', months: 14 },
            { name: '권양기·유압설비', months: 5 },
          ],
        },
      ],
    },
    {
      name: '부대공·환경',
      rows: [
        {
          startMonth: 52,
          steps: [
            { name: '관리교·댐정도로', months: 5 },
            { name: '계측설비 연동', months: 6 },
            { name: '어도·환경복원', months: 6 },
          ],
        },
      ],
    },
    {
      name: '담수·시운전',
      rows: [
        {
          startMonth: 58,
          steps: [
            { name: '가배수로 폐쇄·플러깅', months: 2 },
            { name: '가물막이 철거', months: 2 },
            { name: '단계별 시험담수', months: 4 },
            { name: '통합 시운전', months: 3 },
          ],
        },
      ],
    },
  ],
}

// 아치식댐(신규) — 협곡, 약 5개년(준공 ≈ 59mo)
const CONCRETE_ARCH: Scheme = {
  packages: [
    {
      name: '주요 마일스톤',
      rows: [
        {
          startMonth: 0,
          steps: [
            { name: '착공', months: 0, ms: true, atMonth: 0 },
            { name: '아치 타설 착수', months: 0, ms: true, atMonth: 22 },
            { name: '담수', months: 0, ms: true, atMonth: 50 },
            { name: '준공', months: 0, ms: true, atMonth: 59 },
          ],
        },
      ],
    },
    {
      name: '준비공·유수전환·가물막이',
      rows: [
        {
          startMonth: 0,
          steps: [
            { name: '준비공·공사용도로·가설비', months: 6 },
            { name: '가배수터널·상하류 가물막이', months: 12 },
            { name: '유수전환·건식화', months: 2 },
          ],
        },
      ],
    },
    {
      name: '양안 정착부 굴착·기초처리',
      rows: [
        {
          startMonth: 20,
          steps: [
            { name: '양안 어버트먼트(정착부) 굴착', months: 12 },
            { name: '정착부 기초처리·그라우팅', months: 6 },
          ],
        },
      ],
    },
    {
      name: '아치 본체 콘크리트',
      rows: [
        {
          startMonth: 22,
          steps: [
            { name: '아치 콘크리트 타설(블록분할·관로냉각)', months: 22 },
            { name: '수축이음 그라우팅(아치 일체화)', months: 4 },
          ],
        },
      ],
    },
    {
      name: '여수로·방류설비',
      rows: [
        {
          startMonth: 24,
          steps: [
            { name: '여수로·방류설비 콘크리트', months: 14 },
            { name: '수문·게이트 제작·설치', months: 10 },
          ],
        },
      ],
    },
    {
      name: '시험담수·준공',
      rows: [
        {
          startMonth: 48,
          steps: [
            { name: '가배수로 폐쇄·가물막이 철거', months: 3 },
            { name: '시험담수·아치 변형 계측', months: 5 },
            { name: '종합 시운전', months: 3 },
          ],
        },
      ],
    },
  ],
}

// 중심코어형 록필댐(ECRD, 신규) — 약 5.5개년(준공 ≈ 63mo)
const EARTH_CORE: Scheme = {
  packages: [
    {
      name: '주요 마일스톤',
      rows: [
        {
          startMonth: 0,
          steps: [
            { name: '착공', months: 0, ms: true, atMonth: 0 },
            { name: '기초처리 완료', months: 0, ms: true, atMonth: 24 },
            { name: '제체 성토 착수', months: 0, ms: true, atMonth: 24 },
            { name: '담수', months: 0, ms: true, atMonth: 58 },
            { name: '준공', months: 0, ms: true, atMonth: 63 },
          ],
        },
      ],
    },
    {
      name: '가설공·플랜트',
      rows: [
        {
          startMonth: 0,
          steps: [
            { name: '진입도로·가설교량', months: 4 },
            { name: '가설건물·시험실', months: 3 },
            { name: '배치플랜트·석산 개발', months: 5 },
          ],
        },
      ],
    },
    {
      name: '유수전환터널·가물막이',
      rows: [
        {
          startMonth: 4,
          steps: [
            { name: '유수전환터널 굴착(NATM)·라이닝', months: 12 },
            { name: '상·하류 가물막이·유수전환(체절)', months: 4 },
            { name: '가물막이 내 배수·드라이업', months: 2 },
          ],
        },
      ],
    },
    {
      name: '기초굴착·기초처리',
      rows: [
        {
          startMonth: 18,
          steps: [
            { name: '표토·풍화대 제거·기초굴착', months: 6 },
            { name: '기초암반 정리·치핑', months: 2 },
            { name: '압밀그라우팅', months: 4 },
            { name: '커튼그라우팅', months: 6 },
          ],
        },
      ],
    },
    {
      name: '제체 성토(코어·필터·사석)',
      rows: [
        {
          sub: '코어존',
          startMonth: 24,
          steps: [
            { name: '코어 기초처리(콘택트층)', months: 2 },
            { name: '점성토 차수코어 성토·다짐', months: 18 },
          ],
        },
        {
          sub: '필터·트랜지션',
          startMonth: 26,
          steps: [
            { name: '필터존 포설·다짐', months: 16 },
            { name: '트랜지션존 포설·다짐', months: 4 },
          ],
        },
        {
          sub: '사석존',
          startMonth: 26,
          steps: [{ name: '사석/록존(상·하류 셸) 진동롤러 다짐', months: 18 }],
        },
      ],
    },
    {
      name: '댐마루·사면보호',
      rows: [
        {
          startMonth: 46,
          steps: [
            { name: '상류 리프랩·하류 사면보호', months: 4 },
            { name: '댐마루 도로·난간·파라펫', months: 3 },
          ],
        },
      ],
    },
    {
      name: '여수로',
      rows: [
        {
          startMonth: 24,
          steps: [
            { name: '접근수로·조절부 콘크리트', months: 14 },
            { name: '급경사수로·감세공', months: 10 },
            { name: '수문설비 설치', months: 8 },
          ],
        },
      ],
    },
    {
      name: '취수·방류설비',
      rows: [
        {
          startMonth: 30,
          steps: [
            { name: '취수탑 콘크리트', months: 12 },
            { name: '방류관로·밸브실', months: 10 },
            { name: '수문·기전설비', months: 6 },
          ],
        },
      ],
    },
    {
      name: '담수·시운전',
      rows: [
        {
          startMonth: 52,
          steps: [
            { name: '전환터널 폐쇄(플러그)·체절', months: 2 },
            { name: '초기 담수(단계별)·계측', months: 6 },
            { name: '통수시험·종합 시운전', months: 3 },
          ],
        },
      ],
    },
  ],
}

// 표면차수벽형 석괴댐(CFRD, 신규) — 약 5.5개년(준공 ≈ 64mo). 플린스→성토→슬래브1차→슬래브2차.
const ROCKFILL_CFRD: Scheme = {
  packages: [
    {
      name: '주요 마일스톤',
      rows: [
        {
          startMonth: 0,
          steps: [
            { name: '착공', months: 0, ms: true, atMonth: 0 },
            { name: '플린스 완료', months: 0, ms: true, atMonth: 24 },
            { name: '차수벽(슬래브) 완료', months: 0, ms: true, atMonth: 52 },
            { name: '담수', months: 0, ms: true, atMonth: 54 },
            { name: '준공', months: 0, ms: true, atMonth: 64 },
          ],
        },
      ],
    },
    {
      name: '가설공·플랜트',
      rows: [
        {
          startMonth: 0,
          steps: [
            { name: '진입도로·가설교량', months: 4 },
            { name: '가설건물·시험실', months: 3 },
            { name: '배치플랜트·석산 개발', months: 5 },
          ],
        },
      ],
    },
    {
      name: '유수전환터널·가물막이',
      rows: [
        {
          startMonth: 4,
          steps: [
            { name: '유수전환터널 굴착·라이닝', months: 12 },
            { name: '상·하류 가물막이·유수전환', months: 4 },
            { name: '가물막이 내 드라이업', months: 2 },
          ],
        },
      ],
    },
    {
      name: '기초굴착·플린스·그라우팅',
      rows: [
        {
          startMonth: 16,
          steps: [
            { name: '표토·풍화대 제거·기초굴착', months: 6 },
            { name: '플린스(Plinth) 철근·지수판·타설', months: 8 },
            { name: '플린스 하부 압밀·커튼 그라우팅', months: 6 },
          ],
        },
      ],
    },
    {
      name: '제체 성토(2B·3A·3B·3C)',
      rows: [
        {
          sub: '지지·트랜지션',
          startMonth: 24,
          steps: [{ name: '쿠션·지지존(2B)·트랜지션(3A) 다짐', months: 14 }],
        },
        {
          sub: '주사석',
          startMonth: 24,
          steps: [{ name: '주사석존(3B)·하류 록존(3C) 진동롤러 다짐', months: 16 }],
        },
        {
          sub: '상류면',
          startMonth: 25,
          steps: [{ name: '압출성형 콘크리트(Extruded Curb)', months: 14 }],
        },
      ],
    },
    {
      name: '표면차수벽 슬래브(Face Slab)',
      rows: [
        {
          startMonth: 40,
          steps: [
            { name: '페리메트릭 조인트·지수판 설치', months: 3 },
            { name: '슬래브 1차(하부) 타설(슬립폼)', months: 4 },
            { name: '슬래브 2차(상부) 타설·파라펫', months: 4 },
            { name: '상류 사면 정리·보호', months: 2 },
          ],
        },
      ],
    },
    {
      name: '여수로·취수·방류',
      rows: [
        {
          startMonth: 24,
          steps: [
            { name: '여수로 접근수로·조절부', months: 14 },
            { name: '급경사수로·감세공', months: 10 },
            { name: '취수탑·방류·수문설비', months: 12 },
          ],
        },
      ],
    },
    {
      name: '담수·시운전',
      rows: [
        {
          startMonth: 53,
          steps: [
            { name: '전환터널 폐쇄·체절', months: 2 },
            { name: '초기 담수·면판 누수 계측', months: 6 },
            { name: '통수시험·종합 시운전', months: 3 },
          ],
        },
      ],
    },
  ],
}

// 복합댐(CSG/하드필, 신규) — 약 4.5개년(준공 ≈ 51mo)
const COMPOSITE_CSG: Scheme = {
  packages: [
    {
      name: '주요 마일스톤',
      rows: [
        {
          startMonth: 0,
          steps: [
            { name: '착공', months: 0, ms: true, atMonth: 0 },
            { name: '제체 착수', months: 0, ms: true, atMonth: 14 },
            { name: '담수', months: 0, ms: true, atMonth: 42 },
            { name: '준공', months: 0, ms: true, atMonth: 51 },
          ],
        },
      ],
    },
    {
      name: '준비공·유수전환·가물막이',
      rows: [
        {
          startMonth: 0,
          steps: [
            { name: '준비공·공사용도로·가설비', months: 6 },
            { name: '가배수·상하류 가물막이·유수전환', months: 8 },
          ],
        },
      ],
    },
    {
      name: '기초굴착·기초처리',
      rows: [
        {
          startMonth: 12,
          steps: [
            { name: '기초굴착·콘크리트존 정착부', months: 7 },
            { name: '기초처리(압밀·커튼 그라우팅)', months: 6 },
          ],
        },
      ],
    },
    {
      name: '제체(필존 + CSG존)',
      rows: [
        {
          sub: '하류 CSG',
          startMonth: 18,
          steps: [{ name: '하류 CSG/하드필존 포설·계단형 사면', months: 18 }],
        },
        {
          sub: '트랜지션',
          startMonth: 19,
          steps: [{ name: '트랜지션존(차수재) 시공', months: 16 }],
        },
        { sub: '상류 필존', startMonth: 19, steps: [{ name: '상류 필존 축조·다짐', months: 16 }] },
      ],
    },
    {
      name: '여수로·취수·방류',
      rows: [
        {
          startMonth: 19,
          steps: [
            { name: '계단식 여수로(월류부) 콘크리트', months: 12 },
            { name: '취수·방류·수문 설치', months: 8 },
          ],
        },
      ],
    },
    {
      name: '담수·시운전',
      rows: [
        {
          startMonth: 40,
          steps: [
            { name: '가배수로 폐쇄·가물막이 철거', months: 2 },
            { name: '시험담수·계측', months: 6 },
            { name: '종합 시운전', months: 3 },
          ],
        },
      ],
    },
  ],
}

// 가동보/고정보(신규) — 약 3개년(준공 ≈ 33mo)
const BARRAGE: Scheme = {
  packages: [
    {
      name: '주요 마일스톤',
      rows: [
        {
          startMonth: 0,
          steps: [
            { name: '착공', months: 0, ms: true, atMonth: 1 },
            { name: '가물막이 완료', months: 0, ms: true, atMonth: 6 },
            { name: '본체 완료', months: 0, ms: true, atMonth: 26 },
            { name: '준공', months: 0, ms: true, atMonth: 33 },
          ],
        },
      ],
    },
    {
      name: '가물막이·유수전환',
      rows: [
        {
          sub: '1차',
          startMonth: 1,
          steps: [{ name: '1차 가물막이·유수전환(반단면)', months: 5 }],
        },
        { sub: '2차', startMonth: 14, steps: [{ name: '2차 가물막이·전환', months: 5 }] },
      ],
    },
    {
      name: '기초·바닥보호공',
      rows: [
        {
          startMonth: 5,
          steps: [
            { name: '기초굴착·말뚝/지반보강', months: 4 },
            { name: '바닥보호공·세굴 대비', months: 3 },
          ],
        },
      ],
    },
    {
      name: '보 본체(고정보+가동보)',
      rows: [
        {
          sub: '고정보',
          startMonth: 10,
          steps: [{ name: '고정보(콘크리트 월류부)·물받이', months: 8 }],
        },
        {
          sub: '가동보',
          startMonth: 16,
          steps: [
            { name: '가동보 구조물', months: 6 },
            { name: '수문·권양설비(유압) 설치', months: 6 },
          ],
        },
      ],
    },
    {
      name: '부대공·전기',
      rows: [
        {
          startMonth: 24,
          steps: [
            { name: '취수공·어도·관리교', months: 5 },
            { name: '수문 전기·제어(SCADA)', months: 4 },
          ],
        },
      ],
    },
    {
      name: '시운전',
      rows: [{ startMonth: 29, steps: [{ name: '수문 시운전·준공검사', months: 3 }] }],
    },
  ],
}

// 농업용 저수지(신규/둑높이기) — 약 2개년(준공 ≈ 23mo)
const AGRICULTURAL: Scheme = {
  packages: [
    {
      name: '주요 마일스톤',
      rows: [
        {
          startMonth: 0,
          steps: [
            { name: '착공', months: 0, ms: true, atMonth: 0 },
            { name: '제체 성토 착수', months: 0, ms: true, atMonth: 3 },
            { name: '담수', months: 0, ms: true, atMonth: 19 },
            { name: '준공', months: 0, ms: true, atMonth: 23 },
          ],
        },
      ],
    },
    {
      name: '준비공·가배수·가물막이',
      rows: [{ startMonth: 0, steps: [{ name: '준비공·가배수로·가물막이(수위저하)', months: 3 }] }],
    },
    {
      name: '제체(흙댐) 성토/둑높이기',
      rows: [
        {
          startMonth: 3,
          steps: [{ name: '기초처리·제체 성토·다짐(또는 둑높이기 증고)', months: 10 }],
        },
      ],
    },
    {
      name: '여수토·취수설비',
      rows: [
        {
          sub: '여수토',
          startMonth: 13,
          steps: [{ name: '여수토(여수로)·물넘이·사면보호', months: 6 }],
        },
        {
          sub: '취수',
          startMonth: 13,
          steps: [{ name: '취수시설(취수탑·통관)·관리시설', months: 5 }],
        },
      ],
    },
    {
      name: '담수·준공',
      rows: [{ startMonth: 19, steps: [{ name: '담수·정밀안전점검', months: 4 }] }],
    },
  ],
}

// 기존 댐 안전성 강화 / 리모델링 — 비상여수로 신설(대단면 터널 30개월)이 임계 → 약 8개년(준공 ≈ 96mo)
const DAM_REHAB: Scheme = {
  packages: [
    {
      name: '주요 마일스톤',
      rows: [
        {
          startMonth: 0,
          steps: [
            { name: '착수', months: 0, ms: true, atMonth: 0 },
            { name: '정밀안전진단 완료', months: 0, ms: true, atMonth: 12 },
            { name: '보강공사 착수', months: 0, ms: true, atMonth: 14 },
            { name: '준공', months: 0, ms: true, atMonth: 96 },
          ],
        },
      ],
    },
    {
      name: '정밀안전진단·평가',
      rows: [
        {
          startMonth: 0,
          steps: [
            { name: '외관조사·자료수집', months: 2 },
            { name: '수중조사(취수탑·여수로)', months: 2 },
            { name: '현장·재료시험(코어·비파괴)', months: 3 },
            { name: '수문(PMP→PMF)·내진성능 평가', months: 3 },
            { name: '종합평가·보강 기본계획', months: 2 },
          ],
        },
      ],
    },
    {
      name: '비상(보조)여수로 신설',
      rows: [
        {
          startMonth: 14,
          steps: [
            { name: '가설·가물막이·하천처리', months: 8 },
            { name: '유입부·조절부 콘크리트', months: 14 },
            { name: '대단면 터널 굴착(NATM)', months: 30 },
            { name: '터널 라이닝', months: 12 },
            { name: '유출부·감세공', months: 10 },
            { name: '수문설비·시운전', months: 8 },
          ],
        },
      ],
    },
    {
      name: '댐체·기초 차수보강',
      rows: [
        {
          sub: '그라우팅',
          startMonth: 14,
          steps: [
            { name: '시험그라우팅', months: 3 },
            { name: '커튼 그라우팅', months: 8 },
            { name: '콘솔리데이션·침투그라우팅', months: 6 },
          ],
        },
        { sub: '앵커', startMonth: 18, steps: [{ name: 'PS앵커 천공·정착·긴장', months: 6 }] },
      ],
    },
    {
      name: '댐마루 증고·내진보강',
      rows: [
        {
          startMonth: 22,
          steps: [
            { name: '댐마루 파라펫·옹벽', months: 5 },
            { name: '코어 연장·도로 복구', months: 4 },
            { name: '내진보강(압성토/부벽)', months: 8 },
          ],
        },
      ],
    },
    {
      name: '수문·취수방류설비 개량',
      rows: [
        {
          startMonth: 16,
          steps: [
            { name: '가배수·임시 용수공급 확보', months: 3 },
            { name: '노후 수문·권양기 교체', months: 8 },
            { name: '취수탑·선택취수 개량', months: 7 },
            { name: '전기·제어(SCADA)·시운전', months: 3 },
          ],
        },
      ],
    },
    {
      name: '계측·감시설비',
      rows: [
        {
          startMonth: 86,
          steps: [
            { name: '계측기 신설·교체', months: 4 },
            { name: '자동화 계측·CMS·GNSS', months: 4 },
            { name: '통합관리·경보 연계', months: 2 },
          ],
        },
      ],
    },
  ],
}

const SCHEMES: Record<string, Scheme> = {
  'concrete-gravity': CONCRETE_GRAVITY,
  'concrete-arch': CONCRETE_ARCH,
  'earth-core': EARTH_CORE,
  'rockfill-cfrd': ROCKFILL_CFRD,
  'composite-csg': COMPOSITE_CSG,
  barrage: BARRAGE,
  agricultural: AGRICULTURAL,
  pumped: PUMPED,
  'dam-rehab': DAM_REHAB,
  // 토목 다분야 — civilFacilities.ts(워크플로 저작) 의 packages 를 스킴으로 병합.
  ...Object.fromEntries(CIVIL_FACILITIES.map((f) => [f.key, { packages: f.packages } as Scheme])),
}

/** 시설물 유형의 시공 공정표(공종/공정/연결). 알 수 없는 키는 콘크리트 중력댐으로. */
export function facilitySchedule(facilityKey?: string): {
  categories: Category[]
  tasks: Task[]
  links: Link[]
} {
  const scheme = (facilityKey && SCHEMES[facilityKey]) || CONCRETE_GRAVITY
  return buildFacilitySchedule(scheme)
}

/** 시설물 유형에 시공 공정표 프리셋(packages)이 실제로 있는지. 빈 배열/미정의면 false. */
export function hasFacilityScheme(facilityKey?: string): boolean {
  const s = facilityKey ? SCHEMES[facilityKey] : undefined
  return !!s && s.packages.length > 0
}

/** 신규 도면 창의 '공정표 미리보기(샘플)'용 요약 — 유형별 시공 공정표에서 계산. */
export interface FacilityPreview {
  totalDays: number
  totalMonths: number
  taskCount: number
  categories: { name: string; taskCount: number; startDay: number; endDay: number; color: string }[]
  milestones: { name: string; day: number; month: number }[]
}
export function facilityPreview(facilityKey?: string): FacilityPreview {
  const { categories, tasks } = facilitySchedule(facilityKey)
  const nonMs = tasks.filter((t) => !t.isMilestone)
  const totalDays = tasks.reduce((m, t) => Math.max(m, t.start + t.duration), 0)
  const milestones = tasks
    .filter((t) => t.isMilestone)
    .sort((a, b) => a.start - b.start)
    .map((t) => ({
      name: t.name.replace(/^◆\s*/, ''),
      day: t.start,
      month: Math.round(t.start / M),
    }))
  const cats = categories
    .filter((c) => !/주요 마일스톤/.test(c.name)) // 공종 레인만(마일스톤 레인 제외)
    .map((c) => {
      const own = nonMs.filter((t) => t.categoryId === c.id)
      const startDay = own.length ? Math.min(...own.map((t) => t.start)) : 0
      const endDay = own.length ? Math.max(...own.map((t) => t.start + t.duration)) : 0
      return { name: c.name, taskCount: own.length, startDay, endDay, color: c.color }
    })
  return {
    totalDays,
    totalMonths: Math.round(totalDays / M),
    taskCount: nonMs.length,
    categories: cats,
    milestones,
  }
}
