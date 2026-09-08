// ─────────────────────────────────────────────────────────────────────────────
// 전사공통(토목설계 전반) 시설물 유형 + 유형별 시공 공정표(공종/공정/마일스톤) 프리셋.
//
// 메타데이터(label/icon/group/desc)는 사람이 설계하고, `packages`(시공 공정표)는
// civil-facility-schedules 워크플로가 유형별로 저작·검증한 결과다(scripts/gen-civil.mjs 로 병합).
// facilities.ts 가 이 배열을 FACILITY_TYPES 와 SCHEMES 에 병합한다(수력·댐 9종 + 여기 토목 다분야).
//
// packages 구조는 facilities.ts 의 Scheme/Pkg/Row/Step 과 동일:
//  packages[0] = "주요 마일스톤"(steps 모두 ms:true + atMonth), 이후 = 공종 레인.
//
// ※ 2026-09 수기 보정: 착공 ≤ 첫 공정 시작, 준공 ≥ 최종 작업 종료 규약에 어긋난 13종의
//   row.startMonth / 마일스톤 atMonth 를 교정했다(scripts/smoke.ts 마일스톤 위생 검사 —
//   ±1일 슬랙 없이 엄격 비교). 교정 방향은 **마일스톤을 뒤로 미루는 쪽**으로 통일한다.
//   실제 작업 행을 앞당겨 맞추면(옹벽·보강토에서 한 번 그랬다) 준공검사가 선행 공정보다
//   먼저 시작되는 역순 공정이 되어 감리 검토에서 그대로 반려된다.
//   공정의 공기(step.months)는 표준공기 색인(standardDurationIndex)과 맞물려 있어 손대지
//   않았다. 워크플로로 이 파일을 재생성하면 이 보정이 조용히 되돌아가므로 다시 반영할 것.
// ─────────────────────────────────────────────────────────────────────────────

export interface CivilStep {
  name: string
  months: number
  ms?: boolean
  atMonth?: number
}
export interface CivilRow {
  sub?: string
  startMonth: number
  steps: CivilStep[]
}
export interface CivilPkg {
  name: string
  rows: CivilRow[]
}
export interface CivilFacility {
  key: string
  label: string
  icon: string
  group: string
  desc: string
  packages: CivilPkg[]
}

/** 분야(그룹) 라벨 — 신규 도면 창의 시설물 묶음/필터에 사용. facilities.ts 가 수력·댐
 *  그룹과 합쳐 FACILITY_GROUPS 로 노출한다. 정의 순서 = 화면 표시 순서. */
export const CIVIL_GROUP_LABELS: Record<string, string> = {
  road: '도로·공항',
  bridge: '교량',
  tunnel: '터널',
  river: '하천·방재',
  'water-supply': '상수도',
  sewer: '하수도',
  port: '항만·해안',
  rail: '철도·궤도',
  site: '단지·부지',
  geotech: '지반·기초',
  environ: '환경·정화',
}

/** 시설물 메타데이터 + 유형별 시공 공정표 프리셋(packages). */
export const CIVIL_FACILITIES: CivilFacility[] = [
  {
    key: 'road-new',
    label: '도로(신설)',
    icon: '🛣️',
    group: 'road',
    desc: '토공·배수·구조물·포장·부대공 — 국도·단지 진입 등 신설 도로 표준',
    packages: [
      {
        name: '주요 마일스톤',
        rows: [
          {
            startMonth: 0,
            steps: [
              {
                name: '착공',
                months: 0,
                ms: true,
                atMonth: 1,
              },
              {
                name: '토공 착수',
                months: 0,
                ms: true,
                atMonth: 3,
              },
              {
                name: '구조물공 완료',
                months: 0,
                ms: true,
                atMonth: 18,
              },
              {
                name: '포장 표층 완료',
                months: 0,
                ms: true,
                atMonth: 27,
              },
              {
                name: '준공',
                months: 0,
                ms: true,
                atMonth: 30,
              },
            ],
          },
        ],
      },
      {
        name: '가설·부지정리',
        rows: [
          {
            startMonth: 1,
            steps: [
              {
                name: '착공측량·기준점(TBM)측량',
                months: 1,
              },
              {
                name: '현장가설(가설사무소·가설도로)',
                months: 1.5,
              },
              {
                name: '교통처리(우회도로)·지장물 이설·수목이식',
                months: 1.5,
              },
              {
                name: '벌개제근·부지정리',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '토공',
        rows: [
          {
            startMonth: 3,
            sub: '절토부',
            steps: [
              {
                name: '표토제거',
                months: 1,
              },
              {
                name: '절토(리핑·발파)',
                months: 5,
              },
              {
                name: '비탈면 정리·소단정리',
                months: 1.5,
              },
            ],
          },
          {
            startMonth: 5,
            sub: '성토부',
            steps: [
              {
                name: '기초처리·성토·다짐',
                months: 6,
              },
              {
                name: '노체·노상 마무리(현장다짐시험)',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '배수공',
        rows: [
          {
            startMonth: 6,
            sub: '종·횡배수',
            steps: [
              {
                name: '종배수관·L형측구 설치',
                months: 4,
              },
              {
                name: '횡배수관 설치',
                months: 3,
              },
              {
                name: '집수정·맨홀·배수시설 마무리',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '구조물공',
        rows: [
          {
            startMonth: 7,
            sub: '옹벽',
            steps: [
              {
                name: '기초굴착·버림콘크리트',
                months: 2,
              },
              {
                name: '철근조립·거푸집',
                months: 3,
              },
              {
                name: '옹벽 콘크리트 타설·양생',
                months: 4,
              },
              {
                name: '뒷채움·되메우기',
                months: 2,
              },
            ],
          },
          {
            startMonth: 9,
            sub: '암거(BOX)',
            steps: [
              {
                name: '터파기·기초공',
                months: 2,
              },
              {
                name: '박스 철근·거푸집·타설·양생',
                months: 5,
              },
              {
                name: '방수·되메우기',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '포장공',
        rows: [
          {
            startMonth: 18,
            sub: '포장층',
            steps: [
              {
                name: '동상방지층·보조기층 포설·다짐',
                months: 3,
              },
              {
                name: '아스팔트 기층 포설',
                months: 3,
              },
              {
                name: '표층 포설·다짐',
                months: 3,
              },
              {
                name: '노면표시·시선유도시설',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '부대공',
        rows: [
          {
            startMonth: 24,
            sub: '안전·교통',
            steps: [
              {
                name: '가드레일·방호울타리 설치',
                months: 2,
              },
              {
                name: '표지판·신호·조명설비',
                months: 2,
              },
            ],
          },
          {
            startMonth: 24,
            sub: '조경',
            steps: [
              {
                name: '비탈면 녹화·식재',
                months: 2,
              },
              {
                name: '환경정비·부대시설 마무리',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '시운전·준공',
        rows: [
          {
            startMonth: 28,
            steps: [
              {
                name: '부대시설 시운전·기능점검',
                months: 1,
              },
              {
                name: '준공검사·정산·인계',
                months: 1,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'road-widen',
    label: '도로 확장·개량',
    icon: '🚧',
    group: 'road',
    desc: '교통처리 병행 확폭·선형개량 + 덧씌우기 포장',
    packages: [
      {
        name: '주요 마일스톤',
        rows: [
          {
            startMonth: 0,
            steps: [
              {
                name: '착공',
                months: 0,
                ms: true,
                atMonth: 1,
              },
              {
                name: '지장물 이설 완료',
                months: 0,
                ms: true,
                atMonth: 5,
              },
              {
                name: '토공 완료',
                months: 0,
                ms: true,
                atMonth: 11,
              },
              {
                name: '구조물 완료',
                months: 0,
                ms: true,
                atMonth: 15,
              },
              {
                name: '포장 완료',
                months: 0,
                ms: true,
                atMonth: 22,
              },
              {
                name: '준공',
                months: 0,
                ms: true,
                atMonth: 25,
              },
            ],
          },
        ],
      },
      {
        name: '교통처리·가설',
        rows: [
          {
            startMonth: 1,
            sub: '교통처리 및 가설공',
            steps: [
              {
                name: '가설사무소·현장정비',
                months: 1,
              },
              {
                name: '교통처리계획 수립·심의승인',
                months: 1,
              },
              {
                name: '임시교통시설·우회로 설치',
                months: 1.5,
              },
              {
                name: '교통처리 유지관리(공사기간 존치)',
                months: 19,
              },
            ],
          },
        ],
      },
      {
        name: '측량·지장물 이설',
        rows: [
          {
            startMonth: 1,
            sub: '측량·용지',
            steps: [
              {
                name: '현황측량·중심선 측량',
                months: 1,
              },
              {
                name: '용지경계 확인·시공측량',
                months: 1,
              },
            ],
          },
          {
            startMonth: 2,
            sub: '지장물 이설',
            steps: [
              {
                name: '지하매설물 조사·시굴',
                months: 1,
              },
              {
                name: '상하수도·통신·전력관로 이설',
                months: 2.5,
              },
            ],
          },
        ],
      },
      {
        name: '기존포장 절삭·확폭 토공',
        rows: [
          {
            startMonth: 4,
            sub: '기존포장 절삭·철거',
            steps: [
              {
                name: '기존포장 절삭',
                months: 2,
              },
              {
                name: '노후 구조물 철거',
                months: 1.5,
              },
            ],
          },
          {
            startMonth: 5,
            sub: '확폭 토공',
            steps: [
              {
                name: '벌개제근·표토제거',
                months: 1,
              },
              {
                name: '확폭부 성토·절토',
                months: 3,
              },
              {
                name: '노상 다짐·시공완료',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '배수·구조물 보강',
        rows: [
          {
            startMonth: 8,
            sub: '배수공',
            steps: [
              {
                name: '우수관거·L형측구 설치',
                months: 3,
              },
              {
                name: '집수정·맨홀 설치',
                months: 2,
              },
            ],
          },
          {
            startMonth: 9,
            sub: '구조물 보강',
            steps: [
              {
                name: '옹벽·날개벽 기초',
                months: 2,
              },
              {
                name: '옹벽 철근·콘크리트 타설',
                months: 2.5,
              },
              {
                name: '암거·통로박스 보강',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '포장공',
        rows: [
          {
            startMonth: 15,
            sub: '보조기층·기층',
            steps: [
              {
                name: '동상방지층·보조기층 포설',
                months: 2,
              },
              {
                name: '기층 아스콘 포장',
                months: 2,
              },
            ],
          },
          {
            startMonth: 19,
            sub: '표층 포장',
            steps: [
              {
                name: '프라임코팅·택코팅',
                months: 0.5,
              },
              {
                name: '중간층 포장',
                months: 1.5,
              },
              {
                name: '표층 포장',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '교통안전시설',
        rows: [
          {
            startMonth: 22,
            sub: '부대·안전시설',
            steps: [
              {
                name: '노면표시·차선도색',
                months: 0.75,
              },
              {
                name: '가드레일·중앙분리대 설치',
                months: 0.75,
              },
              {
                name: '표지판·가로등·신호기 설치',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '준공',
        rows: [
          {
            startMonth: 24,
            sub: '준공처리',
            steps: [
              {
                name: '현장정리·가설물 철거',
                months: 0.5,
              },
              {
                name: '준공측량·준공검사',
                months: 0.5,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'interchange',
    label: '입체교차로(IC/JCT)',
    icon: '🔀',
    group: 'road',
    desc: '램프 성토 + 교량(교대·교각·거더) + 교통시설 — 나들목·분기점',
    packages: [
      {
        name: '주요 마일스톤',
        rows: [
          {
            startMonth: 0,
            steps: [
              {
                name: '착공',
                months: 0,
                ms: true,
                atMonth: 1,
              },
              {
                name: '교량 하부공 착수',
                months: 0,
                ms: true,
                atMonth: 5,
              },
              {
                name: '거더 가설 완료',
                months: 0,
                ms: true,
                atMonth: 19,
              },
              {
                name: '포장 착수',
                months: 0,
                ms: true,
                atMonth: 24,
              },
              {
                name: '준공',
                months: 0,
                ms: true,
                atMonth: 31,
              },
            ],
          },
        ],
      },
      {
        name: '가설공사',
        rows: [
          {
            startMonth: 1,
            sub: '공사준비',
            steps: [
              {
                name: '착공측량·현장사무소·가설도로',
                months: 2,
              },
              {
                name: '우회도로·교통처리',
                months: 1.5,
              },
              {
                name: '지장물 이설·용지정리',
                months: 2.5,
              },
            ],
          },
        ],
      },
      {
        name: '램프 토공·성토',
        rows: [
          {
            startMonth: 2,
            sub: '연약지반',
            steps: [
              {
                name: '연약지반 개량(PBD)',
                months: 3,
              },
              {
                name: '선행재하·계측관리',
                months: 6,
              },
            ],
          },
          {
            startMonth: 3,
            sub: '토공',
            steps: [
              {
                name: '벌개제근·표토제거',
                months: 1.5,
              },
              {
                name: '램프 절토',
                months: 4,
              },
              {
                name: '성토·다짐',
                months: 5,
              },
              {
                name: '비탈면 보호공',
                months: 2.5,
              },
            ],
          },
        ],
      },
      {
        name: '교량공사',
        rows: [
          {
            startMonth: 5,
            sub: '기초·하부공',
            steps: [
              {
                name: '말뚝기초 시공',
                months: 4,
              },
              {
                name: '교대 시공',
                months: 3,
              },
              {
                name: '교각 시공',
                months: 5,
              },
            ],
          },
          {
            startMonth: 14,
            sub: '거더 제작',
            steps: [
              {
                name: '거더 제작·야적(공장)',
                months: 3,
              },
            ],
          },
          {
            startMonth: 17,
            sub: '상부공',
            steps: [
              {
                name: '거더 가설',
                months: 2,
              },
              {
                name: '바닥판·슬래브 타설',
                months: 3,
              },
              {
                name: '교량 방수·신축이음',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '배수·구조물공',
        rows: [
          {
            startMonth: 8,
            sub: '구조물',
            steps: [
              {
                name: '암거·통로박스',
                months: 4,
              },
              {
                name: '옹벽·보강토',
                months: 5,
              },
            ],
          },
          {
            startMonth: 15,
            sub: '배수공',
            steps: [
              {
                name: '관·측구 배수',
                months: 5,
              },
              {
                name: '집수정·맨홀',
                months: 2.5,
              },
            ],
          },
        ],
      },
      {
        name: '포장공사',
        rows: [
          {
            startMonth: 23.5,
            sub: '포장',
            steps: [
              {
                name: '동상방지층·보조기층',
                months: 1.5,
              },
              {
                name: '아스팔트 기층',
                months: 1.5,
              },
              {
                name: '아스팔트 표층 포장',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '교통안전시설공',
        rows: [
          {
            startMonth: 26.5,
            sub: '안전시설',
            steps: [
              {
                name: '방호울타리·가드레일',
                months: 1.5,
              },
              {
                name: '표지판·시선유도시설',
                months: 1,
              },
            ],
          },
          {
            startMonth: 28,
            sub: '노면·전기',
            steps: [
              {
                name: '차선도색·노면표시',
                months: 1,
              },
              {
                name: '조명·전기시설',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '준공공사',
        rows: [
          {
            startMonth: 28,
            sub: '마무리',
            steps: [
              {
                name: '조경·환경정비',
                months: 1.5,
              },
              {
                name: '시운전·검측',
                months: 1,
              },
              {
                name: '준공검사·정리',
                months: 0.5,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'airport',
    label: '공항·활주로',
    icon: '🛫',
    group: 'road',
    desc: '대규모 부지조성 + 활주로·유도로 포장 + 항행안전·등화',
    packages: [
      {
        name: '주요 마일스톤',
        rows: [
          {
            startMonth: 0,
            steps: [
              {
                name: '착공',
                months: 0,
                ms: true,
                atMonth: 1,
              },
              {
                name: '부지조성·잔류침하 안정 완료',
                months: 0,
                ms: true,
                atMonth: 15,
              },
              {
                name: '활주로 포장(PQ콘크리트) 착수',
                months: 0,
                ms: true,
                atMonth: 20,
              },
              {
                name: '포장·그루빙 완료',
                months: 0,
                ms: true,
                atMonth: 35,
              },
              {
                name: '항행·등화 비행점검 완료',
                months: 0,
                ms: true,
                atMonth: 41,
              },
              {
                name: '준공',
                months: 0,
                ms: true,
                atMonth: 42,
              },
            ],
          },
        ],
      },
      {
        name: '가설 및 공사준비',
        rows: [
          {
            startMonth: 1,
            steps: [
              {
                name: '가설사무소·현장가설 설치',
                months: 1.5,
              },
              {
                name: '기준점·규준틀 측량',
                months: 1,
              },
              {
                name: '지장물 이설·수목이식',
                months: 2,
              },
              {
                name: '장애물 제거·부지 정지',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '부지조성 대토공',
        rows: [
          {
            startMonth: 2,
            sub: '토공(절·성토)',
            steps: [
              {
                name: '표토제거·벌개제근',
                months: 1.5,
              },
              {
                name: '절토·운반',
                months: 4,
              },
              {
                name: '성토·층다짐',
                months: 4,
              },
              {
                name: '노체·노상 형성',
                months: 2.5,
              },
            ],
          },
          {
            startMonth: 4,
            sub: '연약지반 개량',
            steps: [
              {
                name: 'PBD·샌드매트 시공',
                months: 3,
              },
              {
                name: '선행재하(성토)·압밀 촉진',
                months: 6,
              },
              {
                name: '계측·잔류침하 확인',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '배수·지하매설물',
        rows: [
          {
            startMonth: 12,
            sub: '우수·지하배수',
            steps: [
              {
                name: '우수관거·집수정 부설',
                months: 3,
              },
              {
                name: '맹암거·지하배수 설치',
                months: 3,
              },
              {
                name: '저류지·배수펌프장 설치',
                months: 3,
              },
            ],
          },
          {
            startMonth: 12,
            sub: '지하공동구·관로',
            steps: [
              {
                name: '전력·통신 관로 매설',
                months: 3.5,
              },
              {
                name: '핸드홀·맨홀 설치',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '활주로/유도로 포장(그루빙)',
        rows: [
          {
            startMonth: 14,
            sub: '보조기층·기층',
            steps: [
              {
                name: '동상방지층 포설',
                months: 2,
              },
              {
                name: '입도조정 보조기층',
                months: 3,
              },
              {
                name: '린콘크리트 기층',
                months: 3,
              },
            ],
          },
          {
            startMonth: 20,
            sub: '활주로 콘크리트 포장',
            steps: [
              {
                name: 'PQ콘크리트 슬래브 타설',
                months: 8,
              },
              {
                name: '양생',
                months: 1.5,
              },
              {
                name: '줄눈절단·주입',
                months: 2,
              },
              {
                name: '표면 그루빙',
                months: 2,
              },
              {
                name: '평탄성·마찰계수 시험',
                months: 1.5,
              },
            ],
          },
          {
            startMonth: 22,
            sub: '유도로·이착륙대',
            steps: [
              {
                name: '유도로 슬래브 타설',
                months: 5,
              },
              {
                name: '쇼울더·과주로(RESA) 포장',
                months: 3,
              },
            ],
          },
        ],
      },
      {
        name: '계류장',
        rows: [
          {
            startMonth: 26,
            steps: [
              {
                name: '계류장 노상·기층 형성',
                months: 3,
              },
              {
                name: '계류장 콘크리트 포장',
                months: 5,
              },
              {
                name: '급유·접지 설비 매립',
                months: 2,
              },
              {
                name: '주기선(마킹) 도색',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '항행안전·등화시설',
        rows: [
          {
            startMonth: 18,
            sub: '등화 기초·관로(포장 병행)',
            steps: [
              {
                name: '등화 기초·슬리브 관로 매립',
                months: 4,
              },
              {
                name: '매입등·표지등 설치',
                months: 4,
              },
              {
                name: 'CCR·정전류조정기 설치',
                months: 2,
              },
            ],
          },
          {
            startMonth: 34,
            sub: '항행안전무선(NAVAID)',
            steps: [
              {
                name: 'ILS·PAPI 설치',
                months: 3,
              },
              {
                name: '표지·표시 도색',
                months: 2,
              },
              {
                name: '비행점검(Flight Check)',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '준공',
        rows: [
          {
            startMonth: 38,
            steps: [
              {
                name: '부대·조경·경계 정비',
                months: 1.5,
              },
              {
                name: '종합시운전·시험운용',
                months: 1.5,
              },
              {
                name: '준공검사·인계인수',
                months: 1,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'bridge-psc',
    label: 'PSC 거더교',
    icon: '🌉',
    group: 'bridge',
    desc: '기초·하부공 + PSC빔 제작·거치 + 바닥판 — 중소경간 표준형',
    packages: [
      {
        name: '주요 마일스톤',
        rows: [
          {
            startMonth: 0,
            steps: [
              {
                name: '착공',
                months: 0,
                ms: true,
                atMonth: 1,
              },
              {
                name: '기초공 완료',
                months: 0,
                ms: true,
                atMonth: 7,
              },
              {
                name: '하부공 완료',
                months: 0,
                ms: true,
                atMonth: 12,
              },
              {
                name: 'PSC빔 거치 완료',
                months: 0,
                ms: true,
                atMonth: 17,
              },
              {
                name: '상부공 완료',
                months: 0,
                ms: true,
                atMonth: 22,
              },
              {
                name: '준공',
                months: 0,
                ms: true,
                atMonth: 24,
              },
            ],
          },
        ],
      },
      {
        name: '가설·가교공',
        rows: [
          {
            startMonth: 1,
            sub: '가설공사',
            steps: [
              {
                name: '공사준비·측량',
                months: 1,
              },
              {
                name: '가설도로·가설사무소',
                months: 1,
              },
              {
                name: '가교·가물막이 설치',
                months: 1.5,
              },
            ],
          },
          {
            startMonth: 22,
            sub: '가시설 철거',
            steps: [
              {
                name: '가교·가물막이 철거',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '기초공',
        rows: [
          {
            startMonth: 3,
            sub: '교대부 기초',
            steps: [
              {
                name: '터파기·지반정리',
                months: 1,
              },
              {
                name: 'PHC파일 항타',
                months: 1.5,
              },
              {
                name: '두부정리·기초콘크리트',
                months: 1,
              },
            ],
          },
          {
            startMonth: 3,
            sub: '교각부 기초',
            steps: [
              {
                name: '우물통 제작·거치',
                months: 1.5,
              },
              {
                name: '우물통 침하·굴착',
                months: 1.5,
              },
              {
                name: '저부·속채움 콘크리트',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '하부공',
        rows: [
          {
            startMonth: 7,
            sub: '교대',
            steps: [
              {
                name: '교대 철근조립·거푸집',
                months: 1.5,
              },
              {
                name: '교대 콘크리트 타설',
                months: 1,
              },
              {
                name: '뒷채움·날개벽',
                months: 1.5,
              },
            ],
          },
          {
            startMonth: 7,
            sub: '교각',
            steps: [
              {
                name: '교각 기둥 철근·거푸집',
                months: 2,
              },
              {
                name: '교각 콘크리트 타설',
                months: 1.5,
              },
              {
                name: '교좌장치 설치',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: 'PSC빔 제작·거치공',
        rows: [
          {
            startMonth: 8,
            sub: '빔 제작',
            steps: [
              {
                name: '제작장 설치·거푸집',
                months: 1.5,
              },
              {
                name: 'PSC빔 철근·긴장재 배치',
                months: 2,
              },
              {
                name: '콘크리트 타설·양생',
                months: 1.5,
              },
              {
                name: '프리스트레싱 긴장',
                months: 1,
              },
            ],
          },
          {
            startMonth: 14,
            sub: '빔 거치',
            steps: [
              {
                name: '빔 운반·크레인 거치',
                months: 1.5,
              },
              {
                name: '가로보·격벽 시공',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '바닥판·방호벽공',
        rows: [
          {
            startMonth: 16.5,
            steps: [
              {
                name: '바닥판 동바리·거푸집',
                months: 1,
              },
              {
                name: '바닥판 철근조립',
                months: 1,
              },
              {
                name: '바닥판 콘크리트 타설·양생',
                months: 1.5,
              },
              {
                name: '방호벽·연석 시공',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '교면포장·부대공',
        rows: [
          {
            startMonth: 21.5,
            sub: '교면·이음',
            steps: [
              {
                name: '교면 방수공',
                months: 0.5,
              },
              {
                name: '교면포장',
                months: 1,
              },
              {
                name: '신축이음장치 설치',
                months: 0.5,
              },
            ],
          },
          {
            startMonth: 22,
            sub: '부대시설',
            steps: [
              {
                name: '배수시설·난간',
                months: 1,
              },
              {
                name: '노면표지·안전시설',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '준공',
        rows: [
          {
            startMonth: 22.5,
            steps: [
              {
                name: '재하시험·초기점검',
                months: 0.5,
              },
              {
                name: '현장정리·마무리',
                months: 0.5,
              },
              {
                name: '준공검사·인수인계',
                months: 0.5,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'bridge-steel',
    label: '강교(플레이트/박스)',
    icon: '🌉',
    group: 'bridge',
    desc: '강거더 공장제작·가설 + 바닥판 합성 + 도장',
    packages: [
      {
        name: '주요 마일스톤',
        rows: [
          {
            startMonth: 0,
            steps: [
              {
                name: '착공',
                months: 0,
                ms: true,
                atMonth: 1,
              },
              {
                name: '기초·하부공 완료',
                months: 0,
                ms: true,
                atMonth: 12,
              },
              {
                name: '강거더 공장제작 완료',
                months: 0,
                ms: true,
                atMonth: 13,
              },
              {
                name: '강거더 가설 완료',
                months: 0,
                ms: true,
                atMonth: 20,
              },
              {
                name: '바닥판 합성 완료',
                months: 0,
                ms: true,
                atMonth: 25,
              },
              {
                name: '준공',
                months: 0,
                ms: true,
                atMonth: 29,
              },
            ],
          },
        ],
      },
      {
        name: '공사준비 및 가설공사',
        rows: [
          {
            startMonth: 1,
            steps: [
              {
                name: '착수계·실시설계(시공상세) 검토',
                months: 1.5,
              },
              {
                name: '가설사무소·가설도로 설치',
                months: 1,
              },
              {
                name: '지장물 이설·기준점 측량',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '기초 및 하부공',
        rows: [
          {
            startMonth: 2,
            sub: '교대·교각 기초',
            steps: [
              {
                name: '가시설·터파기(굴착)',
                months: 1.5,
              },
              {
                name: '현장타설말뚝(파일) 시공',
                months: 2,
              },
              {
                name: '기초 콘크리트 타설·양생',
                months: 1.5,
              },
            ],
          },
          {
            startMonth: 7,
            sub: '교대·교각 본체',
            steps: [
              {
                name: '철근조립·거푸집 설치',
                months: 1.5,
              },
              {
                name: '하부 콘크리트 타설·양생',
                months: 2,
              },
              {
                name: '교좌장치(받침) 설치',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '강거더 공장제작',
        rows: [
          {
            startMonth: 4,
            sub: '제작·검사',
            steps: [
              {
                name: '시공상세도(Shop Dwg) 승인',
                months: 1.5,
              },
              {
                name: '강재 발주·입고',
                months: 2,
              },
              {
                name: '절단·가공·조립용접',
                months: 3,
              },
              {
                name: '비파괴검사(UT/RT)·가조립',
                months: 1.5,
              },
              {
                name: '공장도장(1·2차)',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '강거더 운반 및 가설',
        rows: [
          {
            startMonth: 13.5,
            sub: '운반·가설',
            steps: [
              {
                name: '세그먼트 운반·현장야적',
                months: 1,
              },
              {
                name: '벤트(가설지주) 설치',
                months: 1,
              },
              {
                name: '크레인 대블록 가설',
                months: 2.5,
              },
              {
                name: '현장연결(고장력볼트·현장용접)',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '바닥판(콘크리트 슬래브) 합성',
        rows: [
          {
            startMonth: 19.5,
            sub: '바닥판',
            steps: [
              {
                name: '이동식비계·데크플레이트 설치',
                months: 1,
              },
              {
                name: '전단연결재(스터드)·철근조립',
                months: 1.5,
              },
              {
                name: '바닥판 콘크리트 타설·양생',
                months: 2,
              },
              {
                name: '교면방수·신축이음 설치',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '도장 및 부대공',
        rows: [
          {
            startMonth: 23,
            sub: '도장·부대',
            steps: [
              {
                name: '현장연결부 보수도장',
                months: 1.5,
              },
              {
                name: '교면포장(아스팔트)',
                months: 1.5,
              },
              {
                name: '방호울타리·난간·배수시설',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '준공 및 검사',
        rows: [
          {
            startMonth: 27,
            steps: [
              {
                name: '재하시험(하중시험)',
                months: 1,
              },
              {
                name: '부대·마무리 및 준공청소',
                months: 0.5,
              },
              {
                name: '준공검사·인계',
                months: 0.5,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'bridge-cable',
    label: '사장교',
    icon: '🌉',
    group: 'bridge',
    desc: '대형기초 + 주탑 + 케이블 + 세그먼트 캔틸레버(FCM) — 장경간',
    packages: [
      {
        name: '주요 마일스톤',
        rows: [
          {
            startMonth: 1,
            steps: [
              {
                name: '착공',
                months: 0,
                ms: true,
                atMonth: 1,
              },
              {
                name: '주탑기초(우물통) 완료',
                months: 0,
                ms: true,
                atMonth: 12,
              },
              {
                name: '주탑 완성',
                months: 0,
                ms: true,
                atMonth: 26,
              },
              {
                name: '주경간 폐합(Key Segment)',
                months: 0,
                ms: true,
                atMonth: 42,
              },
              {
                name: '준공',
                months: 0,
                ms: true,
                atMonth: 48,
              },
            ],
          },
        ],
      },
      {
        name: '가설·가교 및 준비공',
        rows: [
          {
            startMonth: 1,
            sub: '가설도로·가교',
            steps: [
              {
                name: '현장개설·가설사무소',
                months: 1.5,
              },
              {
                name: '가설도로 및 진입도로',
                months: 3,
              },
              {
                name: '가설잔교(작업대) 설치',
                months: 2.5,
              },
            ],
          },
          {
            startMonth: 1,
            sub: '지장물·부지정리',
            steps: [
              {
                name: '지장물 이설·보상',
                months: 2,
              },
              {
                name: '부지정리 및 준설',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '대형기초(우물통/현장타설말뚝)',
        rows: [
          {
            startMonth: 3,
            sub: '주탑기초(우물통)',
            steps: [
              {
                name: '우물통 제작·거치',
                months: 3,
              },
              {
                name: '우물통 침하(굴착)',
                months: 4,
              },
              {
                name: '저부·속채움 콘크리트 및 정판',
                months: 2,
              },
            ],
          },
          {
            startMonth: 4,
            sub: '교대·측경간 기초',
            steps: [
              {
                name: '현장타설말뚝 천공·시공',
                months: 4,
              },
              {
                name: '확대기초 타설',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '하부공(교대·교각)',
        rows: [
          {
            startMonth: 8,
            sub: '교대',
            steps: [
              {
                name: '교대 구체 시공',
                months: 3,
              },
              {
                name: '뒤채움 및 접속슬래브',
                months: 2,
              },
            ],
          },
          {
            startMonth: 9,
            sub: '측경간 교각',
            steps: [
              {
                name: '교각 기둥 시공',
                months: 3.5,
              },
              {
                name: '교각 코핑·받침 설치',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '주탑 시공',
        rows: [
          {
            startMonth: 12,
            sub: '주탑 구체',
            steps: [
              {
                name: '주탑 하부(정판~가로보 하단)',
                months: 4,
              },
              {
                name: '주탑 중간부(ACS 폼)',
                months: 6,
              },
              {
                name: '주탑 상부(케이블 정착부)',
                months: 4,
              },
            ],
          },
          {
            startMonth: 26,
            sub: '주탑 부속설비',
            steps: [
              {
                name: '케이블 정착장치 설치',
                months: 2,
              },
              {
                name: '주탑 상부 마감·점검로',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '측경간 보강형(벤트 지지)',
        rows: [
          {
            startMonth: 20,
            sub: '측경간 강교·바닥판',
            steps: [
              {
                name: '측경간 강교 제작·운반',
                months: 6,
              },
              {
                name: '가설벤트 설치 및 측경간 보강형 가설',
                months: 4,
              },
            ],
          },
        ],
      },
      {
        name: '세그먼트 캔틸레버(FCM)·주경간',
        rows: [
          {
            startMonth: 26,
            sub: '주두부·세그먼트',
            steps: [
              {
                name: '주두부(0번 세그먼트) 시공',
                months: 2,
              },
              {
                name: '이동식작업차(FT) 조립·거치',
                months: 1.5,
              },
              {
                name: '캔틸레버 세그먼트 가설(주경간)',
                months: 10,
              },
              {
                name: '주경간 폐합(Key Segment) 시공',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '케이블 가설',
        rows: [
          {
            startMonth: 28,
            sub: '스테이 케이블',
            steps: [
              {
                name: '케이블 반입 및 단계별 설치·1차 장력도입',
                months: 11,
              },
              {
                name: '장력 조정(Tuning)',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '바닥판·포장 및 부대·준공',
        rows: [
          {
            startMonth: 41,
            sub: '바닥판·포장',
            steps: [
              {
                name: '강바닥판/RC 바닥판 마무리',
                months: 2,
              },
              {
                name: '방수 및 신축이음 설치',
                months: 1.5,
              },
              {
                name: '교면포장',
                months: 1.5,
              },
            ],
          },
          {
            startMonth: 43,
            sub: '부대시설',
            steps: [
              {
                name: '난간·방호벽 설치',
                months: 1.5,
              },
              {
                name: '조명·전기·부대설비',
                months: 2,
              },
            ],
          },
          {
            startMonth: 46,
            sub: '준공',
            steps: [
              {
                name: '재하시험 및 계측',
                months: 1,
              },
              {
                name: '정리 및 준공검사',
                months: 1,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'bridge-suspension',
    label: '현수교',
    icon: '🌉',
    group: 'bridge',
    desc: '앵커리지 + 주탑 + 주케이블(에어스피닝) + 보강형 — 초장경간',
    packages: [
      {
        name: '주요 마일스톤',
        rows: [
          {
            startMonth: 0,
            steps: [
              {
                name: '착공',
                months: 0,
                ms: true,
                atMonth: 1,
              },
              {
                name: '앵커리지 완료',
                months: 0,
                ms: true,
                atMonth: 18,
              },
              {
                name: '주탑 완성',
                months: 0,
                ms: true,
                atMonth: 30,
              },
              {
                name: '주케이블 가설 완료',
                months: 0,
                ms: true,
                atMonth: 42,
              },
              {
                name: '보강형 폐합',
                months: 0,
                ms: true,
                atMonth: 52,
              },
              {
                name: '준공',
                months: 0,
                ms: true,
                atMonth: 60,
              },
            ],
          },
        ],
      },
      {
        name: '가설공사',
        rows: [
          {
            startMonth: 1,
            sub: '가설 및 준비공',
            steps: [
              {
                name: '진입도로·가설사무소',
                months: 2,
              },
              {
                name: '가물막이·작업대',
                months: 2,
              },
              {
                name: '대형장비 반입·설치',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '앵커리지공',
        rows: [
          {
            startMonth: 3,
            sub: '좌안 앵커리지',
            steps: [
              {
                name: '터파기·기초굴착',
                months: 4,
              },
              {
                name: '기초콘크리트',
                months: 3,
              },
              {
                name: '정착구·본체 콘크리트',
                months: 6,
              },
              {
                name: '케이블 정착부 설치',
                months: 2,
              },
            ],
          },
          {
            startMonth: 3,
            sub: '우안 앵커리지',
            steps: [
              {
                name: '터파기·기초굴착',
                months: 4,
              },
              {
                name: '기초콘크리트',
                months: 3,
              },
              {
                name: '정착구·본체 콘크리트',
                months: 6,
              },
              {
                name: '케이블 정착부 설치',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '주탑공',
        rows: [
          {
            startMonth: 6,
            sub: '주탑 기초',
            steps: [
              {
                name: '우물통·현장타설말뚝',
                months: 6,
              },
              {
                name: '주탑 기초 콘크리트',
                months: 4,
              },
            ],
          },
          {
            startMonth: 16,
            sub: '주탑 본체',
            steps: [
              {
                name: '주탑 하부 콘크리트',
                months: 5,
              },
              {
                name: '주탑 상부 슬립폼(ACS) 시공',
                months: 7,
              },
              {
                name: '새들 설치·정밀측량',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '캣워크·주케이블공',
        rows: [
          {
            startMonth: 30,
            sub: '가설 준비',
            steps: [
              {
                name: '파일럿로프·캣워크 가설',
                months: 3,
              },
              {
                name: '트램·작업설비 설치',
                months: 2,
              },
            ],
          },
          {
            startMonth: 35,
            sub: '주케이블 가설',
            steps: [
              {
                name: 'PPWS 스트랜드 가설',
                months: 5,
              },
              {
                name: '케이블 스퀴징·랩핑',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '행어·보강형공',
        rows: [
          {
            startMonth: 42,
            sub: '행어 및 보강형',
            steps: [
              {
                name: '케이블밴드·행어로프 설치',
                months: 3,
              },
              {
                name: '보강형(강박스거더) 인양·가설',
                months: 6,
              },
              {
                name: '보강형 폐합·현장용접',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '바닥판·부대공',
        rows: [
          {
            startMonth: 52,
            sub: '바닥판·포장',
            steps: [
              {
                name: '바닥판 설치·전단연결',
                months: 3,
              },
              {
                name: '교면방수·아스팔트포장',
                months: 2,
              },
            ],
          },
          {
            startMonth: 52,
            sub: '부대공',
            steps: [
              {
                name: '신축이음·난간·방호울타리',
                months: 2,
              },
              {
                name: '조명·전기·부대시설',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '준공',
        rows: [
          {
            startMonth: 57,
            sub: '시험 및 준공',
            steps: [
              {
                name: '재하시험·계측',
                months: 1.5,
              },
              {
                name: '정리·마무리공',
                months: 1,
              },
              {
                name: '준공검사·인계',
                months: 0.5,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'tunnel-natm',
    label: '산악터널(NATM)',
    icon: '⛰️',
    group: 'tunnel',
    desc: '발파 굴착 + 숏크리트·록볼트 지보 + 라이닝 — 산악 표준',
    packages: [
      {
        name: '주요 마일스톤',
        rows: [
          {
            startMonth: 0,
            steps: [
              {
                name: '착공',
                months: 0,
                ms: true,
                atMonth: 1,
              },
              {
                name: '갱구부 완료·굴착 착수',
                months: 0,
                ms: true,
                atMonth: 4,
              },
              {
                name: '굴착(관통) 완료',
                months: 0,
                ms: true,
                atMonth: 20,
              },
              {
                name: '라이닝 콘크리트 완료',
                months: 0,
                ms: true,
                atMonth: 32,
              },
              {
                name: '포장·설비 완료',
                months: 0,
                ms: true,
                atMonth: 36.5,
              },
              {
                name: '준공',
                months: 0,
                ms: true,
                atMonth: 37,
              },
            ],
          },
        ],
      },
      {
        name: '갱구부·가설공사',
        rows: [
          {
            startMonth: 1,
            sub: '가설 및 준비공',
            steps: [
              {
                name: '가설사무소·현장정비',
                months: 1,
              },
              {
                name: '진입도로·가설전기·용수',
                months: 1.5,
              },
            ],
          },
          {
            startMonth: 2,
            sub: '갱구부 공사',
            steps: [
              {
                name: '갱구부 사면정리·토공',
                months: 1,
              },
              {
                name: '갱구 보강(억지말뚝·앵커)',
                months: 1,
              },
              {
                name: '갱문(포탈)·파이프루프 시공',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '보조공법·그라우팅',
        rows: [
          {
            startMonth: 3.5,
            sub: '막장 보조공법',
            steps: [
              {
                name: '훠폴링·강관다단 그라우팅',
                months: 15,
              },
            ],
          },
          {
            startMonth: 4,
            sub: '차수·지반보강',
            steps: [
              {
                name: '우레탄·시멘트 그라우팅(수시)',
                months: 15,
              },
            ],
          },
        ],
      },
      {
        name: '굴착(발파)·버력처리',
        rows: [
          {
            startMonth: 4,
            sub: '상반(굴착·발파)',
            steps: [
              {
                name: '천공·장약·발파(상반)',
                months: 9,
              },
              {
                name: '버력처리·환기·부석정리',
                months: 0.5,
              },
            ],
          },
          {
            startMonth: 6,
            sub: '하반·인버트 굴착',
            steps: [
              {
                name: '하반 굴착·확폭',
                months: 8,
              },
              {
                name: '인버트부 굴착·버력처리',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '숏크리트·록볼트 지보',
        rows: [
          {
            startMonth: 4.3,
            sub: '1차 지보(막장 후속)',
            steps: [
              {
                name: '강지보(H형강)·격자지보 설치',
                months: 4,
              },
              {
                name: '1차 숏크리트 타설',
                months: 6,
              },
              {
                name: '록볼트 시공',
                months: 6,
              },
            ],
          },
          {
            startMonth: 5,
            sub: '계측관리',
            steps: [
              {
                name: '내공변위·천단침하·지중변위 계측',
                months: 16,
              },
            ],
          },
        ],
      },
      {
        name: '방수·배수공',
        rows: [
          {
            startMonth: 19,
            sub: '방배수 설치',
            steps: [
              {
                name: '부직포·PVC 방수시트 설치',
                months: 5,
              },
              {
                name: '측벽 유공관·횡배수관 설치',
                months: 4,
              },
            ],
          },
          {
            startMonth: 20,
            sub: '중앙배수공',
            steps: [
              {
                name: '중앙집수정·중앙배수관 부설',
                months: 5,
              },
            ],
          },
        ],
      },
      {
        name: '라이닝 콘크리트',
        rows: [
          {
            startMonth: 23,
            sub: '2차 라이닝',
            steps: [
              {
                name: '라이닝 폼(이동식 거푸집) 설치',
                months: 1.5,
              },
              {
                name: '라이닝 콘크리트 타설',
                months: 6,
              },
              {
                name: '양생·탈형·마감',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '인버트·포장',
        rows: [
          {
            startMonth: 30,
            sub: '인버트·도로포장',
            steps: [
              {
                name: '인버트 콘크리트·되메우기',
                months: 2,
              },
              {
                name: '노상·보조기층·기층 포장',
                months: 1.5,
              },
              {
                name: '아스팔트 표층 포장',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '설비·준공',
        rows: [
          {
            startMonth: 33,
            sub: '터널 부대설비',
            steps: [
              {
                name: '환기·소방(제연)설비',
                months: 1.5,
              },
              {
                name: '조명·전기·방재제어(FMS)설비',
                months: 2,
              },
            ],
          },
          {
            startMonth: 35.5,
            sub: '준공 마무리',
            steps: [
              {
                name: '부대공·안전시설·표지판',
                months: 0.5,
              },
              {
                name: '시운전·시측·준공검사',
                months: 1,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'tunnel-tbm',
    label: 'TBM 터널',
    icon: '🕳️',
    group: 'tunnel',
    desc: 'TBM 굴진 + 세그먼트 조립 + 뒤채움 그라우팅',
    packages: [
      {
        name: '주요 마일스톤',
        rows: [
          {
            startMonth: 0,
            steps: [
              {
                name: '착공',
                months: 0,
                ms: true,
                atMonth: 1,
              },
              {
                name: '발진작업구 완료',
                months: 0,
                ms: true,
                atMonth: 9,
              },
              {
                name: 'TBM 굴진 개시',
                months: 0,
                ms: true,
                atMonth: 13,
              },
              {
                name: 'TBM 관통(도달)',
                months: 0,
                ms: true,
                atMonth: 32,
              },
              {
                name: '내부공 완료',
                months: 0,
                ms: true,
                atMonth: 38,
              },
              {
                name: '준공',
                months: 0,
                ms: true,
                atMonth: 41,
              },
            ],
          },
        ],
      },
      {
        name: '공사준비 및 가설공사',
        rows: [
          {
            startMonth: 1,
            steps: [
              {
                name: '착공 및 현장개설',
                months: 1,
              },
              {
                name: '가설사무소·가설도로',
                months: 1.5,
              },
              {
                name: '지장물 조사·이설',
                months: 2,
              },
              {
                name: '측량 및 기준점 설치',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '발진작업구',
        rows: [
          {
            startMonth: 2,
            sub: '흙막이 가시설',
            steps: [
              {
                name: '지반개량(그라우팅)',
                months: 1.5,
              },
              {
                name: '흙막이벽(지하연속벽·CIP)',
                months: 2,
              },
              {
                name: '단계별 굴착·버팀보 설치',
                months: 2.5,
              },
            ],
          },
          {
            startMonth: 8,
            sub: '작업구 구체',
            steps: [
              {
                name: '바닥슬래브·반력벽 타설',
                months: 1,
              },
              {
                name: '발진대·엔트런스 패킹 설치',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: 'TBM 반입 및 조립',
        rows: [
          {
            startMonth: 9,
            steps: [
              {
                name: 'TBM 장비 반입',
                months: 1,
              },
              {
                name: '본체·후속대차 조립',
                months: 2,
              },
              {
                name: '시운전 및 초기굴진 준비',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '터널 굴진 및 세그먼트 조립',
        rows: [
          {
            startMonth: 13,
            sub: '굴진·세그먼트',
            steps: [
              {
                name: '초기굴진',
                months: 2,
              },
              {
                name: '본굴진(세그먼트 라이닝)',
                months: 16,
              },
              {
                name: '도달굴진',
                months: 1,
              },
            ],
          },
          {
            startMonth: 14,
            sub: '뒤채움 그라우팅',
            steps: [
              {
                name: '1차 뒤채움(동시주입)',
                months: 17,
              },
              {
                name: '2차 보강 그라우팅',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '도달작업구 및 TBM 해체',
        rows: [
          {
            startMonth: 6,
            sub: '도달작업구',
            steps: [
              {
                name: '흙막이 및 단계 굴착',
                months: 4,
              },
              {
                name: '구체 및 도달부 준비',
                months: 3,
              },
            ],
          },
          {
            startMonth: 32,
            sub: 'TBM 해체·반출',
            steps: [
              {
                name: 'TBM 도달·해체',
                months: 1.5,
              },
              {
                name: '장비 반출',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '내부공(방수·노반·구조물)',
        rows: [
          {
            startMonth: 22,
            sub: '방수·인버트·노반',
            steps: [
              {
                name: '방수공(라이닝 방수)',
                months: 3,
              },
              {
                name: '인버트 콘크리트 타설',
                months: 5,
              },
              {
                name: '노반·궤도기초',
                months: 4,
              },
              {
                name: '배수공(측구·집수정)',
                months: 2,
              },
            ],
          },
          {
            startMonth: 31,
            sub: '내부 구조물',
            steps: [
              {
                name: '중앙벽·대피통로·연결통로',
                months: 4,
              },
              {
                name: '내부 마감·도장',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '부대·설비공사',
        rows: [
          {
            startMonth: 31,
            sub: '기계·소방',
            steps: [
              {
                name: '환기·제연설비',
                months: 4,
              },
              {
                name: '소방·방재설비',
                months: 3,
              },
            ],
          },
          {
            startMonth: 33,
            sub: '전기·통신',
            steps: [
              {
                name: '전력·조명설비',
                months: 3.5,
              },
              {
                name: '통신·방재계측(ITS)',
                months: 2.5,
              },
            ],
          },
        ],
      },
      {
        name: '준공 및 시운전',
        rows: [
          {
            startMonth: 38,
            steps: [
              {
                name: '종합 시운전',
                months: 1,
              },
              {
                name: '현장정리·원상복구',
                months: 1,
              },
              {
                name: '준공검사 및 준공',
                months: 1,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'tunnel-cut',
    label: '개착식 터널',
    icon: '🧱',
    group: 'tunnel',
    desc: '흙막이 + 굴착 + 박스 구조물 + 되메우기·복공',
    packages: [
      {
        name: '주요 마일스톤',
        rows: [
          {
            startMonth: 0,
            steps: [
              {
                name: '착공',
                months: 0,
                ms: true,
                atMonth: 1,
              },
              {
                name: '흙막이 완료',
                months: 0,
                ms: true,
                atMonth: 7,
              },
              {
                name: '굴착 완료',
                months: 0,
                ms: true,
                atMonth: 13,
              },
              {
                name: '본체 구조물 완료',
                months: 0,
                ms: true,
                atMonth: 19,
              },
              {
                name: '되메우기·복공 완료',
                months: 0,
                ms: true,
                atMonth: 23,
              },
              {
                name: '준공',
                months: 0,
                ms: true,
                atMonth: 24,
              },
            ],
          },
        ],
      },
      {
        name: '가설·지장물',
        rows: [
          {
            startMonth: 1,
            sub: '가설공사',
            steps: [
              {
                name: '현장측량·부지정리',
                months: 1,
              },
              {
                name: '가설사무소·가설울타리 설치',
                months: 1,
              },
              {
                name: '가설도로·공사용도로',
                months: 1,
              },
            ],
          },
          {
            startMonth: 1,
            sub: '지장물 이설',
            steps: [
              {
                name: '지하매설물 조사·탐사',
                months: 1,
              },
              {
                name: '상하수도·통신·전력 지장물 이설',
                months: 3,
              },
            ],
          },
        ],
      },
      {
        name: '흙막이·차수',
        rows: [
          {
            startMonth: 2,
            sub: '흙막이벽 (CIP)',
            steps: [
              {
                name: '가이드월·천공',
                months: 1.5,
              },
              {
                name: 'CIP 철근망 근입·콘크리트 타설',
                months: 2,
              },
              {
                name: '캡빔(두겁보) 타설',
                months: 1,
              },
            ],
          },
          {
            startMonth: 3.5,
            sub: '차수·지하수 처리',
            steps: [
              {
                name: '차수그라우팅(LW/SGR)',
                months: 2,
              },
              {
                name: '집수정·배수설비(양수) 설치',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '굴착·버팀보',
        rows: [
          {
            startMonth: 6.5,
            sub: '단계별 굴착·지보공(교대 시공)',
            steps: [
              {
                name: '1단 굴착·토공반출',
                months: 1.5,
              },
              {
                name: '1단 버팀보(H-Beam) 설치',
                months: 1,
              },
              {
                name: '2단 굴착·토공반출',
                months: 1.5,
              },
              {
                name: '2단 버팀보 설치',
                months: 1,
              },
              {
                name: '3단 굴착·토공반출',
                months: 1,
              },
              {
                name: '바닥면 정리·터파기 마무리',
                months: 0.5,
              },
            ],
          },
        ],
      },
      {
        name: '계측관리',
        rows: [
          {
            startMonth: 5,
            sub: '안전계측',
            steps: [
              {
                name: '계측기 매설·초기치 측정',
                months: 1,
              },
              {
                name: '굴착·구조물 시공중 계측·관리',
                months: 15,
              },
            ],
          },
        ],
      },
      {
        name: '본체 구조물',
        rows: [
          {
            startMonth: 13,
            sub: '기초·바닥슬래브',
            steps: [
              {
                name: '버림콘크리트 타설',
                months: 0.5,
              },
              {
                name: '바닥슬래브 철근·거푸집',
                months: 1,
              },
              {
                name: '바닥슬래브 콘크리트 타설·양생',
                months: 1,
              },
            ],
          },
          {
            startMonth: 15.5,
            sub: '벽체',
            steps: [
              {
                name: '벽체 철근·거푸집',
                months: 1.5,
              },
              {
                name: '벽체 콘크리트 타설·양생',
                months: 1.5,
              },
            ],
          },
          {
            startMonth: 18,
            sub: '상부슬래브',
            steps: [
              {
                name: '상부슬래브 동바리·거푸집·철근',
                months: 1,
              },
              {
                name: '상부슬래브 콘크리트 타설·양생',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '방수',
        rows: [
          {
            startMonth: 13,
            sub: '바닥부 방수',
            steps: [
              {
                name: '버림면 밑면 방수(외방수)',
                months: 0.5,
              },
            ],
          },
          {
            startMonth: 17,
            sub: '벽체·상부 방수',
            steps: [
              {
                name: '벽체 외방수·보호층',
                months: 1,
              },
              {
                name: '상부슬래브 방수·보호콘크리트',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '되메우기·복공',
        rows: [
          {
            startMonth: 19,
            sub: '되메우기·해체',
            steps: [
              {
                name: '버팀보 단계별 해체',
                months: 1,
              },
              {
                name: '구조물 뒤채움·되메우기(층다짐)',
                months: 2,
              },
            ],
          },
          {
            startMonth: 22,
            sub: '복공·포장',
            steps: [
              {
                name: '노반·보조기층 시공',
                months: 0.5,
              },
              {
                name: '아스팔트 포장·복공',
                months: 0.5,
              },
            ],
          },
        ],
      },
      {
        name: '부대공·준공',
        rows: [
          {
            startMonth: 22.5,
            steps: [
              {
                name: '부대공·배수시설·표지판·방호울타리',
                months: 1,
              },
              {
                name: '현장정리·준공검사·인계',
                months: 0.5,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'tunnel-immersed',
    label: '침매터널',
    icon: '🌊',
    group: 'tunnel',
    desc: '함체 제작 + 준설·기초 + 예항·침설 + 수중연결 — 하저·해저',
    packages: [
      {
        name: '주요 마일스톤',
        rows: [
          {
            startMonth: 0,
            steps: [
              {
                name: '착공',
                months: 0,
                ms: true,
                atMonth: 1,
              },
              {
                name: '건선거 준공',
                months: 0,
                ms: true,
                atMonth: 10,
              },
              {
                name: '1호 함체 진수',
                months: 0,
                ms: true,
                atMonth: 19,
              },
              {
                name: '최종 함체 침설 완료',
                months: 0,
                ms: true,
                atMonth: 36,
              },
              {
                name: '관통',
                months: 0,
                ms: true,
                atMonth: 40,
              },
              {
                name: '준공',
                months: 0,
                ms: true,
                atMonth: 48,
              },
            ],
          },
        ],
      },
      {
        name: '함체 제작장(건선거)',
        rows: [
          {
            startMonth: 1,
            sub: '건선거 조성',
            steps: [
              {
                name: '준비공·가설공사',
                months: 2,
              },
              {
                name: '토공·굴착',
                months: 3,
              },
              {
                name: '가물막이·차수공',
                months: 2,
              },
              {
                name: '건선거 구조물 축조',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '육상 접속부(개착터널)',
        rows: [
          {
            startMonth: 4,
            sub: '육측 개착부',
            steps: [
              {
                name: '가시설·흙막이공',
                months: 4,
              },
              {
                name: '터파기·기초공',
                months: 4,
              },
              {
                name: '개착 박스 구조물 축조',
                months: 8,
              },
              {
                name: '되메우기·복공',
                months: 3,
              },
            ],
          },
        ],
      },
      {
        name: '준설·기초트렌치',
        rows: [
          {
            startMonth: 3,
            sub: '항로 준설',
            steps: [
              {
                name: '준설 준비·측량',
                months: 1,
              },
              {
                name: '본준설·사토처리',
                months: 6,
              },
              {
                name: '기초트렌치 굴착',
                months: 4,
              },
            ],
          },
          {
            startMonth: 16,
            sub: '기초처리',
            steps: [
              {
                name: '쇄석기초 부설·고르기',
                months: 6,
              },
            ],
          },
        ],
      },
      {
        name: '함체 제작(케이슨)',
        rows: [
          {
            startMonth: 10,
            sub: '1~3함 제작',
            steps: [
              {
                name: '철근·거푸집·콘크리트 타설',
                months: 6,
              },
              {
                name: '방수·의장공',
                months: 2,
              },
              {
                name: '주수·진수',
                months: 1,
              },
            ],
          },
          {
            startMonth: 19,
            sub: '4~6함 제작',
            steps: [
              {
                name: '철근·거푸집·콘크리트 타설',
                months: 6,
              },
              {
                name: '방수·의장공',
                months: 2,
              },
              {
                name: '주수·진수',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '예항·침설',
        rows: [
          {
            startMonth: 19,
            sub: '함체 예항·침설',
            steps: [
              {
                name: '예항·계류',
                months: 1,
              },
              {
                name: '함체 침설·가고정',
                months: 14,
              },
              {
                name: '위치조정·수중측량',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '수중 연결·되메우기',
        rows: [
          {
            startMonth: 22,
            sub: '수중연결',
            steps: [
              {
                name: '수중 접합·배수',
                months: 8,
              },
              {
                name: '최종이음(폐합)',
                months: 6,
              },
              {
                name: '관통',
                months: 4,
              },
            ],
          },
          {
            startMonth: 30,
            sub: '기초·보호공',
            steps: [
              {
                name: '모르타르 그라우팅(수중기초)',
                months: 4,
              },
              {
                name: '측면·상부 되메우기',
                months: 4,
              },
              {
                name: '사석 보호공',
                months: 3,
              },
            ],
          },
        ],
      },
      {
        name: '내부공·설비',
        rows: [
          {
            startMonth: 40,
            sub: '토목마감',
            steps: [
              {
                name: '내부 격벽·포장공',
                months: 3,
              },
              {
                name: '배수·방재구조물',
                months: 2,
              },
            ],
          },
          {
            startMonth: 40,
            sub: '전기·기계설비',
            steps: [
              {
                name: '환기·조명·소방설비',
                months: 4,
              },
              {
                name: '관제·전기설비',
                months: 3,
              },
            ],
          },
        ],
      },
      {
        name: '준공',
        rows: [
          {
            startMonth: 44,
            sub: '시운전·준공',
            steps: [
              {
                name: '종합 시운전',
                months: 2,
              },
              {
                name: '부대·정리공사',
                months: 1,
              },
              {
                name: '준공검사·인계',
                months: 1,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'river-improve',
    label: '하천정비·제방',
    icon: '🏞️',
    group: 'river',
    desc: '하도 준설 + 제방 축조 + 호안 + 수문·통관',
    packages: [
      {
        name: '주요 마일스톤',
        rows: [
          {
            startMonth: 0,
            steps: [
              {
                name: '착공',
                months: 0,
                ms: true,
                atMonth: 1,
              },
              {
                name: '물돌리기 완료',
                months: 0,
                ms: true,
                atMonth: 4,
              },
              {
                name: '제방 축조 완료',
                months: 0,
                ms: true,
                atMonth: 15,
              },
              {
                name: '호안공 완료',
                months: 0,
                ms: true,
                atMonth: 20,
              },
              {
                name: '수문·통관 완료',
                months: 0,
                ms: true,
                atMonth: 21,
              },
              {
                name: '물막이 철거·통수',
                months: 0,
                ms: true,
                atMonth: 22,
              },
              {
                name: '준공',
                months: 0,
                ms: true,
                atMonth: 24,
              },
            ],
          },
        ],
      },
      {
        name: '가설·물돌리기',
        rows: [
          {
            startMonth: 1,
            sub: '가설공사',
            steps: [
              {
                name: '현장가설·기준점측량',
                months: 1,
              },
              {
                name: '가설도로·진입로',
                months: 1.5,
              },
              {
                name: '오탁방지막·환경가시설',
                months: 0.5,
              },
            ],
          },
          {
            startMonth: 2,
            sub: '물돌리기',
            steps: [
              {
                name: '가물막이(토사·시트파일)',
                months: 1.5,
              },
              {
                name: '유수전환·배수펌프 운영',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '하도 준설·굴착',
        rows: [
          {
            startMonth: 4.5,
            sub: '하도정비',
            steps: [
              {
                name: '하도 준설',
                months: 2.5,
              },
              {
                name: '하천 굴착·확폭',
                months: 2.5,
              },
              {
                name: '준설토 운반·처리(사토)',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '제방 축조·다짐',
        rows: [
          {
            startMonth: 6,
            sub: '기초·제체성토',
            steps: [
              {
                name: '기초지반 처리·연약지반보강',
                months: 1.5,
              },
              {
                name: '시험성토·다짐관리',
                months: 0.5,
              },
              {
                name: '제방 성토·포설',
                months: 4,
              },
              {
                name: '층다짐·품질관리시험',
                months: 2.5,
              },
            ],
          },
          {
            startMonth: 15,
            sub: '제방마무리',
            steps: [
              {
                name: '비탈면(사면) 정리·정형',
                months: 1,
              },
              {
                name: '천단·둑마루 포장(관리용도로)',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '호안·護岸 블록',
        rows: [
          {
            startMonth: 13,
            sub: '기초호안',
            steps: [
              {
                name: '호안 기초터파기',
                months: 1.5,
              },
              {
                name: '기초콘크리트·근고공(밑다짐)',
                months: 2,
              },
            ],
          },
          {
            startMonth: 16,
            sub: '블록공',
            steps: [
              {
                name: '호안블록·붙임돌 거치',
                months: 2.5,
              },
              {
                name: '뒤채움·필터층·줄눈',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '수문·통관(구조물)',
        rows: [
          {
            startMonth: 8,
            sub: '구조물공',
            steps: [
              {
                name: '가시설·터파기',
                months: 1.5,
              },
              {
                name: '기초말뚝·바닥콘크리트',
                months: 1,
              },
              {
                name: '본체 철근콘크리트(수문·통문)',
                months: 3.5,
              },
              {
                name: '되메우기·양생',
                months: 1.5,
              },
            ],
          },
          {
            startMonth: 18,
            sub: '기계·설비',
            steps: [
              {
                name: '수문 권양기·문비 설치',
                months: 2,
              },
              {
                name: '시운전·통수시험',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '하천환경·조경',
        rows: [
          {
            startMonth: 20,
            sub: '환경공',
            steps: [
              {
                name: '생태호안·식생매트',
                months: 1.5,
              },
              {
                name: '제방 녹화·식재',
                months: 1,
              },
              {
                name: '산책로·친수시설',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '준공',
        rows: [
          {
            startMonth: 22,
            sub: '마무리·준공',
            steps: [
              {
                name: '물막이 철거·통수·현장복구',
                months: 1,
              },
              {
                name: '준공측량·정산',
                months: 0.5,
              },
              {
                name: '준공검사·인계',
                months: 0.5,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'seawall',
    label: '방조제·하구둑',
    icon: '🌊',
    group: 'river',
    desc: '연약지반 개량 + 제체 축조 + 최종 물막이 + 배수갑문',
    packages: [
      {
        name: '주요 마일스톤',
        rows: [
          {
            startMonth: 0,
            steps: [
              {
                name: '착공',
                months: 0,
                ms: true,
                atMonth: 1,
              },
              {
                name: '연약지반 개량 완료',
                months: 0,
                ms: true,
                atMonth: 16,
              },
              {
                name: '배수갑문 통수',
                months: 0,
                ms: true,
                atMonth: 30,
              },
              {
                name: '최종 물막이(합룡) 완료',
                months: 0,
                ms: true,
                atMonth: 38,
              },
              {
                name: '준공',
                months: 0,
                ms: true,
                atMonth: 48,
              },
            ],
          },
        ],
      },
      {
        name: '가설·준비공',
        rows: [
          {
            startMonth: 1,
            sub: '가설공',
            steps: [
              {
                name: '가설도로·진입로 개설',
                months: 2,
              },
              {
                name: '가설사무소·야적장 설치',
                months: 1.5,
              },
              {
                name: '토취장·사석원 확보',
                months: 1.5,
              },
            ],
          },
          {
            startMonth: 1,
            sub: '측량·지반조사',
            steps: [
              {
                name: '기준점·현황측량',
                months: 1.5,
              },
              {
                name: '지반조사·시추',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '연약지반 개량',
        rows: [
          {
            startMonth: 3,
            sub: '지반개량 본공사',
            steps: [
              {
                name: 'PBD(연직배수재) 타설',
                months: 4,
              },
              {
                name: '재하성토(단계성토)',
                months: 4,
              },
              {
                name: '압밀침하 계측관리',
                months: 5,
              },
              {
                name: '제하(除荷)·정리',
                months: 1,
              },
            ],
          },
          {
            startMonth: 4,
            sub: '기초처리',
            steps: [
              {
                name: '치환공(양질토 치환)',
                months: 3,
              },
              {
                name: '제체 기초 정지',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '제체 축조',
        rows: [
          {
            startMonth: 10,
            sub: '제체 사석공',
            steps: [
              {
                name: '기초사석 투하·정지',
                months: 4,
              },
              {
                name: '제체 사석 축조',
                months: 9,
              },
              {
                name: '제체 성토·다짐',
                months: 5,
              },
            ],
          },
          {
            startMonth: 20,
            sub: '피복·호안공',
            steps: [
              {
                name: '피복석·근고블록 거치',
                months: 7,
              },
              {
                name: '사면 호안공·소파블록',
                months: 6,
              },
            ],
          },
        ],
      },
      {
        name: '배수갑문',
        rows: [
          {
            startMonth: 6,
            sub: '갑문 구조물',
            steps: [
              {
                name: '가물막이·터파기',
                months: 3,
              },
              {
                name: '기초말뚝·기초콘크리트',
                months: 5,
              },
              {
                name: '갑문 본체 콘크리트 타설',
                months: 9,
              },
              {
                name: '수문 문비·권양기 설치',
                months: 5,
              },
              {
                name: '시운전·통수시험',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '최종 물막이(끝막이)',
        rows: [
          {
            startMonth: 32,
            sub: '끝막이 공사',
            steps: [
              {
                name: '끝막이 준비·사석 비축',
                months: 2,
              },
              {
                name: '점축·병축 사석 투하',
                months: 3,
              },
              {
                name: '최종 끝막이(합룡)',
                months: 2,
              },
              {
                name: '제체 보강·마무리 축조',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '도로·부대공',
        rows: [
          {
            startMonth: 38,
            sub: '관리도로공',
            steps: [
              {
                name: '노체·노상 성토',
                months: 3,
              },
              {
                name: '보조기층·기층 포설',
                months: 2,
              },
              {
                name: '아스팔트 포장',
                months: 1.5,
              },
            ],
          },
          {
            startMonth: 40,
            sub: '부대시설공',
            steps: [
              {
                name: '안전·부대시설 설치',
                months: 3,
              },
              {
                name: '조경·녹화공',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '준공',
        rows: [
          {
            startMonth: 45,
            sub: '준공·인계',
            steps: [
              {
                name: '종합 시운전·통수시험',
                months: 1.5,
              },
              {
                name: '준공검사·정산',
                months: 1,
              },
              {
                name: '준공도서·인계인수',
                months: 0.5,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'pump-station',
    label: '배수펌프장',
    icon: '💧',
    group: 'river',
    desc: '유수지 + 펌프장 토목구조물 + 기전·전기설비 + 시운전',
    packages: [
      {
        name: '주요 마일스톤',
        rows: [
          {
            startMonth: 0,
            steps: [
              {
                name: '착공',
                months: 0,
                ms: true,
                atMonth: 1,
              },
              {
                name: '흙막이 완료',
                months: 0,
                ms: true,
                atMonth: 6,
              },
              {
                name: '펌프장 본체 골조 완료',
                months: 0,
                ms: true,
                atMonth: 18,
              },
              {
                name: '기전설비 설치 완료',
                months: 0,
                ms: true,
                atMonth: 25,
              },
              {
                name: '시운전 완료',
                months: 0,
                ms: true,
                atMonth: 29,
              },
              {
                name: '준공',
                months: 0,
                ms: true,
                atMonth: 30,
              },
            ],
          },
        ],
      },
      {
        name: '가설·준비공',
        rows: [
          {
            startMonth: 1,
            sub: '착공준비',
            steps: [
              {
                name: '실시설계 확정·인허가',
                months: 1,
              },
              {
                name: '지장물 조사·이설',
                months: 1.5,
              },
            ],
          },
          {
            startMonth: 1,
            sub: '가설공사',
            steps: [
              {
                name: '현장가설·부지정리',
                months: 1.5,
              },
              {
                name: '진입로·가시설 설치',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '가설·흙막이',
        rows: [
          {
            startMonth: 2.5,
            sub: '흙막이공',
            steps: [
              {
                name: '엄지말뚝·CIP 시공',
                months: 2,
              },
              {
                name: '버팀보·앵커 설치',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '유수지 굴착',
        rows: [
          {
            startMonth: 4.5,
            sub: '굴착·배수',
            steps: [
              {
                name: '단계별 터파기',
                months: 3,
              },
              {
                name: '집수정·배수처리',
                months: 1,
              },
              {
                name: '기초지반 확인·잔토처리',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '기초공(파일)',
        rows: [
          {
            startMonth: 9,
            sub: '기초말뚝',
            steps: [
              {
                name: 'PHC·강관파일 항타',
                months: 2,
              },
              {
                name: '두부정리·기초확인',
                months: 0.5,
              },
            ],
          },
        ],
      },
      {
        name: '토목구조물(펌프장 본체)',
        rows: [
          {
            startMonth: 10,
            sub: '본체 구체',
            steps: [
              {
                name: '기초 콘크리트·매트',
                months: 1.5,
              },
              {
                name: '저부슬래브·벽체 철근콘크리트',
                months: 3.5,
              },
              {
                name: '상부슬래브·펌프실 골조',
                months: 3,
              },
            ],
          },
          {
            startMonth: 15,
            sub: '유입·토출 구조물',
            steps: [
              {
                name: '유입수로·스크린실 시공',
                months: 2.5,
              },
              {
                name: '토출수조·방류암거 시공',
                months: 3,
              },
            ],
          },
        ],
      },
      {
        name: '기전설비(펌프·배관)',
        rows: [
          {
            startMonth: 18.5,
            sub: '펌프설비',
            steps: [
              {
                name: '주펌프 반입·기초앵커',
                months: 2,
              },
              {
                name: '펌프·감속기 설치·정렬',
                months: 3,
              },
            ],
          },
          {
            startMonth: 20,
            sub: '배관설비',
            steps: [
              {
                name: '토출관·밸브 제작반입',
                months: 2,
              },
              {
                name: '배관 설치·용접',
                months: 2.5,
              },
              {
                name: '수압시험·보온',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '전기·계장',
        rows: [
          {
            startMonth: 20.5,
            sub: '전기설비',
            steps: [
              {
                name: '수변전·MCC 설치',
                months: 2.5,
              },
              {
                name: '동력·조명 배선',
                months: 2.5,
              },
            ],
          },
          {
            startMonth: 23,
            sub: '계장·자동제어',
            steps: [
              {
                name: '계측기·수위계 설치',
                months: 1.5,
              },
              {
                name: 'PLC·감시제어반 구축',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '부대·마감공사',
        rows: [
          {
            startMonth: 18,
            sub: '건축·마감',
            steps: [
              {
                name: '관리동·상부건축 마감',
                months: 3,
              },
              {
                name: '방수·도장',
                months: 2,
              },
            ],
          },
          {
            startMonth: 25.5,
            sub: '외부공사',
            steps: [
              {
                name: '되메우기·구조물 뒤채움',
                months: 2,
              },
              {
                name: '포장·조경·부대시설',
                months: 2.5,
              },
            ],
          },
        ],
      },
      {
        name: '시운전·준공',
        rows: [
          {
            startMonth: 26.5,
            sub: '시운전',
            steps: [
              {
                name: '단독기기 시운전',
                months: 1.5,
              },
              {
                name: '통수·종합 시운전',
                months: 1.5,
              },
            ],
          },
          {
            startMonth: 29,
            sub: '준공',
            steps: [
              {
                name: '준공검사·시설인계',
                months: 1,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'erosion-dam',
    label: '사방댐',
    icon: '⛰️',
    group: 'river',
    desc: '기초굴착 + 본체(콘크리트/전석) + 물받이·계류보전 — 소규모',
    packages: [
      {
        name: '주요 마일스톤',
        rows: [
          {
            startMonth: 0,
            steps: [
              {
                name: '착공',
                months: 0,
                ms: true,
                atMonth: 1,
              },
              {
                name: '물돌리기·기초굴착 완료',
                months: 0,
                ms: true,
                atMonth: 4,
              },
              {
                name: '본체 콘크리트 타설 완료',
                months: 0,
                ms: true,
                atMonth: 8,
              },
              {
                name: '물받이·측벽 완료',
                months: 0,
                ms: true,
                atMonth: 10,
              },
              {
                // 최종 작업(가시설 철거·준공측량·검사)이 361일에 끝나므로 준공은 그 이후로
                // 둔다. 12개월(360일)로는 준공이 검사보다 하루 앞서 찍혀 순서가 뒤집힌다.
                name: '준공',
                months: 0,
                ms: true,
                atMonth: 12.5,
              },
            ],
          },
        ],
      },
      {
        name: '진입로·가설공사',
        rows: [
          {
            startMonth: 1,
            sub: '가설·진입로',
            steps: [
              {
                name: '현장 준비·측량·규준틀',
                months: 0.5,
              },
              {
                name: '진입로 개설·확폭',
                months: 1,
              },
              {
                name: '가설사무소·야적장·안전시설 설치',
                months: 0.5,
              },
            ],
          },
        ],
      },
      {
        name: '가배수·물돌리기공',
        rows: [
          {
            startMonth: 2,
            sub: '가배수·가물막이',
            steps: [
              {
                name: '가배수로(가배수관) 설치',
                months: 0.5,
              },
              {
                name: '물돌리기·가물막이 설치',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '기초굴착공',
        rows: [
          {
            startMonth: 3,
            sub: '터파기·기초',
            steps: [
              {
                name: '터파기·기초굴착',
                months: 1,
              },
              {
                name: '기초지반 정리·지지력 확인·검측',
                months: 0.5,
              },
              {
                name: '버림콘크리트 타설',
                months: 0.5,
              },
            ],
          },
        ],
      },
      {
        name: '본체 콘크리트·전석공',
        rows: [
          {
            startMonth: 5,
            sub: '댐 본체',
            steps: [
              {
                name: '철근가공·조립',
                months: 0.5,
              },
              {
                name: '거푸집 설치',
                months: 0.5,
              },
              {
                name: '본체 콘크리트 분할 타설',
                months: 1.5,
              },
              {
                name: '양생·거푸집 해체',
                months: 1,
              },
            ],
          },
          {
            startMonth: 8,
            sub: '전석·마감',
            steps: [
              {
                name: '전석 붙임·마감쌓기',
                months: 1,
              },
              {
                name: '제각(줄눈)·표면 마무리',
                months: 0.5,
              },
            ],
          },
        ],
      },
      {
        name: '물받이·측벽공',
        rows: [
          {
            startMonth: 8,
            sub: '물받이·앞댐',
            steps: [
              {
                name: '물받이 기초·콘크리트 타설',
                months: 1,
              },
              {
                name: '앞댐(부댐)·물방석 설치',
                months: 0.5,
              },
            ],
          },
          {
            startMonth: 8.5,
            sub: '측벽·날개벽',
            steps: [
              {
                name: '측벽·날개벽 콘크리트 타설',
                months: 1,
              },
              {
                name: '물받이 접합·신축이음 마무리',
                months: 0.5,
              },
            ],
          },
        ],
      },
      {
        name: '계류보전·녹화공',
        rows: [
          {
            startMonth: 10,
            sub: '계류보전',
            steps: [
              {
                name: '가물막이 철거·유로 정리',
                months: 0.5,
              },
              {
                name: '돌붙임·바닥보호공(호안)',
                months: 0.5,
              },
            ],
          },
          {
            startMonth: 10.5,
            sub: '비탈면 녹화',
            steps: [
              {
                name: '비탈면 정리·떼붙임',
                months: 0.5,
              },
              {
                name: '식생·녹화공(파종·식재)',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '부대·정리·준공',
        rows: [
          {
            startMonth: 11.5,
            sub: '마무리·준공',
            steps: [
              {
                name: '부대공(표지판·안전시설)·현장정리',
                months: 0.25,
              },
              {
                name: '가시설 철거·준공측량·검사',
                months: 0.25,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'water-treatment',
    label: '정수장',
    icon: '🚰',
    group: 'water-supply',
    desc: '착수·응집·침전·여과 구조물 + 정수지·배수지 + 기계·전기·계장',
    packages: [
      {
        name: '주요 마일스톤',
        rows: [
          {
            startMonth: 0,
            steps: [
              {
                name: '착공',
                months: 0,
                ms: true,
                atMonth: 1,
              },
              {
                name: '부지조성 완료',
                months: 0,
                ms: true,
                atMonth: 6,
              },
              {
                name: '정수처리 구조물 완료',
                months: 0,
                ms: true,
                atMonth: 22,
              },
              {
                name: '정수지·배수지 완료',
                months: 0,
                ms: true,
                atMonth: 28,
              },
              {
                name: '기전설비 설치 완료',
                months: 0,
                ms: true,
                atMonth: 32,
              },
              {
                name: '준공',
                months: 0,
                ms: true,
                atMonth: 36,
              },
            ],
          },
        ],
      },
      {
        name: '가설·부지조성',
        rows: [
          {
            startMonth: 1,
            steps: [
              {
                name: '가설공사·현장사무소',
                months: 1,
              },
              {
                name: '부지정지·토공(사토·성토)',
                months: 2.5,
              },
              {
                name: '연약지반개량·부지 우수배수',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '취수·도수',
        rows: [
          {
            startMonth: 3,
            sub: '취수시설',
            steps: [
              {
                name: '가물막이·취수구 기초',
                months: 3,
              },
              {
                name: '취수탑·취수펌프장 구조물',
                months: 4,
              },
              {
                name: '취수설비·부대공',
                months: 2,
              },
            ],
          },
          {
            startMonth: 6,
            sub: '도수관로',
            steps: [
              {
                name: '도수관로 터파기·관부설',
                months: 5,
              },
              {
                name: '되메우기·수압시험',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '정수처리 구조물',
        rows: [
          {
            startMonth: 5,
            sub: '착수·혼화·응집',
            steps: [
              {
                name: '착수정·혼화지 흙막이·터파기',
                months: 2,
              },
              {
                name: '착수정·혼화지 철근콘크리트',
                months: 5,
              },
              {
                name: '응집지(플록형성지) 구조물',
                months: 4,
              },
            ],
          },
          {
            startMonth: 9,
            sub: '침전지',
            steps: [
              {
                name: '침전지 흙막이·기초',
                months: 2,
              },
              {
                name: '침전지 철근콘크리트',
                months: 6,
              },
              {
                name: '경사판·슬러지수집기 설치',
                months: 3,
              },
            ],
          },
          {
            startMonth: 13,
            sub: '여과지',
            steps: [
              {
                name: '여과지 흙막이·기초',
                months: 2,
              },
              {
                name: '여과지 철근콘크리트',
                months: 5,
              },
              {
                name: '여재·하부집수장치·역세척설비 설치',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '정수지·배수지·송수',
        rows: [
          {
            startMonth: 18,
            sub: '정수지',
            steps: [
              {
                name: '정수지 흙막이·기초',
                months: 2,
              },
              {
                name: '정수지 철근콘크리트',
                months: 5,
              },
              {
                name: '방수·수밀(누수)시험',
                months: 2,
              },
            ],
          },
          {
            startMonth: 22,
            sub: '배수지·송수',
            steps: [
              {
                name: '배수지 구조물',
                months: 4,
              },
              {
                name: '송수펌프장·부대공',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '슬러지처리시설',
        rows: [
          {
            startMonth: 16,
            steps: [
              {
                name: '농축조·배슬러지지 터파기·기초',
                months: 2,
              },
              {
                name: '농축조·탈수기동 철근콘크리트',
                months: 5,
              },
              {
                name: '탈수설비 설치',
                months: 3,
              },
            ],
          },
        ],
      },
      {
        name: '기계·전기·계장',
        rows: [
          {
            startMonth: 24,
            sub: '기계설비',
            steps: [
              {
                name: '약품주입설비·기계배관',
                months: 4,
              },
              {
                name: '펌프·밸브·수문 설치',
                months: 3,
              },
            ],
          },
          {
            startMonth: 25,
            sub: '전기·계장',
            steps: [
              {
                name: '수배전·동력·자가발전설비',
                months: 4,
              },
              {
                name: '계장·감시제어(SCADA) 구축',
                months: 3,
              },
            ],
          },
        ],
      },
      {
        name: '부대·건축',
        rows: [
          {
            startMonth: 20,
            steps: [
              {
                name: '관리동·약품동·전기동 건축',
                months: 6,
              },
              {
                name: '장내배관·연결관로',
                months: 3,
              },
              {
                name: '조경·구내포장·부대시설',
                months: 3,
              },
            ],
          },
        ],
      },
      {
        name: '시운전·준공',
        rows: [
          {
            startMonth: 32,
            steps: [
              {
                name: '단독·연동 시운전',
                months: 2,
              },
              {
                name: '통수·수질검증(먹는물 수질기준)',
                months: 1.5,
              },
              {
                name: '준공검사·인수인계',
                months: 0.5,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'water-intake',
    label: '취수장·도수관로',
    icon: '🏞️',
    group: 'water-supply',
    desc: '취수시설(취수탑/취수보) + 도수관로 부설 + 시운전',
    packages: [
      {
        name: '주요 마일스톤',
        rows: [
          {
            startMonth: 0,
            steps: [
              {
                name: '착공',
                months: 0,
                ms: true,
                atMonth: 1,
              },
              {
                name: '취수시설 골조 완료',
                months: 0,
                ms: true,
                atMonth: 9,
              },
              {
                name: '도수관로 부설 완료',
                months: 0,
                ms: true,
                atMonth: 17,
              },
              {
                name: '통수시험 개시',
                months: 0,
                ms: true,
                atMonth: 23,
              },
              {
                name: '준공',
                months: 0,
                ms: true,
                atMonth: 24,
              },
            ],
          },
        ],
      },
      {
        name: '착공준비·인허가',
        rows: [
          {
            startMonth: 1,
            sub: '인허가·실시설계',
            steps: [
              {
                name: '실시설계 확정·시공상세도 승인',
                months: 1,
              },
              {
                name: '각종 인허가·점용협의',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '가설공사',
        rows: [
          {
            startMonth: 1,
            sub: '공통가설',
            steps: [
              {
                name: '현장측량·지장물조사',
                months: 1,
              },
              {
                name: '가설사무소·야적장 설치',
                months: 1,
              },
              {
                name: '가설도로·진입로 개설',
                months: 1.5,
              },
            ],
          },
          {
            startMonth: 2,
            sub: '가물막이·배수',
            steps: [
              {
                name: '가물막이(Sheet Pile) 설치',
                months: 2,
              },
              {
                name: '가배수로·배수펌프 가동',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '취수시설(취수탑·취수보)',
        rows: [
          {
            startMonth: 3,
            sub: '취수탑 본체',
            steps: [
              {
                name: '터파기·기초굴착',
                months: 1.5,
              },
              {
                name: '말뚝기초·기초콘크리트',
                months: 1.5,
              },
              {
                name: '취수탑 철근콘크리트 타설',
                months: 3,
              },
              {
                name: '제수문·스크린 설치',
                months: 1.5,
              },
              {
                name: '되메우기·주변정리',
                months: 1,
              },
            ],
          },
          {
            startMonth: 4,
            sub: '취수보·유입수로',
            steps: [
              {
                name: '취수보 기초·물막이',
                months: 1.5,
              },
              {
                name: '취수보 콘크리트 타설',
                months: 2.5,
              },
              {
                name: '유입수로·침사지 축조',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '도수관로 부설(개착)',
        rows: [
          {
            startMonth: 6,
            sub: '개착부설',
            steps: [
              {
                name: '관로측량·지장물 이설',
                months: 1,
              },
              {
                name: '터파기·흙막이',
                months: 2,
              },
              {
                name: '관 기초·모래받침',
                months: 1,
              },
              {
                name: '관(강관·DCIP) 부설·연결',
                months: 3.5,
              },
              {
                name: '수압시험(구간별)',
                months: 1,
              },
              {
                name: '되메우기·다짐',
                months: 1.5,
              },
              {
                name: '포장복구',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '도수관로 부설(추진)',
        rows: [
          {
            startMonth: 8,
            sub: '추진(비개착)',
            steps: [
              {
                name: '발진·도달 수직구 축조',
                months: 2,
              },
              {
                name: '추진설비 설치',
                months: 1,
              },
              {
                name: '관추진(하천·도로 횡단부)',
                months: 3.5,
              },
              {
                name: '수직구 되메우기·구조물 마감',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '밸브실·부대공',
        rows: [
          {
            startMonth: 13,
            sub: '밸브실·접합정',
            steps: [
              {
                name: '밸브실·접합정 터파기·기초',
                months: 1.5,
              },
              {
                name: '밸브실 철근콘크리트',
                months: 2,
              },
              {
                name: '제수밸브·공기밸브 설치',
                months: 1.5,
              },
              {
                name: '이토관·퇴수설비·맨홀 설치',
                months: 1,
              },
            ],
          },
          {
            startMonth: 18,
            sub: '부대공',
            steps: [
              {
                name: '관리도로·부지정리',
                months: 1.5,
              },
              {
                name: '울타리·조경',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '전기·계장공사',
        rows: [
          {
            startMonth: 15,
            sub: '수배전·동력',
            steps: [
              {
                name: '수배전반·동력설비 설치',
                months: 2.5,
              },
              {
                name: '전동밸브·펌프 결선',
                months: 2,
              },
            ],
          },
          {
            startMonth: 17,
            sub: '계장·자동화',
            steps: [
              {
                name: '계측기(수위·유량) 설치',
                months: 2,
              },
              {
                name: 'TM/TC·감시제어(SCADA) 구축',
                months: 2.5,
              },
            ],
          },
        ],
      },
      {
        name: '시운전·준공',
        rows: [
          {
            startMonth: 20.5,
            sub: '세척·시운전·준공',
            steps: [
              {
                name: '관세척·소독(제염)',
                months: 1,
              },
              {
                name: '단독기기 시운전',
                months: 1,
              },
              {
                name: '통수시험·연동 시운전',
                months: 1,
              },
              {
                name: '준공검사·시설인수·정산',
                months: 0.5,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'water-pipe',
    label: '상수관로(송·배수)',
    icon: '🔧',
    group: 'water-supply',
    desc: '관로 부설·접합 + 밸브·소화전 + 수압시험·통수 — 관로 공사',
    packages: [
      {
        name: '주요 마일스톤',
        rows: [
          {
            startMonth: 0,
            steps: [
              {
                name: '착공',
                months: 0,
                ms: true,
                atMonth: 1,
              },
              {
                name: '지장물 이설 완료',
                months: 0,
                ms: true,
                atMonth: 3,
              },
              {
                name: '관 부설 착수',
                months: 0,
                ms: true,
                atMonth: 3,
              },
              {
                name: '관 부설 완료',
                months: 0,
                ms: true,
                atMonth: 11,
              },
              {
                name: '통수 완료',
                months: 0,
                ms: true,
                atMonth: 14,
              },
              {
                name: '준공',
                months: 0,
                ms: true,
                atMonth: 15,
              },
            ],
          },
        ],
      },
      {
        name: '가설·교통처리',
        rows: [
          {
            startMonth: 1,
            sub: '가설공사',
            steps: [
              {
                name: '현장사무소·가설울타리 설치',
                months: 0.5,
              },
              {
                name: '기준점 측량·현황 측량',
                months: 0.5,
              },
            ],
          },
          {
            startMonth: 1,
            sub: '교통처리',
            steps: [
              {
                name: '교통처리계획 심의·안전시설 설치',
                months: 0.5,
              },
              {
                name: '교통통제·신호수 운영',
                months: 11.5,
              },
            ],
          },
        ],
      },
      {
        name: '지장물 조사·이설',
        rows: [
          {
            startMonth: 1,
            steps: [
              {
                name: '지장물 조사·시험굴 굴착',
                months: 0.5,
              },
              {
                name: '지장물 이설 협의·이설 시행',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '관로 터파기',
        rows: [
          {
            startMonth: 2.5,
            steps: [
              {
                name: '포장 절단·표층 걷어내기',
                months: 0.5,
              },
              {
                name: '흙막이 설치',
                months: 1,
              },
              {
                name: '굴착(터파기)',
                months: 5.5,
              },
              {
                name: '관 기초(모래·잡석) 포설',
                months: 0.5,
              },
            ],
          },
        ],
      },
      {
        name: '관 부설·접합',
        rows: [
          {
            startMonth: 3,
            sub: '본관 부설',
            steps: [
              {
                name: '관 운반·내리기',
                months: 0.5,
              },
              {
                name: '관 부설·접합(용접·이형관)',
                months: 7,
              },
              {
                name: '관 방식·이음부 피복',
                months: 0.5,
              },
            ],
          },
        ],
      },
      {
        name: '밸브·소화전·부대공',
        rows: [
          {
            startMonth: 5,
            steps: [
              {
                name: '제수밸브·공기밸브실 시공',
                months: 3,
              },
              {
                name: '이토밸브·소화전 설치',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '되메우기·포장복구',
        rows: [
          {
            startMonth: 5,
            sub: '되메우기',
            steps: [
              {
                name: '되메우기·층별 다짐',
                months: 7,
              },
              {
                name: '흙막이 해체',
                months: 0.5,
              },
            ],
          },
          {
            startMonth: 8,
            sub: '포장복구',
            steps: [
              {
                name: '보조기층·기층 포설',
                months: 3,
              },
              {
                name: '표층 포장·노면표시 복구',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '수압시험·통수',
        rows: [
          {
            startMonth: 11,
            steps: [
              {
                name: '수압시험·누수 확인',
                months: 1.5,
              },
              {
                name: '관 세척·소독',
                months: 1,
              },
              {
                name: '통수·수질검사',
                months: 0.5,
              },
            ],
          },
        ],
      },
      {
        name: '준공',
        rows: [
          {
            startMonth: 14,
            steps: [
              {
                name: '현장정리·가설물 철거',
                months: 0.5,
              },
              {
                name: '준공측량·준공도서 작성',
                months: 0.5,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'sewage-treatment',
    label: '하수처리장',
    icon: '♻️',
    group: 'sewer',
    desc: '전처리·생물반응조·2차침전·소독 + 슬러지 처리 + 시운전',
    packages: [
      {
        name: '주요 마일스톤',
        rows: [
          {
            startMonth: 0,
            steps: [
              {
                name: '착공',
                months: 0,
                ms: true,
                atMonth: 1,
              },
              {
                name: '부지조성 완료',
                months: 0,
                ms: true,
                atMonth: 6,
              },
              {
                name: '생물반응조 구체 완료',
                months: 0,
                ms: true,
                atMonth: 20,
              },
              {
                name: '토목·건축 구조물 완료',
                months: 0,
                ms: true,
                atMonth: 28,
              },
              {
                name: '기전설비 설치 완료',
                months: 0,
                ms: true,
                atMonth: 34,
              },
              {
                name: '통수 및 시운전 개시',
                months: 0,
                ms: true,
                atMonth: 35,
              },
              {
                name: '준공',
                months: 0,
                ms: true,
                atMonth: 40,
              },
            ],
          },
        ],
      },
      {
        name: '가설·부지조성',
        rows: [
          {
            startMonth: 1,
            sub: '가설공사',
            steps: [
              {
                name: '가설사무소·가설도로',
                months: 1,
              },
              {
                name: '가설울타리·안전시설',
                months: 1,
              },
              {
                name: '흙막이·차수 가시설',
                months: 2,
              },
            ],
          },
          {
            startMonth: 1,
            sub: '부지조성',
            steps: [
              {
                name: '벌개제근·표토제거',
                months: 1,
              },
              {
                name: '부지 절·성토',
                months: 2.5,
              },
              {
                name: '우수배제·부지정지',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '유입·전처리',
        rows: [
          {
            startMonth: 6,
            sub: '유입시설',
            steps: [
              {
                name: '유입관거·터파기',
                months: 2,
              },
              {
                name: '유입펌프장 구체공',
                months: 4,
              },
              {
                name: '유량조정조 구체공',
                months: 3.5,
              },
            ],
          },
          {
            startMonth: 7,
            sub: '전처리',
            steps: [
              {
                name: '침사지·스크린조 터파기',
                months: 1.5,
              },
              {
                name: '침사지·스크린조 구체공',
                months: 4,
              },
              {
                name: '전처리 상부슬래브·마감',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '생물반응조·2차침전',
        rows: [
          {
            startMonth: 8,
            sub: '생물반응조',
            steps: [
              {
                name: '굴착·기초말뚝(PHC)',
                months: 2.5,
              },
              {
                name: '기초매트 콘크리트',
                months: 1.5,
              },
              {
                name: '반응조 벽체·격벽 구체공',
                months: 6,
              },
              {
                name: '수밀시험·방수',
                months: 2,
              },
            ],
          },
          {
            startMonth: 14,
            sub: '2차침전지',
            steps: [
              {
                name: '침전지 굴착·기초',
                months: 2,
              },
              {
                name: '침전지 구체공',
                months: 5,
              },
              {
                name: '월류웨어·수밀시험',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '3차처리·소독·방류',
        rows: [
          {
            startMonth: 20,
            sub: '고도처리(총인)',
            steps: [
              {
                name: '총인처리시설 굴착·기초',
                months: 1.5,
              },
              {
                name: '총인처리조 구체공',
                months: 4,
              },
              {
                name: '여과설비 설치',
                months: 2,
              },
            ],
          },
          {
            startMonth: 24,
            sub: '소독·방류',
            steps: [
              {
                name: '소독접촉조 구체공',
                months: 4,
              },
              {
                name: '방류관거·방류구',
                months: 3,
              },
              {
                name: '방류수 수질TMS 설치',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '슬러지 처리',
        rows: [
          {
            startMonth: 16,
            sub: '농축·저류',
            steps: [
              {
                name: '농축조 굴착·기초',
                months: 2,
              },
              {
                name: '농축조·저류조 구체공',
                months: 5,
              },
            ],
          },
          {
            startMonth: 22,
            sub: '탈수·소화',
            steps: [
              {
                name: '탈수기동 기초·구체공',
                months: 4,
              },
              {
                name: '소화조 구체공',
                months: 5,
              },
              {
                name: '탈수설비·이송설비 설치',
                months: 3,
              },
            ],
          },
        ],
      },
      {
        name: '건축·부대설비',
        rows: [
          {
            startMonth: 24,
            sub: '건축',
            steps: [
              {
                name: '관리동·송풍기동 골조',
                months: 4,
              },
              {
                name: '건축 마감·창호',
                months: 3,
              },
            ],
          },
          {
            startMonth: 31,
            sub: '부대·조경',
            steps: [
              {
                name: '탈취설비·부대설비',
                months: 2,
              },
              {
                name: '구내포장·우오수관거',
                months: 2,
              },
              {
                name: '조경·경계석',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '기계·전기·계장',
        rows: [
          {
            startMonth: 25,
            sub: '기계설비',
            steps: [
              {
                name: '송풍기·산기장치 설치',
                months: 3,
              },
              {
                name: '펌프·배관·수문 설치',
                months: 3,
              },
              {
                name: '기계 단독시운전',
                months: 1.5,
              },
            ],
          },
          {
            startMonth: 26,
            sub: '전기·계장',
            steps: [
              {
                name: '수배전반·동력설비',
                months: 3,
              },
              {
                name: '계장·감시제어(SCADA)',
                months: 3,
              },
              {
                name: '루프체크·단위시험',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '시운전·준공',
        rows: [
          {
            startMonth: 35,
            steps: [
              {
                name: '통수·클린업',
                months: 1,
              },
              {
                name: '무부하 시운전',
                months: 1,
              },
              {
                name: '부하 시운전·수질검증',
                months: 2,
              },
              {
                name: '준공검사·인수인계',
                months: 1,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'sewer-pipe',
    label: '하수관로(차집관거)',
    icon: '🕳️',
    group: 'sewer',
    desc: '관거 부설(개착/추진) + 맨홀·연결 + 통수시험',
    packages: [
      {
        name: '주요 마일스톤',
        rows: [
          {
            startMonth: 0,
            steps: [
              {
                name: '착공',
                months: 0,
                ms: true,
                atMonth: 1,
              },
              {
                name: '흙막이 가시설 완료',
                months: 0,
                ms: true,
                atMonth: 6,
              },
              {
                name: '개착 관부설 완료',
                months: 0,
                ms: true,
                atMonth: 11,
              },
              {
                name: '추진공법 관통',
                months: 0,
                ms: true,
                atMonth: 12,
              },
              {
                name: '되메우기·포장 완료',
                months: 0,
                ms: true,
                atMonth: 16,
              },
              {
                name: '통수시험 완료',
                months: 0,
                ms: true,
                atMonth: 17,
              },
              {
                name: '준공',
                months: 0,
                ms: true,
                atMonth: 18,
              },
            ],
          },
        ],
      },
      {
        name: '가설·교통처리',
        rows: [
          {
            startMonth: 1,
            sub: '공사준비·가설',
            steps: [
              {
                name: '현장측량·지장물조사',
                months: 1,
              },
              {
                name: '가설사무소·부지정리',
                months: 1,
              },
              {
                name: '가설울타리·안전시설 설치',
                months: 1,
              },
            ],
          },
          {
            startMonth: 1,
            sub: '교통처리',
            steps: [
              {
                name: '교통처리계획 인가',
                months: 1,
              },
              {
                name: '차선통제·복공판 설치',
                months: 1.5,
              },
              {
                name: '교통유지관리 운영',
                months: 13,
              },
            ],
          },
        ],
      },
      {
        name: '물돌리기(가배수)',
        rows: [
          {
            startMonth: 1,
            sub: '가배수·가물막이',
            steps: [
              {
                name: '기존 하수 흐름조사·계획',
                months: 1,
              },
              {
                name: '가물막이·가배수관 설치',
                months: 1.5,
              },
              {
                name: '물돌리기(임시 펌핑) 운영',
                months: 13,
              },
            ],
          },
        ],
      },
      {
        name: '터파기·흙막이',
        rows: [
          {
            startMonth: 2,
            sub: '흙막이 가시설',
            steps: [
              {
                name: 'H-Pile·토류판 시공',
                months: 2,
              },
              {
                name: '버팀보·띠장 설치',
                months: 1.5,
              },
              {
                name: '지하수위 저하공(웰포인트)',
                months: 1,
              },
            ],
          },
          {
            startMonth: 3.5,
            sub: '터파기',
            steps: [
              {
                name: '관로 터파기(개착)',
                months: 4,
              },
              {
                name: '기초잡석·버림콘크리트',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '관부설(개착)',
        rows: [
          {
            startMonth: 6,
            sub: '개착 관부설',
            steps: [
              {
                name: '관기초·받침 시공',
                months: 1.5,
              },
              {
                name: '흄관·PE관 부설·접합',
                months: 3,
              },
              {
                name: '관 수밀시험(구간)',
                months: 0.5,
              },
            ],
          },
        ],
      },
      {
        name: '추진공법',
        rows: [
          {
            startMonth: 5,
            sub: '비개착 추진',
            steps: [
              {
                name: '발진·도달구 수직구 시공',
                months: 2.5,
              },
              {
                name: '추진설비 설치·시험추진',
                months: 1,
              },
              {
                name: '세미실드 관추진',
                months: 3,
              },
              {
                name: '수직구 되메우기·복구',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '맨홀·연결',
        rows: [
          {
            startMonth: 7,
            sub: '맨홀공',
            steps: [
              {
                name: '맨홀 기초·조립식 맨홀 설치',
                months: 2.5,
              },
              {
                name: '인버트·연결관 시공',
                months: 1.5,
              },
            ],
          },
          {
            startMonth: 11,
            sub: '관연결',
            steps: [
              {
                name: '기존관로 연결(활선)',
                months: 2,
              },
              {
                name: '우수·오수 분리연결',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '되메우기·포장',
        rows: [
          {
            startMonth: 11,
            sub: '되메우기',
            steps: [
              {
                name: '양질토 되메우기·다짐',
                months: 2.5,
              },
              {
                name: '가시설 철거',
                months: 1.5,
              },
            ],
          },
          {
            startMonth: 14,
            sub: '포장복구',
            steps: [
              {
                name: '보조기층·기층 포설',
                months: 1,
              },
              {
                name: '아스팔트 표층포장·노면표시',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '통수시험·준공',
        rows: [
          {
            startMonth: 15.5,
            sub: '시험·검사',
            steps: [
              {
                name: 'CCTV 관로검사',
                months: 0.5,
              },
              {
                name: '수밀·통수시험',
                months: 1,
              },
              {
                name: '준공검사·정산',
                months: 1,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'breakwater',
    label: '방파제',
    icon: '🌊',
    group: 'port',
    desc: '기초 사석 + 케이슨 제작·거치 + 상치 + 소파블록(T.T.P)',
    packages: [
      {
        name: '주요 마일스톤',
        rows: [
          {
            startMonth: 0,
            steps: [
              {
                name: '착공',
                months: 0,
                ms: true,
                atMonth: 1,
              },
              {
                name: '기초사석 투하 착수',
                months: 0,
                ms: true,
                atMonth: 8,
              },
              {
                name: '케이슨 거치 완료',
                months: 0,
                ms: true,
                atMonth: 30,
              },
              {
                name: '상치콘크리트 완료',
                months: 0,
                ms: true,
                atMonth: 37,
              },
              {
                name: 'T.T.P 거치 완료',
                months: 0,
                ms: true,
                atMonth: 41,
              },
              {
                name: '준공',
                months: 0,
                ms: true,
                atMonth: 42,
              },
            ],
          },
        ],
      },
      {
        name: '가설공 및 사석 채취',
        rows: [
          {
            startMonth: 1,
            sub: '가설공사',
            steps: [
              {
                name: '가설도로·가물막이',
                months: 2,
              },
              {
                name: '가설선착장·야적장 조성',
                months: 2,
              },
            ],
          },
          {
            startMonth: 2,
            sub: '사석 채취·운반',
            steps: [
              {
                name: '석산 개발·사석 채취',
                months: 4,
              },
              {
                name: '사석 운반·비축',
                months: 8,
              },
            ],
          },
        ],
      },
      {
        name: '준설 및 기초굴착',
        rows: [
          {
            startMonth: 4,
            sub: '준설공',
            steps: [
              {
                name: '장비 조립·측량',
                months: 1,
              },
              {
                name: '준설·기초굴착',
                months: 3,
              },
            ],
          },
        ],
      },
      {
        name: '기초 사석공',
        rows: [
          {
            startMonth: 6,
            sub: '기초 사석 투하',
            steps: [
              {
                name: '연약지반 처리',
                months: 2,
              },
              {
                name: '기초사석 투하',
                months: 6,
              },
              {
                name: '사석 본고르기(수중)',
                months: 4,
              },
            ],
          },
        ],
      },
      {
        name: '케이슨 제작',
        rows: [
          {
            startMonth: 5,
            sub: '제작장·F.D 준비',
            steps: [
              {
                name: '제작장 정비·거푸집 준비',
                months: 3,
              },
            ],
          },
          {
            startMonth: 8,
            sub: '케이슨 제작',
            steps: [
              {
                name: '철근조립·콘크리트 타설',
                months: 10,
              },
              {
                name: '양생·진수 대기',
                months: 3,
              },
            ],
          },
        ],
      },
      {
        name: '케이슨 거치',
        rows: [
          {
            startMonth: 21,
            sub: '진수·예항·거치',
            steps: [
              {
                name: '케이슨 진수·예항',
                months: 3,
              },
              {
                name: '케이슨 거치·설치',
                months: 6,
              },
            ],
          },
        ],
      },
      {
        name: '속채움 및 상치콘크리트',
        rows: [
          {
            startMonth: 30,
            sub: '속채움공',
            steps: [
              {
                name: '케이슨 속채움(사석·모래)',
                months: 4,
              },
              {
                name: '뚜껑콘크리트 타설',
                months: 1,
              },
            ],
          },
          {
            startMonth: 35,
            sub: '상치콘크리트공',
            steps: [
              {
                name: '상치콘크리트 타설·양생',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '소파블록(T.T.P) 공',
        rows: [
          {
            startMonth: 22,
            sub: 'T.T.P 제작',
            steps: [
              {
                name: 'T.T.P 제작·양생',
                months: 12,
              },
            ],
          },
          {
            startMonth: 37,
            sub: 'T.T.P 거치',
            steps: [
              {
                name: '소파블록 거치',
                months: 4,
              },
            ],
          },
        ],
      },
      {
        name: '부대공 및 준공',
        rows: [
          {
            startMonth: 39,
            sub: '부대시설',
            steps: [
              {
                name: '항로표지·부대시설 설치',
                months: 2,
              },
            ],
          },
          {
            startMonth: 41,
            sub: '정리·준공',
            steps: [
              {
                name: '가시설 철거·현장정리',
                months: 0.5,
              },
              {
                name: '준공검사·정산',
                months: 0.5,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'quay',
    label: '안벽·부두',
    icon: '⚓',
    group: 'port',
    desc: '케이슨/잔교식 안벽 + 뒤채움·에이프런 + 계선·하역설비',
    packages: [
      {
        name: '주요 마일스톤',
        rows: [
          {
            startMonth: 0,
            steps: [
              {
                name: '착공',
                months: 0,
                ms: true,
                atMonth: 1,
              },
              {
                name: '준설·기초 준설 완료',
                months: 0,
                ms: true,
                atMonth: 6,
              },
              {
                name: '기초 사석 마운드 완료',
                months: 0,
                ms: true,
                atMonth: 11,
              },
              {
                name: '케이슨 거치 완료',
                months: 0,
                ms: true,
                atMonth: 21,
              },
              {
                name: '상치콘크리트 완료',
                months: 0,
                ms: true,
                atMonth: 28,
              },
              {
                name: '에이프런 포장 완료',
                months: 0,
                ms: true,
                atMonth: 34,
              },
              {
                name: '준공',
                months: 0,
                ms: true,
                atMonth: 36,
              },
            ],
          },
        ],
      },
      {
        name: '가설·준설',
        rows: [
          {
            startMonth: 1,
            sub: '가설공사',
            steps: [
              {
                name: '실시설계·인허가·측량',
                months: 1.5,
              },
              {
                name: '공사용 가설도로·야적장 조성',
                months: 2,
              },
              {
                name: '가설잔교·계측기 설치',
                months: 1.5,
              },
            ],
          },
          {
            startMonth: 2,
            sub: '준설·굴착',
            steps: [
              {
                name: '지장물 제거·기준측량',
                months: 1,
              },
              {
                name: '기초 준설(그래브·펌프 준설)',
                months: 3,
              },
              {
                name: '준설토 운반·투기(투기장 관리)',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '연약지반 개량',
        rows: [
          {
            startMonth: 5,
            sub: '지반개량',
            steps: [
              {
                name: '연약지반 치환(모래·자갈)',
                months: 2,
              },
              {
                name: '치환부 다짐·확인측량',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '기초 사석',
        rows: [
          {
            startMonth: 7,
            sub: '사석 기초',
            steps: [
              {
                name: '사석 투하·기초 마운드 축조',
                months: 2.5,
              },
              {
                name: '사석 본고르기(수중 고르기)',
                months: 1.5,
              },
            ],
          },
          {
            startMonth: 11,
            sub: '피복·근고',
            steps: [
              {
                name: '피복석·소파블록 거치',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '케이슨 제작·거치',
        rows: [
          {
            startMonth: 5,
            sub: '케이슨 제작',
            steps: [
              {
                name: '제작장(F.D/육상) 준비',
                months: 1.5,
              },
              {
                name: '철근조립·거푸집·콘크리트 타설(연속제작)',
                months: 8,
              },
              {
                name: '양생·진수·계류',
                months: 2,
              },
            ],
          },
          {
            startMonth: 17,
            sub: '케이슨 거치',
            steps: [
              {
                name: '예인·부상 운반',
                months: 1,
              },
              {
                name: '케이슨 거치(주입·고르기)',
                months: 3,
              },
            ],
          },
        ],
      },
      {
        name: '속채움·상치',
        rows: [
          {
            startMonth: 21,
            sub: '속채움',
            steps: [
              {
                name: '케이슨 속채움(사석·모래)',
                months: 2.5,
              },
              {
                name: '저판 뒤채움사석·근고블록',
                months: 1.5,
              },
            ],
          },
          {
            startMonth: 25,
            sub: '상치콘크리트',
            steps: [
              {
                name: '상치콘크리트 거푸집·철근',
                months: 1.5,
              },
              {
                name: '상치콘크리트 타설·양생',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '뒤채움·에이프런 포장',
        rows: [
          {
            startMonth: 25,
            sub: '뒤채움',
            steps: [
              {
                name: '뒤채움 사석·토사 포설·다짐',
                months: 3,
              },
              {
                name: '배수공·필터층·집수정 설치',
                months: 1.5,
              },
            ],
          },
          {
            startMonth: 30,
            sub: '에이프런 포장',
            steps: [
              {
                name: '노반·보조기층 포설·다짐',
                months: 2,
              },
              {
                name: '에이프런 콘크리트 포장',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '계선·하역설비',
        rows: [
          {
            startMonth: 28,
            sub: '계선설비',
            steps: [
              {
                name: '방충재(펜더)·계선주(볼라드) 설치',
                months: 2,
              },
              {
                name: '안전난간·간이시설 설치',
                months: 1.5,
              },
            ],
          },
          {
            startMonth: 31,
            sub: '부대·하역설비',
            steps: [
              {
                name: '전기·급수·조명 설비',
                months: 2,
              },
              {
                name: '하역장비 레일·안전시설 설치',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '준공',
        rows: [
          {
            startMonth: 34,
            steps: [
              {
                name: '부지정리·마무리',
                months: 1,
              },
              {
                name: '시운전·부하시험·준공검사',
                months: 1,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'dredging',
    label: '준설·매립',
    icon: '🚢',
    group: 'port',
    desc: '호안 축조 + 준설 + 매립·투기 + 지반개량',
    packages: [
      {
        name: '주요 마일스톤',
        rows: [
          {
            startMonth: 1,
            steps: [
              {
                name: '착공',
                months: 0,
                ms: true,
                atMonth: 1,
              },
              {
                name: '호안 축조 완료',
                months: 0,
                ms: true,
                atMonth: 12,
              },
              {
                name: '준설 완료',
                months: 0,
                ms: true,
                atMonth: 16,
              },
              {
                name: '매립·성토 완료',
                months: 0,
                ms: true,
                atMonth: 18,
              },
              {
                name: '준공',
                months: 0,
                ms: true,
                atMonth: 24,
              },
            ],
          },
        ],
      },
      {
        name: '가설·측량',
        rows: [
          {
            startMonth: 1,
            sub: '측량·지반조사·가설공',
            steps: [
              {
                name: '기준점측량·현황측량·지반조사',
                months: 1.5,
              },
              {
                name: '가설도로·가배수·가시설 설치',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '환경보전공',
        rows: [
          {
            startMonth: 3,
            sub: '오탁방지시설',
            steps: [
              {
                name: '오탁방지막 설치',
                months: 1.5,
              },
              {
                name: '오탁방지막 유지관리·철거',
                months: 12,
              },
            ],
          },
        ],
      },
      {
        name: '호안 축조',
        rows: [
          {
            startMonth: 3,
            sub: '호안 본체',
            steps: [
              {
                name: '기초사석 투하·고르기',
                months: 3,
              },
              {
                name: '케이슨 제작·거치·속채움',
                months: 4,
              },
              {
                name: '피복블록 거치·상치콘크리트 타설',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '준설',
        rows: [
          {
            startMonth: 5,
            sub: '펌프준설',
            steps: [
              {
                name: '준설선 배치·시운전',
                months: 1,
              },
              {
                name: '펌프준설·이송관 배송·투기',
                months: 8,
              },
            ],
          },
          {
            startMonth: 8,
            sub: '그랩준설',
            steps: [
              {
                name: '그랩준설·토운선 운반·투기',
                months: 8,
              },
            ],
          },
        ],
      },
      {
        name: '매립·투기',
        rows: [
          {
            startMonth: 7,
            sub: '매립·투기공',
            steps: [
              {
                name: '준설토 투기·매립·여수토 관리',
                months: 9,
              },
              {
                name: '여성토·정지',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '지반개량·복토',
        rows: [
          {
            startMonth: 18,
            sub: '연약지반개량',
            steps: [
              {
                name: '연직배수공(PBD)·SCP 개량',
                months: 2.5,
              },
              {
                name: '재하성토·방치(선행재하)',
                months: 2,
              },
              {
                name: '제하·복토·성토 다짐',
                months: 1,
              },
            ],
          },
          {
            startMonth: 18,
            sub: '계측관리',
            steps: [
              {
                name: '계측기 설치·침하/간극수압 계측관리',
                months: 5.5,
              },
            ],
          },
        ],
      },
      {
        name: '부대공',
        rows: [
          {
            startMonth: 20,
            sub: '부대시설공',
            steps: [
              {
                name: '우수·배수공',
                months: 2,
              },
              {
                name: '포장·부대시설 설치',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '준공',
        rows: [
          {
            startMonth: 22,
            sub: '준공처리',
            steps: [
              {
                name: '준공측량·정리·마무리',
                months: 1,
              },
              {
                name: '준공검사·인계',
                months: 1,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'rail-roadbed',
    label: '철도 노반',
    icon: '🚄',
    group: 'rail',
    desc: '토공 + 구조물(교량·통로박스) + 강화노반 + 배수공',
    packages: [
      {
        name: '주요 마일스톤',
        rows: [
          {
            startMonth: 0,
            steps: [
              {
                name: '착공',
                months: 0,
                ms: true,
                atMonth: 1,
              },
              {
                name: '토공 완료',
                months: 0,
                ms: true,
                atMonth: 15,
              },
              {
                name: '구조물 완료',
                months: 0,
                ms: true,
                atMonth: 22,
              },
              {
                name: '강화노반 완료',
                months: 0,
                ms: true,
                atMonth: 31,
              },
              {
                name: '궤도 인수인계',
                months: 0,
                ms: true,
                atMonth: 34,
              },
              {
                name: '준공',
                months: 0,
                ms: true,
                atMonth: 36,
              },
            ],
          },
        ],
      },
      {
        name: '가설·준비공',
        rows: [
          {
            startMonth: 1,
            sub: '공사준비',
            steps: [
              {
                name: '착공준비·기준점측량',
                months: 2,
              },
              {
                name: '가설사무소·가시설 설치',
                months: 2,
              },
              {
                name: '지장물 이설·용지정리',
                months: 3,
              },
            ],
          },
          {
            startMonth: 33,
            sub: '가설철거',
            steps: [
              {
                name: '가시설 철거·현장정리',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '환경·안전관리',
        rows: [
          {
            startMonth: 2,
            sub: '환경관리',
            steps: [
              {
                name: '오탁방지·비산먼지 가설',
                months: 2,
              },
              {
                name: '환경·교통·안전관리(상시)',
                months: 30,
              },
            ],
          },
        ],
      },
      {
        name: '토공',
        rows: [
          {
            startMonth: 2,
            sub: '본선토공',
            steps: [
              {
                name: '벌개제근·표토제거',
                months: 2,
              },
              {
                name: '땅깎기(절토)',
                months: 6,
              },
              {
                name: '흙쌓기(성토)·다짐',
                months: 5,
              },
            ],
          },
          {
            startMonth: 3,
            sub: '연약지반',
            steps: [
              {
                name: '연약지반 개량(PBD·치환 등)',
                months: 5,
              },
              {
                name: '계측관리·잔류침하 관리',
                months: 6,
              },
            ],
          },
          {
            startMonth: 10,
            sub: '사면보호',
            steps: [
              {
                name: '비탈면 정형·다짐',
                months: 2,
              },
              {
                name: '사면보호공(식생·뿜어붙이기)',
                months: 3,
              },
            ],
          },
        ],
      },
      {
        name: '구조물공',
        rows: [
          {
            startMonth: 6,
            sub: '교량',
            steps: [
              {
                name: '기초말뚝·우물통',
                months: 3,
              },
              {
                name: '교대·교각(하부공)',
                months: 5,
              },
              {
                name: '거더 제작·가설(상부공)',
                months: 5,
              },
              {
                name: '교면·부속설비',
                months: 3,
              },
            ],
          },
          {
            startMonth: 8,
            sub: '통로박스',
            steps: [
              {
                name: '터파기·기초',
                months: 2,
              },
              {
                name: '박스 철근·콘크리트',
                months: 4,
              },
              {
                name: '되메우기·뒤채움',
                months: 2,
              },
            ],
          },
          {
            startMonth: 7,
            sub: '옹벽',
            steps: [
              {
                name: '기초·옹벽 타설',
                months: 5,
              },
              {
                name: '뒤채움·배수',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '배수공',
        rows: [
          {
            startMonth: 9,
            sub: '횡배수',
            steps: [
              {
                name: '횡배수관·암거',
                months: 3,
              },
              {
                name: '집수정·유공관',
                months: 2,
              },
            ],
          },
          {
            startMonth: 15,
            sub: '노반배수',
            steps: [
              {
                name: '측구·L형측구 설치',
                months: 3,
              },
              {
                name: '성토사면 배수공·맹암거',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '강화노반공',
        rows: [
          {
            startMonth: 20,
            sub: '노반형성',
            steps: [
              {
                name: '노체 마무리 흙쌓기',
                months: 2,
              },
              {
                name: '상부노반(입도조정층)',
                months: 4,
              },
              {
                name: '강화노반 포설·다짐',
                months: 4,
              },
              {
                name: '평판재하시험·검측',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '부대공',
        rows: [
          {
            startMonth: 24,
            sub: '부대시설',
            steps: [
              {
                name: '울타리·방음벽 기초',
                months: 3,
              },
              {
                name: '관리용통로·전주기초',
                months: 3,
              },
              {
                name: '표지·안전설비',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '궤도 인수인계',
        rows: [
          {
            startMonth: 31,
            sub: '인계준비',
            steps: [
              {
                name: '노반 준공검측·측량성과 정리',
                months: 2,
              },
              {
                name: '궤도부설 부지 인계',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '준공',
        rows: [
          {
            startMonth: 34,
            sub: '준공정산',
            steps: [
              {
                name: '준공도서·정산',
                months: 1,
              },
              {
                name: '준공검사·인수',
                months: 1,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'rail-track',
    label: '궤도부설',
    icon: '🛤️',
    group: 'rail',
    desc: '도상(자갈/콘크리트궤도) + 레일 부설·용접 + 분기기 + 정정',
    packages: [
      {
        name: '주요 마일스톤',
        rows: [
          {
            startMonth: 0,
            steps: [
              {
                name: '착공',
                months: 0,
                ms: true,
                atMonth: 1,
              },
              {
                name: '도상공 착수',
                months: 0,
                ms: true,
                atMonth: 4,
              },
              {
                name: '레일 부설·용접 완료',
                months: 0,
                ms: true,
                atMonth: 16,
              },
              {
                name: '궤도 안정화 완료',
                months: 0,
                ms: true,
                atMonth: 21,
              },
              {
                name: '준공',
                months: 0,
                ms: true,
                atMonth: 24,
              },
            ],
          },
        ],
      },
      {
        name: '가설 및 자재반입',
        rows: [
          {
            startMonth: 1,
            sub: '현장 가설',
            steps: [
              {
                name: '현장사무소·가설시설 설치',
                months: 1.5,
              },
              {
                name: '궤도부설기지·용접기지 조성',
                months: 2,
              },
              {
                name: '가설 철거·현장 정리',
                months: 1,
              },
            ],
          },
          {
            startMonth: 2,
            sub: '자재반입·야적',
            steps: [
              {
                name: '레일·침목·분기기 반입 및 야적',
                months: 4,
              },
              {
                name: '도상자갈·체결구·부속품 반입',
                months: 3,
              },
            ],
          },
        ],
      },
      {
        name: '노반 인수 및 시공측량',
        rows: [
          {
            startMonth: 2,
            steps: [
              {
                name: '노반 인수·검측(하자 확인)',
                months: 1.5,
              },
              {
                name: '기준점·중심선 시공측량',
                months: 1,
              },
              {
                name: '배수공·측구 정리',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '도상공',
        rows: [
          {
            startMonth: 4,
            sub: '자갈도상 구간',
            steps: [
              {
                name: '노반 정정·검측',
                months: 1,
              },
              {
                name: '하부도상 포설·정정',
                months: 2.5,
              },
              {
                name: '상부도상 살포',
                months: 2,
              },
            ],
          },
          {
            startMonth: 5,
            sub: '콘크리트궤도(TCL) 구간',
            steps: [
              {
                name: 'HSB(강화노반) 타설·양생',
                months: 2.5,
              },
              {
                name: '콘크리트도상 TCL 타설',
                months: 4,
              },
              {
                name: '양생 및 검측',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '레일 부설 및 용접',
        rows: [
          {
            startMonth: 7,
            sub: '레일 부설',
            steps: [
              {
                name: '침목 부설·간격 조정',
                months: 2,
              },
              {
                name: '레일 긴척 부설',
                months: 3,
              },
              {
                name: '체결장치 체결·조정',
                months: 2,
              },
            ],
          },
          {
            startMonth: 14,
            sub: '레일 용접·설정',
            steps: [
              {
                name: '테르밋(가스압접) 용접',
                months: 1.5,
              },
              {
                name: '장대레일 설정·재설정',
                months: 0.5,
              },
            ],
          },
        ],
      },
      {
        name: '분기기 부설',
        rows: [
          {
            startMonth: 13,
            steps: [
              {
                name: '분기기 조립·반입',
                months: 1,
              },
              {
                name: '분기기 부설·정정',
                months: 1.5,
              },
              {
                name: '전철기·부속설비 설치',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '궤도 정정 및 안정화',
        rows: [
          {
            startMonth: 16.5,
            sub: '궤도 정정',
            steps: [
              {
                name: 'MTT 다짐·면맞춤',
                months: 2,
              },
              {
                name: '궤도 틀림 정정',
                months: 1.5,
              },
            ],
          },
          {
            startMonth: 20,
            sub: '동적안정화',
            steps: [
              {
                name: 'DTS 동적안정화',
                months: 1,
              },
              {
                name: '궤도 검측·규격 확인',
                months: 0.5,
              },
            ],
          },
        ],
      },
      {
        name: '부대공',
        rows: [
          {
            startMonth: 17,
            steps: [
              {
                name: '신축이음매·완충구간 설치',
                months: 1.5,
              },
              {
                name: '선로표지·거리표·건널목 설비',
                months: 1.5,
              },
              {
                name: '궤도 부속설비 마무리',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '시운전 및 준공',
        rows: [
          {
            startMonth: 21,
            steps: [
              {
                name: '궤도검측차 검측',
                months: 1,
              },
              {
                name: '시운전(주행시험)',
                months: 1.5,
              },
              {
                name: '준공검사·인수인계',
                months: 0.5,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'subway',
    label: '도시철도(개착)',
    icon: '🚇',
    group: 'rail',
    desc: '흙막이·복공 + 굴착 + 정거장·본선 구조물 + 궤도·건축·설비',
    packages: [
      {
        name: '주요 마일스톤',
        rows: [
          {
            startMonth: 1,
            steps: [
              {
                name: '착공',
                months: 0,
                ms: true,
                atMonth: 1,
              },
              {
                name: '흙막이 착수',
                months: 0,
                ms: true,
                atMonth: 4,
              },
              {
                name: '굴착 완료',
                months: 0,
                ms: true,
                atMonth: 20,
              },
              {
                name: '구조물 완료',
                months: 0,
                ms: true,
                atMonth: 31,
              },
              {
                name: '되메우기·노면복구 완료',
                months: 0,
                ms: true,
                atMonth: 40,
              },
              {
                name: '준공',
                months: 0,
                ms: true,
                atMonth: 48,
              },
            ],
          },
        ],
      },
      {
        name: '가설·지장물 이설',
        rows: [
          {
            startMonth: 1,
            sub: '공사준비',
            steps: [
              {
                name: '공사착수·현황측량',
                months: 1.5,
              },
              {
                name: '가설울타리·현장가설',
                months: 1.5,
              },
              {
                name: '지장물 조사·협의',
                months: 2,
              },
            ],
          },
          {
            startMonth: 2,
            sub: '지하매설물 이설',
            steps: [
              {
                name: '상하수도 이설',
                months: 4,
              },
              {
                name: '통신·전력관로 이설',
                months: 4,
              },
              {
                name: '가스관 이설',
                months: 3,
              },
            ],
          },
        ],
      },
      {
        name: '흙막이·복공',
        rows: [
          {
            startMonth: 4,
            sub: '흙막이 벽체',
            steps: [
              {
                name: 'H-Pile 천공·근입',
                months: 4,
              },
              {
                name: '토류판 설치',
                months: 3,
              },
              {
                name: '지반보강 그라우팅',
                months: 3,
              },
            ],
          },
          {
            startMonth: 8,
            sub: '복공·가시설',
            steps: [
              {
                name: '복공판 설치',
                months: 3,
              },
              {
                name: '버팀보(Strut) 설치',
                months: 4,
              },
            ],
          },
        ],
      },
      {
        name: '굴착·지보공',
        rows: [
          {
            startMonth: 8,
            steps: [
              {
                name: '1단계 굴착',
                months: 4,
              },
              {
                name: '중간말뚝·지보공 설치',
                months: 3,
              },
              {
                name: '2단계 굴착',
                months: 3,
              },
              {
                name: '3단계 굴착·바닥정리',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '계측관리',
        rows: [
          {
            startMonth: 4,
            steps: [
              {
                name: '계측기 설치',
                months: 2,
              },
              {
                name: '흙막이·굴착 계측관리',
                months: 16,
              },
              {
                name: '되메우기 계측·해체',
                months: 9,
              },
            ],
          },
        ],
      },
      {
        name: '정거장·본선 구조물',
        rows: [
          {
            startMonth: 18,
            sub: '정거장 구조물',
            steps: [
              {
                name: '기초·버림콘크리트',
                months: 2,
              },
              {
                name: '저판(바닥슬래브)',
                months: 3,
              },
              {
                name: '벽체·기둥',
                months: 4,
              },
              {
                name: '상부슬래브(중·상판)',
                months: 4,
              },
            ],
          },
          {
            startMonth: 20,
            sub: '본선 구조물',
            steps: [
              {
                name: '본선 저판',
                months: 3,
              },
              {
                name: '본선 벽체',
                months: 4,
              },
              {
                name: '본선 상부슬래브',
                months: 4,
              },
            ],
          },
        ],
      },
      {
        name: '방수·되메우기',
        rows: [
          {
            startMonth: 31,
            steps: [
              {
                name: '외방수',
                months: 2.5,
              },
              {
                name: '보호콘크리트',
                months: 1.5,
              },
              {
                name: '되메우기·다짐',
                months: 3,
              },
              {
                name: '복공해체·노면복구',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '궤도·건축·설비',
        rows: [
          {
            startMonth: 32,
            sub: '궤도',
            steps: [
              {
                name: '궤도 노반정리',
                months: 2,
              },
              {
                name: '도상·레일부설',
                months: 4,
              },
              {
                name: '궤도 정정·검측',
                months: 2,
              },
            ],
          },
          {
            startMonth: 33,
            sub: '건축·마감',
            steps: [
              {
                name: '정거장 건축마감',
                months: 6,
              },
              {
                name: '출입구·부대시설',
                months: 3,
              },
            ],
          },
          {
            startMonth: 34,
            sub: '전기·기계설비',
            steps: [
              {
                name: '전차선·수전설비',
                months: 4,
              },
              {
                name: '신호·통신설비',
                months: 4,
              },
              {
                name: '환기·소방설비',
                months: 3,
              },
            ],
          },
        ],
      },
      {
        name: '시운전·준공',
        rows: [
          {
            startMonth: 44,
            steps: [
              {
                name: '종합시운전',
                months: 2.5,
              },
              {
                name: '준공검사·인수인계',
                months: 1.5,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'land-dev',
    label: '택지·산업단지 조성',
    icon: '🏘️',
    group: 'site',
    desc: '대토공 + 우·오수/상수/전기·통신 + 도로·포장 + 조경',
    packages: [
      {
        name: '주요 마일스톤',
        rows: [
          {
            startMonth: 0,
            steps: [
              {
                name: '착공',
                months: 0,
                ms: true,
                atMonth: 1,
              },
              {
                name: '부지정지 완료',
                months: 0,
                ms: true,
                atMonth: 15,
              },
              {
                name: '관로·지중화 완료',
                months: 0,
                ms: true,
                atMonth: 21,
              },
              {
                name: '도로포장 완료',
                months: 0,
                ms: true,
                atMonth: 29,
              },
              {
                name: '준공',
                months: 0,
                ms: true,
                atMonth: 30,
              },
            ],
          },
        ],
      },
      {
        name: '가설·측량·지장물',
        rows: [
          {
            startMonth: 1,
            sub: '측량·가설',
            steps: [
              {
                name: '현황·경계측량',
                months: 1,
              },
              {
                name: '가설사무소·가설도로',
                months: 1.5,
              },
              {
                name: '가설울타리·안전시설',
                months: 1,
              },
            ],
          },
          {
            startMonth: 1,
            sub: '지장물 이설',
            steps: [
              {
                name: '지장물 조사·협의',
                months: 1,
              },
              {
                name: '지장물 철거·이설',
                months: 3,
              },
            ],
          },
        ],
      },
      {
        name: '부지 대토공',
        rows: [
          {
            startMonth: 2,
            sub: '토공',
            steps: [
              {
                name: '벌개제근·표토제거',
                months: 1.5,
              },
              {
                name: '절토·운반',
                months: 4.5,
              },
              {
                name: '성토·다짐',
                months: 4.5,
              },
              {
                name: '부지정지·법면정리',
                months: 2,
              },
            ],
          },
          {
            startMonth: 3.5,
            sub: '연약지반개량',
            steps: [
              {
                name: '연약지반 개량(PBD)',
                months: 3,
              },
              {
                name: '선행재하·계측관리',
                months: 4.5,
              },
            ],
          },
          {
            startMonth: 4,
            sub: '가배수·토사유출저감',
            steps: [
              {
                name: '가배수로·사방공',
                months: 2,
              },
              {
                name: '비점오염저감시설(가설)',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '우수·오수 관로',
        rows: [
          {
            startMonth: 9,
            sub: '우수관로',
            steps: [
              {
                name: '우수관 터파기·기초',
                months: 2.5,
              },
              {
                name: '우수관 부설·접합',
                months: 3,
              },
              {
                name: '우수받이·맨홀·되메우기',
                months: 2,
              },
            ],
          },
          {
            startMonth: 10,
            sub: '오수관로',
            steps: [
              {
                name: '오수관 터파기·기초',
                months: 2.5,
              },
              {
                name: '오수관 부설·접합',
                months: 3,
              },
              {
                name: '오수맨홀·수밀시험·되메우기',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '상수·전기·통신 지중화',
        rows: [
          {
            startMonth: 12,
            sub: '상수도',
            steps: [
              {
                name: '상수관 터파기·부설',
                months: 3,
              },
              {
                name: '수압시험·통수',
                months: 1.5,
              },
            ],
          },
          {
            startMonth: 12,
            sub: '전기·통신',
            steps: [
              {
                name: '전력관로·맨홀 부설',
                months: 3.5,
              },
              {
                name: '통신관로·핸드홀 부설',
                months: 3,
              },
              {
                name: '지중화 케이블 인입',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '도로·포장',
        rows: [
          {
            startMonth: 20,
            sub: '도로기층',
            steps: [
              {
                name: '노상정리·다짐',
                months: 2,
              },
              {
                name: '보조기층·기층 포설',
                months: 3,
              },
              {
                name: '경계석·측구·L형측구',
                months: 2,
              },
            ],
          },
          {
            startMonth: 24.5,
            sub: '포장',
            steps: [
              {
                name: '아스팔트 표층 포장',
                months: 2,
              },
              {
                name: '보도블록·부대포장',
                months: 1.5,
              },
              {
                name: '노면표시·교통안전시설',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '조경·부대공',
        rows: [
          {
            startMonth: 24,
            sub: '조경',
            steps: [
              {
                name: '식재기반 조성·객토',
                months: 2,
              },
              {
                name: '교목·관목 식재',
                months: 2,
              },
              {
                name: '잔디·지피 식재',
                months: 1.5,
              },
            ],
          },
          {
            startMonth: 24,
            sub: '부대시설',
            steps: [
              {
                name: '가로등·표지판 설치',
                months: 2,
              },
              {
                name: '완충녹지·휴게시설',
                months: 2,
              },
              {
                name: '우수저류지(조정지)·오수펌프장',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '준공',
        rows: [
          {
            startMonth: 27,
            steps: [
              {
                name: '마무리·정리',
                months: 1,
              },
              {
                name: '준공검사·시운전',
                months: 1,
              },
              {
                name: '준공도서·인계',
                months: 1,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'earthwork',
    label: '부지정지·대절성토',
    icon: '⛏️',
    group: 'site',
    desc: '절토·운반 + 성토·다짐 + 비탈면 보호 + 배수 — 대규모 토공',
    packages: [
      {
        name: '주요 마일스톤',
        rows: [
          {
            startMonth: 0,
            steps: [
              {
                name: '착공',
                months: 0,
                ms: true,
                atMonth: 1,
              },
              {
                name: '벌개제근 완료',
                months: 0,
                ms: true,
                atMonth: 4,
              },
              {
                name: '절·성토 착수',
                months: 0,
                ms: true,
                atMonth: 4,
              },
              {
                name: '성토 다짐 완료',
                months: 0,
                ms: true,
                atMonth: 14,
              },
              {
                name: '비탈면 보호 완료',
                months: 0,
                ms: true,
                atMonth: 16,
              },
              {
                name: '준공',
                months: 0,
                ms: true,
                atMonth: 18,
              },
            ],
          },
        ],
      },
      {
        name: '가설공사',
        rows: [
          {
            startMonth: 1,
            sub: '측량·가설',
            steps: [
              {
                name: '현황측량·시공측량',
                months: 1,
              },
              {
                name: '가설사무소·가설도로 설치',
                months: 1,
              },
              {
                name: '가배수로·오탁방지시설 설치',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '벌개제근',
        rows: [
          {
            startMonth: 2,
            sub: '지장물·표토처리',
            steps: [
              {
                name: '지장물조사·벌목벌개',
                months: 1,
              },
              {
                name: '표토제거·가적치(유용토)',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '절토·운반',
        rows: [
          {
            startMonth: 4,
            sub: '토사절취',
            steps: [
              {
                name: '토사 굴착·상차',
                months: 4,
              },
              {
                name: '토운반·토량배분(토취부→성토부)',
                months: 3,
              },
            ],
          },
          {
            startMonth: 5,
            sub: '리핑·발파',
            steps: [
              {
                name: '리핑암 굴착',
                months: 3,
              },
              {
                name: '발파암 천공·발파·소할·운반',
                months: 3,
              },
            ],
          },
        ],
      },
      {
        name: '성토·다짐',
        rows: [
          {
            startMonth: 4,
            sub: '원지반처리',
            steps: [
              {
                name: '성토부 원지반 정리·다짐',
                months: 1,
              },
              {
                name: '층따기(단절토)',
                months: 1,
              },
            ],
          },
          {
            startMonth: 6,
            sub: '대절성토',
            steps: [
              {
                name: '포설(층당 30cm)·함수비 조절',
                months: 4,
              },
              {
                name: '롤러다짐·현장밀도시험(들밀도)',
                months: 4,
              },
            ],
          },
        ],
      },
      {
        name: '배수공',
        rows: [
          {
            startMonth: 9,
            sub: '우수배수',
            steps: [
              {
                name: '측구·집수정 터파기',
                months: 1.5,
              },
              {
                name: 'L형·U형측구 설치',
                months: 2.5,
              },
              {
                name: '횡배수관·맹암거 부설',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '비탈면 보호',
        rows: [
          {
            startMonth: 12,
            sub: '성토면 보호',
            steps: [
              {
                name: '비탈면 정형·소단정리',
                months: 2,
              },
              {
                name: '돋움식재·씨앗뿜어붙이기(식생공)',
                months: 1.5,
              },
            ],
          },
          {
            startMonth: 13,
            sub: '절토면 보호',
            steps: [
              {
                name: '숏크리트·록볼트',
                months: 1.5,
              },
              {
                name: '낙석방지망·소단배수구 설치',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '계측관리',
        rows: [
          {
            startMonth: 6,
            sub: '사면·성토 계측',
            steps: [
              {
                name: '계측기 설치(지표침하판·경사계)',
                months: 1,
              },
              {
                name: '침하·변위 계측관리(안정확인)',
                months: 9,
              },
            ],
          },
        ],
      },
      {
        name: '준공',
        rows: [
          {
            startMonth: 16,
            sub: '정리·검사',
            steps: [
              {
                name: '부지 최종정지·잔토처리',
                months: 1,
              },
              {
                name: '가설물 철거·현장정리',
                months: 0.5,
              },
              {
                name: '준공측량·준공검사',
                months: 0.5,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'soft-ground',
    label: '연약지반 개량',
    icon: '🧪',
    group: 'geotech',
    desc: 'PBD/SCP + 선행재하 + 압밀 계측·판정 — 침하 관리',
    packages: [
      {
        name: '주요 마일스톤',
        rows: [
          {
            startMonth: 1,
            steps: [
              {
                name: '착공',
                months: 0,
                ms: true,
                atMonth: 1,
              },
              {
                name: '연직배수공(PBD·SCP) 완료',
                months: 0,
                ms: true,
                atMonth: 7,
              },
              {
                name: '선행재하 재하 완료(계획고+Surcharge)',
                months: 0,
                ms: true,
                atMonth: 14,
              },
              {
                name: '목표 압밀도 달성·제거 승인',
                months: 0,
                ms: true,
                atMonth: 21,
              },
              {
                name: '준공',
                months: 0,
                ms: true,
                atMonth: 25,
              },
            ],
          },
        ],
      },
      {
        name: '가설공·측량·지반조사',
        rows: [
          {
            startMonth: 1,
            steps: [
              {
                name: '가설사무소·진입도로·가설공',
                months: 1.5,
              },
              {
                name: '기준점·현황측량',
                months: 1,
              },
            ],
          },
          {
            sub: '지반조사',
            startMonth: 1,
            steps: [
              {
                name: '시추(보링)·표준관입시험(SPT)',
                months: 1.5,
              },
              {
                name: '실내토질시험·설계지반정수 확정',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '지반정리·부지조성(샌드매트)',
        rows: [
          {
            startMonth: 1.5,
            steps: [
              {
                name: '벌개제근·표토 제거',
                months: 1,
              },
              {
                name: '장비진입 매트포설(주행성 확보)',
                months: 1,
              },
              {
                name: '샌드매트(수평배수층) 포설',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '연직배수공(PBD)·모래다짐말뚝(SCP)',
        rows: [
          {
            sub: 'SCP(모래다짐말뚝)',
            startMonth: 4,
            steps: [
              {
                name: 'SCP 장비 반입·시험시공',
                months: 0.5,
              },
              {
                name: '모래다짐말뚝 타설(외곽·고하중부)',
                months: 2,
              },
            ],
          },
          {
            sub: 'PBD(연직배수재)',
            startMonth: 4.5,
            steps: [
              {
                name: 'PBD 장비 반입·시험시공',
                months: 0.5,
              },
              {
                name: '연직배수재(Plastic Board Drain) 타입',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '계측관리(침하·간극수압·사면)',
        rows: [
          {
            startMonth: 6,
            steps: [
              {
                name: '계측기 설치(침하판·간극수압계·경사계)·초기치 측정',
                months: 0.5,
              },
              {
                name: '성토·재하 중 계측 모니터링·사면 안정관리',
                months: 13.5,
              },
            ],
          },
        ],
      },
      {
        name: '단계성토(사면 안정관리)',
        rows: [
          {
            startMonth: 6.5,
            steps: [
              {
                name: '1단계 성토·안정검토(방치)',
                months: 1.5,
              },
              {
                name: '2단계 성토·안정검토(방치)',
                months: 2,
              },
              {
                name: '3단계 성토(계획고 도달)·안정검토',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '선행재하(Preloading)·압밀촉진',
        rows: [
          {
            startMonth: 12,
            steps: [
              {
                name: '선행재하 성토(Surcharge) 재하',
                months: 2,
              },
              {
                name: '재하 유지(압밀 진행·방치기간)',
                months: 6,
              },
            ],
          },
        ],
      },
      {
        name: '압밀 계측분석·침하 판정',
        rows: [
          {
            startMonth: 14,
            steps: [
              {
                name: '침하·간극수압 계측 데이터 축적',
                months: 5,
              },
              {
                name: '쌍곡선·Asaoka법 잔류침하 분석',
                months: 1.5,
              },
              {
                name: '목표 압밀도 판정·제거 승인',
                months: 0.5,
              },
            ],
          },
        ],
      },
      {
        name: '재하성토 제거·계획고 정리',
        rows: [
          {
            startMonth: 21,
            steps: [
              {
                name: '선행재하 성토 제거·잔토처리',
                months: 1.5,
              },
              {
                name: '계획고 정리·노체 마무리 정지',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '부대공·준공',
        rows: [
          {
            startMonth: 24,
            steps: [
              {
                name: '배수공·법면보호·부대시설',
                months: 0.5,
              },
              {
                name: '품질확인·계측 최종보고·준공검사',
                months: 0.5,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'retaining',
    label: '옹벽·보강토',
    icon: '🧱',
    group: 'geotech',
    desc: '현장타설 옹벽/보강토 블록·그리드 + 뒤채움·배수',
    packages: [
      {
        name: '주요 마일스톤',
        rows: [
          {
            startMonth: 0,
            steps: [
              {
                name: '착공',
                months: 0,
                ms: true,
                atMonth: 1,
              },
              {
                name: '터파기·기초 완료',
                months: 0,
                ms: true,
                atMonth: 4,
              },
              {
                name: '벽체 골조 완료',
                months: 0,
                ms: true,
                atMonth: 8,
              },
              {
                name: '뒤채움·배수 완료',
                months: 0,
                ms: true,
                atMonth: 10,
              },
              {
                // 상부 마감공(성토·비탈면 정리 및 식생공)이 357일, 부대·준공 행이 372일에
                // 끝난다. 준공은 그 뒤로 미룬다 — 작업을 앞당겨 맞추면 준공검사가 식생공보다
                // 먼저 시작되는 역순 공정이 된다.
                name: '준공',
                months: 0,
                ms: true,
                atMonth: 12.5,
              },
            ],
          },
        ],
      },
      {
        name: '착수·인허가',
        rows: [
          {
            startMonth: 1,
            steps: [
              {
                name: '실행설계·시공계획 승인',
                months: 0.5,
              },
              {
                name: '현황측량·기준점(TBM) 설치',
                months: 0.3,
              },
              {
                name: '재료 승인원·배합설계 제출',
                months: 0.4,
              },
            ],
          },
        ],
      },
      {
        name: '가설·토공',
        rows: [
          {
            startMonth: 1,
            steps: [
              {
                name: '가설공사(가설도로·안전휀스·가설사무소)',
                months: 0.5,
              },
              {
                name: '지장물 조사·이설',
                months: 0.5,
              },
              {
                name: '터파기(굴착)·사면 안정',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '계측관리',
        rows: [
          {
            startMonth: 2.7,
            steps: [
              {
                name: '계측기(지중경사계·변위말뚝) 설치',
                months: 0.3,
              },
              {
                name: '시공 중 계측·데이터 분석',
                months: 8,
              },
            ],
          },
        ],
      },
      {
        name: '기초공',
        rows: [
          {
            startMonth: 2.8,
            steps: [
              {
                name: '기초 바닥면 정리·잡석다짐(치환)',
                months: 0.5,
              },
              {
                name: '버림 콘크리트 타설',
                months: 0.3,
              },
              {
                name: '기초 철근조립·거푸집',
                months: 0.7,
              },
              {
                name: '기초 콘크리트 타설·양생',
                months: 0.5,
              },
            ],
          },
        ],
      },
      {
        name: '옹벽 벽체',
        rows: [
          {
            startMonth: 4.8,
            sub: '현장타설 옹벽(RC)',
            steps: [
              {
                name: '벽체 철근조립',
                months: 0.9,
              },
              {
                name: '벽체 거푸집 설치',
                months: 0.7,
              },
              {
                name: '벽체 콘크리트 타설·양생',
                months: 1,
              },
              {
                name: '거푸집 해체·면정리',
                months: 0.4,
              },
            ],
          },
          {
            startMonth: 4.8,
            sub: '보강토 옹벽(블록·그리드)',
            steps: [
              {
                name: '기초 레벨링 콘크리트·1단 전면블록 설치',
                months: 0.5,
              },
              {
                name: '블록·지오그리드·뒤채움 단별 반복시공(층다짐)',
                months: 2,
              },
              {
                name: '최상단 마감블록·수직도 확인',
                months: 0.5,
              },
            ],
          },
        ],
      },
      {
        name: '뒤채움·배수공',
        rows: [
          {
            startMonth: 8,
            sub: '현장타설부 뒤채움',
            steps: [
              {
                name: '벽체배면 배수재(부직포·유공관·필터층) 설치',
                months: 0.6,
              },
              {
                name: '양질 뒤채움재 포설·다짐(층다짐)',
                months: 1.5,
              },
              {
                name: '다짐도 시험(현장밀도)·확인',
                months: 0.4,
              },
            ],
          },
        ],
      },
      {
        name: '상부 마감공',
        rows: [
          {
            startMonth: 10.3,
            steps: [
              {
                name: '갓돌(관석)·방호벽(가드레일 기초) 설치',
                months: 0.6,
              },
              {
                name: '배수구·집수정·L형측구 마감',
                months: 0.5,
              },
              {
                name: '성토·비탈면 정리 및 식생공',
                months: 0.5,
              },
            ],
          },
        ],
      },
      {
        name: '부대·준공',
        rows: [
          {
            // 상부 마감공(식생공)이 11.9개월(357일)에 끝나므로 부대·준공은 그 뒤에 붙는다.
            // 11.2로 앞당기면 준공검사·인수인계가 식생공보다 먼저 시작된다(역순 공정).
            startMonth: 11.6,
            steps: [
              {
                name: '부대공(경계석·포장 접속부)',
                months: 0.3,
              },
              {
                name: '현장정리·계측 최종확인·준공도서 작성',
                months: 0.3,
              },
              {
                name: '준공검사·인수인계',
                months: 0.2,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'slope',
    label: '사면 안정·보강',
    icon: '🪨',
    group: 'geotech',
    desc: '앵커/네일/억지말뚝 + 숏크리트·격자블록 + 배수·녹화',
    packages: [
      {
        name: '주요 마일스톤',
        rows: [
          {
            startMonth: 0,
            steps: [
              {
                name: '착공',
                months: 0,
                ms: true,
                atMonth: 0,
              },
              {
                name: '사면 절취 완료',
                months: 0,
                ms: true,
                atMonth: 4,
              },
              {
                name: '보강공(앵커·네일·억지말뚝) 완료',
                months: 0,
                ms: true,
                atMonth: 7,
              },
              {
                name: '표면보호·배수공 완료',
                months: 0,
                ms: true,
                atMonth: 8,
              },
              {
                name: '준공',
                months: 0,
                ms: true,
                atMonth: 10,
              },
            ],
          },
        ],
      },
      {
        name: '가설공사',
        rows: [
          {
            startMonth: 0,
            sub: '가설·비계',
            steps: [
              {
                name: '가설도로·진입로 개설',
                months: 0.5,
              },
              {
                name: '가설사무소·현장정리',
                months: 0.5,
              },
              {
                name: '작업발판·비계 설치',
                months: 0.5,
              },
            ],
          },
          {
            startMonth: 0.5,
            sub: '안전가시설',
            steps: [
              {
                name: '낙석방지망·안전펜스 설치',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '측량·사면 정리·절취',
        rows: [
          {
            startMonth: 0.5,
            steps: [
              {
                name: '현황측량·중심측량',
                months: 0.5,
              },
              {
                name: '지장물 철거·벌개제근',
                months: 0.5,
              },
              {
                name: '사면 절취(터파기)',
                months: 1.5,
              },
              {
                name: '사면 정리·소단 정형',
                months: 0.5,
              },
              {
                name: '잔토처리·운반',
                months: 0.5,
              },
            ],
          },
        ],
      },
      {
        name: '보강공(앵커·네일·억지말뚝)',
        rows: [
          {
            startMonth: 1.5,
            sub: '억지말뚝(선행·활동토체 억지)',
            steps: [
              {
                name: '말뚝 천공',
                months: 1,
              },
              {
                name: '억지말뚝 근입·두부정리',
                months: 1,
              },
            ],
          },
          {
            startMonth: 4,
            sub: '그라운드 앵커',
            steps: [
              {
                name: '천공',
                months: 1,
              },
              {
                name: '앵커체 삽입·그라우팅',
                months: 1,
              },
              {
                name: '긴장·정착·인장시험',
                months: 1,
              },
            ],
          },
          {
            startMonth: 4,
            sub: '쏘일네일링',
            steps: [
              {
                name: '네일 천공·삽입',
                months: 1,
              },
              {
                name: '네일 그라우팅·두부처리',
                months: 0.5,
              },
            ],
          },
        ],
      },
      {
        name: '표면보호공(숏크리트·격자블록)',
        rows: [
          {
            startMonth: 5.5,
            sub: '숏크리트',
            steps: [
              {
                name: '와이어메쉬·철근 배근',
                months: 0.5,
              },
              {
                name: '숏크리트 타설',
                months: 1,
              },
              {
                name: '수발공·양생',
                months: 0.5,
              },
            ],
          },
          {
            startMonth: 6,
            sub: '격자블록',
            steps: [
              {
                name: '현장타설 격자블록 거푸집·타설',
                months: 1,
              },
              {
                name: '블록 내 채움·마감',
                months: 0.5,
              },
            ],
          },
        ],
      },
      {
        name: '배수공',
        rows: [
          {
            startMonth: 5,
            sub: '지표배수',
            steps: [
              {
                name: '산마루측구·소단측구 설치',
                months: 1,
              },
              {
                name: '사면 배수구·집수정 설치',
                months: 0.5,
              },
            ],
          },
          {
            startMonth: 5,
            sub: '지하배수',
            steps: [
              {
                name: '수평배수공(천공·배수관)',
                months: 1,
              },
              {
                name: '맹암거·배수층 설치',
                months: 0.5,
              },
            ],
          },
        ],
      },
      {
        name: '계측공',
        rows: [
          {
            startMonth: 3.5,
            steps: [
              {
                name: '계측기 설치(경사계·하중계 등)',
                months: 0.5,
              },
              {
                name: '시공중 계측·거동 분석',
                months: 5.5,
              },
              {
                name: '계측 종합보고·판정',
                months: 0.5,
              },
            ],
          },
        ],
      },
      {
        name: '녹화공',
        rows: [
          {
            startMonth: 8,
            steps: [
              {
                name: '식생기반재 시공',
                months: 0.5,
              },
              {
                name: '종자뿜어붙이기(시드스프레이)',
                months: 0.5,
              },
              {
                name: '식생매트·녹화 마감',
                months: 0.5,
              },
              {
                name: '초기 양생·관수 관리',
                months: 0.5,
              },
            ],
          },
        ],
      },
      {
        name: '준공',
        rows: [
          {
            startMonth: 9,
            steps: [
              {
                name: '부대·정리공',
                months: 0.3,
              },
              {
                name: '준공측량·현장정리',
                months: 0.3,
              },
              {
                name: '준공검사·시운전',
                months: 0.2,
              },
              {
                name: '준공서류·인계',
                months: 0.2,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'landfill',
    label: '폐기물 매립장',
    icon: '🗑️',
    group: 'environ',
    desc: '차수시설(HDPE·점토) + 침출수 집배수·처리 + 매립가스·복토',
    packages: [
      {
        name: '주요 마일스톤',
        rows: [
          {
            startMonth: 0,
            steps: [
              {
                name: '착공',
                months: 0,
                ms: true,
                atMonth: 1,
              },
              {
                name: '부지조성 완료',
                months: 0,
                ms: true,
                atMonth: 7,
              },
              {
                name: '차수시설 시공 완료',
                months: 0,
                ms: true,
                atMonth: 19,
              },
              {
                name: '침출수처리시설 준공',
                months: 0,
                ms: true,
                atMonth: 25,
              },
              {
                name: '준공',
                months: 0,
                ms: true,
                atMonth: 30,
              },
            ],
          },
        ],
      },
      {
        name: '인허가·실시설계',
        rows: [
          {
            startMonth: 1,
            sub: '착공준비',
            steps: [
              {
                name: '실시설계 승인·인허가',
                months: 1.5,
              },
              {
                name: '착공신고·측량·기준점 설치',
                months: 0.5,
              },
            ],
          },
        ],
      },
      {
        name: '가설·부지조성',
        rows: [
          {
            startMonth: 1,
            sub: '가설공사',
            steps: [
              {
                name: '가설사무소·가설도로',
                months: 0.5,
              },
              {
                name: '가배수로·오탁방지시설',
                months: 1.5,
              },
              {
                name: '공사용 전기·용수 인입',
                months: 1,
              },
            ],
          },
          {
            startMonth: 1,
            sub: '부지조성',
            steps: [
              {
                name: '벌개제근·표토제거',
                months: 1.5,
              },
              {
                name: '부지정지·성토',
                months: 2.5,
              },
              {
                name: '다짐·부지정리',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '매립지 굴착·정지',
        rows: [
          {
            startMonth: 4,
            sub: '굴착공',
            steps: [
              {
                name: '매립지 터파기·굴착',
                months: 3,
              },
              {
                name: '바닥면 정지·다짐',
                months: 2.5,
              },
              {
                name: '지반보강·계측기 설치',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '차수시설(HDPE·점토)',
        rows: [
          {
            startMonth: 10,
            sub: '점토차수층',
            steps: [
              {
                name: '점토라이너 포설·다짐',
                months: 3,
              },
              {
                name: '투수시험·품질검사',
                months: 1,
              },
            ],
          },
          {
            startMonth: 14,
            sub: 'HDPE차수막',
            steps: [
              {
                name: '부직포·GCL 포설',
                months: 1.5,
              },
              {
                name: 'HDPE 지오멤브레인 융착',
                months: 2.5,
              },
              {
                name: '융착부 비파괴검사·기밀시험',
                months: 1,
              },
            ],
          },
        ],
      },
      {
        name: '침출수 집배수·처리',
        rows: [
          {
            startMonth: 18,
            sub: '집배수시설',
            steps: [
              {
                name: '침출수 집배수관 부설',
                months: 2,
              },
              {
                name: '자갈배수층·보호토 포설',
                months: 1.5,
              },
              {
                name: '집수정·이송펌프장',
                months: 1.5,
              },
            ],
          },
          {
            startMonth: 18,
            sub: '처리시설',
            steps: [
              {
                name: '조정조·처리동 구조물',
                months: 3,
              },
              {
                name: '처리설비 설치·배관',
                months: 2.5,
              },
              {
                name: '시운전·수질검사',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '매립가스·복토',
        rows: [
          {
            startMonth: 22,
            sub: '매립가스',
            steps: [
              {
                name: '가스포집정·연결관',
                months: 2,
              },
              {
                name: '가스이송·소각(연소)시설',
                months: 2,
              },
            ],
          },
          {
            startMonth: 24,
            sub: '복토시설',
            steps: [
              {
                name: '일일·중간복토재 반입',
                months: 2,
              },
              {
                name: '최종복토·차단층',
                months: 2.5,
              },
            ],
          },
        ],
      },
      {
        name: '사면·부대공',
        rows: [
          {
            startMonth: 7,
            sub: '사면안정',
            steps: [
              {
                name: '제방·사면 성토·다짐',
                months: 3,
              },
              {
                name: '사면보호·식생공',
                months: 2,
              },
            ],
          },
          {
            startMonth: 24,
            sub: '부대공',
            steps: [
              {
                name: '우수배제·측구·배수공',
                months: 2,
              },
              {
                name: '진입도로·포장·부대건축',
                months: 2.5,
              },
            ],
          },
        ],
      },
      {
        name: '관리시설·전기계장',
        rows: [
          {
            startMonth: 20,
            sub: '관리시설',
            steps: [
              {
                name: '관리동·계량대 건축',
                months: 2.5,
              },
              {
                name: '세륜세차·소독시설',
                months: 1.5,
              },
            ],
          },
          {
            startMonth: 22,
            sub: '전기·계장',
            steps: [
              {
                name: '수배전·동력설비',
                months: 2,
              },
              {
                name: '계장·자동제어·통신',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '준공·사후관리',
        rows: [
          {
            startMonth: 27,
            steps: [
              {
                name: '환경모니터링정 설치',
                months: 1.5,
              },
              {
                name: '종합시운전·기능검사',
                months: 1,
              },
              {
                name: '준공검사·정리정돈',
                months: 0.5,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'eco-river',
    label: '생태하천 복원',
    icon: '🌿',
    group: 'environ',
    desc: '자연형 호안 + 여울/소·습지·어도 + 식생·수질 개선',
    packages: [
      {
        name: '주요 마일스톤',
        rows: [
          {
            startMonth: 0,
            steps: [
              {
                name: '착공',
                months: 0,
                ms: true,
                atMonth: 1,
              },
              {
                name: '물돌리기(유수전환) 완료',
                months: 0,
                ms: true,
                atMonth: 3,
              },
              {
                name: '하도정비 완료',
                months: 0,
                ms: true,
                atMonth: 8,
              },
              {
                name: '호안·구조물 완료',
                months: 0,
                ms: true,
                atMonth: 13,
              },
              {
                name: '식재·시험통수 완료',
                months: 0,
                ms: true,
                atMonth: 16,
              },
              {
                name: '준공',
                months: 0,
                ms: true,
                atMonth: 18,
              },
            ],
          },
        ],
      },
      {
        name: '가설·환경·물돌리기',
        rows: [
          {
            startMonth: 1,
            sub: '가설공사',
            steps: [
              {
                name: '현장측량·지장물조사',
                months: 0.5,
              },
              {
                name: '가설사무소·공사용 진입로 설치',
                months: 1,
              },
              {
                name: '가설울타리·안전시설',
                months: 0.5,
              },
            ],
          },
          {
            startMonth: 1,
            sub: '환경관리(전공기)',
            steps: [
              {
                name: '오탁방지막·비점오염 저감시설 설치',
                months: 1,
              },
              {
                name: '환경·수질 상시관리',
                months: 15,
              },
            ],
          },
          {
            startMonth: 1.5,
            sub: '물돌리기',
            steps: [
              {
                name: '가물막이(Sand Bag) 설치',
                months: 1,
              },
              {
                name: '가배수로·유수전환',
                months: 1,
              },
              {
                name: '배수펌프 설치·상시배수(공사기간)',
                months: 12,
              },
            ],
          },
        ],
      },
      {
        name: '하도 정비',
        rows: [
          {
            startMonth: 3,
            sub: '준설·하상정비',
            steps: [
              {
                name: '퇴적토·오니 준설',
                months: 1.5,
              },
              {
                name: '준설토 처리·사토 운반',
                months: 1,
              },
              {
                name: '하상굴착·통수단면 정비',
                months: 2,
              },
              {
                name: '저수로 선형정비',
                months: 1,
              },
            ],
          },
          {
            startMonth: 4,
            sub: '제방·둔치',
            steps: [
              {
                name: '제방 성토·다짐',
                months: 2,
              },
              {
                name: '둔치 정지·복토',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '자연형 호안·여울/소',
        rows: [
          {
            startMonth: 8,
            sub: '자연형 호안',
            steps: [
              {
                name: '기초터파기·기초잡석',
                months: 1,
              },
              {
                name: '자연석·돌망태 호안 축조',
                months: 2.5,
              },
              {
                name: '식생매트·야자섬유롤 호안',
                months: 1.5,
              },
            ],
          },
          {
            startMonth: 9,
            sub: '여울·소 조성',
            steps: [
              {
                name: '여울(Riffle) 자연석 배치',
                months: 1.5,
              },
              {
                name: '소(Pool)·낙차공 조성',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '생태습지·어도',
        rows: [
          {
            startMonth: 9,
            sub: '생태습지',
            steps: [
              {
                name: '습지 굴착·차수(방수)처리',
                months: 1.5,
              },
              {
                name: '습지 지형조성·수생기반 정비',
                months: 1.5,
              },
            ],
          },
          {
            startMonth: 10,
            sub: '어도·생태통로',
            steps: [
              {
                name: '어도 기초·본체 시공',
                months: 2,
              },
              {
                name: '생태통로·수제(水制) 설치',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '수질·부대공',
        rows: [
          {
            startMonth: 11,
            sub: '수질개선',
            steps: [
              {
                name: '수질정화(인공습지·정화시설) 설치',
                months: 2,
              },
            ],
          },
          {
            startMonth: 13,
            sub: '친수·편의시설',
            steps: [
              {
                name: '친수시설·안내판 설치',
                months: 1.5,
              },
            ],
          },
        ],
      },
      {
        name: '식생·조경',
        rows: [
          {
            startMonth: 12.5,
            sub: '수생·습지식재',
            steps: [
              {
                name: '수생식물·정수식물 식재',
                months: 1.5,
              },
              {
                name: '습지식생 매트 부설',
                months: 1,
              },
            ],
          },
          {
            startMonth: 13,
            sub: '육상 식재·조경',
            steps: [
              {
                name: '교목·관목 식재',
                months: 1.5,
              },
              {
                name: '초화류·잔디 파종',
                months: 1,
              },
            ],
          },
          {
            startMonth: 13,
            sub: '산책·동선',
            steps: [
              {
                name: '산책로·목교·데크 설치',
                months: 2,
              },
            ],
          },
        ],
      },
      {
        name: '준공',
        rows: [
          {
            startMonth: 15,
            sub: '시험통수·안정화',
            steps: [
              {
                name: '시험통수·시운전',
                months: 1,
              },
              {
                name: '식생 활착·구조물 안정화 모니터링',
                months: 1.5,
              },
            ],
          },
          {
            startMonth: 17,
            sub: '준공마무리',
            steps: [
              {
                name: '현장정리·잔여공 마무리',
                months: 0.5,
              },
              {
                name: '준공검사·서류정리',
                months: 0.5,
              },
            ],
          },
        ],
      },
    ],
  },
]
