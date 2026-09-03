// ─────────────────────────────────────────────────────────────────────────────
// 표준 일작업량(생산성) 로컬 DB + 법정 공사기간 산정 상수
//
// 근거(출처):
//  · 국토교통부 「공공 건설공사의 공사기간 산정기준」(고시 제2024-1021호, 시행 2025.1.6)
//  · 「건설기술 진흥법」 제45조의2 — 발주청의 적정 공사기간 산정 의무
//  · 해설서 『2026년 적정 공사기간 확보를 위한 가이드라인』(공고자료) — 특히 **부록4 공종별 1일 작업량**
//    파일: docs/2._(공고자료)_2026년_적정_공사기간_확보를_위한_가이드라인.pdf
//
// 아래 STANDARD_RATES 의 값은 위 가이드라인 **부록4(PDF p101–123)** 에서 판독한 대표값이다.
// 검토서(docs/Sequence_AI공정표_도메인연동_검토서.html) B2 지침대로 "전량 일괄"이 아니라 **주요 공종부터
// 부분 구축**하며, 각 항목에 출처 페이지(page)를 남겨 커버리지를 추적한다(값은 대표 조건 기준 — 실제
// 산정은 시공조건·장비제원에 따라 달라질 수 있으므로 발주청 경험치로 보정 가능).
// ─────────────────────────────────────────────────────────────────────────────

/** 법정 근거 문자열 — 근거 팝업/Inspector에 그대로 표기(개정 추적 대상). */
export const LEGAL_BASIS = {
  notice: '「공공 건설공사의 공사기간 산정기준」 국토교통부고시 제2024-1021호(시행 2025.1.6)',
  act: '「건설기술 진흥법」 제45조의2(적정 공사기간의 산정)',
  guideline: '『적정 공사기간 확보를 위한 가이드라인』(2026) 부록4 — 공종별 1일 작업량',
} as const

/**
 * 총공사기간(법정 산정식) — 가이드라인 원문(p17):
 *   "공사기간 = ① 준비기간 + ② 비작업일수 + ③ 작업일수 + ④ 정리기간"
 * 이 중 ③ **작업일수 = 공종별 작업수량 ÷ 1일 작업량**(부록4)이며, 전체 공사기간에 영향을 주는
 * **주공정선(critical path) 상의 공종에 한정**해 산정한다(가이드라인 p27).
 */
export const CONSTRUCTION_PERIOD_FORMULA =
  '공사기간 = 준비기간 + 비작업일수 + 작업일수 + 정리기간' as const

/** 작업일수 산정식(부록4 활용) — p27. */
export const WORKDAYS_FORMULA = '작업일수 = 작업수량 ÷ 1일 작업량 (주공정선 공종 한정)' as const

export interface PeriodComponent {
  key: 'prep' | 'nonWork' | 'work' | 'cleanup'
  order: number
  label: string
  def: string
  page: number
}

/** 공사기간 4대 구성요소 정의(가이드라인 p17). 근거 팝업에서 그대로 노출. */
export const PERIOD_COMPONENTS: PeriodComponent[] = [
  {
    key: 'prep',
    order: 1,
    label: '준비기간',
    def: '설계도서 검토·안전관리계획 승인·측량·현장사무소/가설건물 설치·주요 자재·장비 조달 등 착공 준비에 필요한 기간(비작업일수 미계상).',
    page: 17,
  },
  {
    key: 'nonWork',
    order: 2,
    label: '비작업일수',
    def: '법정공휴일수 + 기상(강우·강설·혹서·혹한·바람·미세먼지)으로 인한 공사불능일수(중복일 제외). 월별 산정: A(기상)+B(법정공휴일)−C(중복). 주40시간 하한 월 8일.',
    page: 19,
  },
  {
    key: 'work',
    order: 3,
    label: '작업일수',
    def: '공종별 작업수량을 시공하는 데 필요한 총 작업일수 = 작업수량 ÷ 1일 작업량(부록4). 주공정선 공종에 한정.',
    page: 27,
  },
  {
    key: 'cleanup',
    order: 4,
    label: '정리기간',
    def: '준공검사 준비·시설물 인수 등 행정절차 및 현장정리 기간(통상 주요공종 마무리 후 준공 전 1개월 범위, 비작업일수 미계상).',
    page: 17,
  },
]

export interface NonWorkFactor {
  factor: string
  rule: string
  page: number
}

/** 비작업일수 산정 근거(기상·공휴일). RainySeason(우기) 밴드 확장의 법적 근거이기도 하다. */
export const NONWORK_FACTORS: NonWorkFactor[] = [
  {
    factor: '산정식',
    rule: '월별 비작업일수 = A(기상 작업불가일) + B(법정공휴일) − C(중복=A×B÷달력일수, 반올림). 주공정 및 영향 공종 대상.',
    page: 19,
  },
  { factor: '강우', rule: '토공·콘크리트 등 옥외공사: 일강수량 3mm 이상(산정예시 10mm/일).', page: 20 },
  { factor: '강설', rule: '옥외·콘크리트공사: 신적설 5cm 이상.', page: 20 },
  { factor: '혹서', rule: '체감온도 33℃ 이상(폭염) — 산안규칙 §560 온열질환 예방 고려.', page: 20 },
  { factor: '혹한', rule: '동절기 최저기온 0℃ 이하(콘크리트공사 최고 0℃ 이하).', page: 20 },
  { factor: '바람', rule: '최대순간풍속 15m/s 이상(타워크레인 10m/s 초과 설치·해체 중지).', page: 20 },
  { factor: '미세먼지', rule: 'PM2.5 나쁨/비상저감조치 시 가동률·작업시간 조정(수도권 연 약 5일↑).', page: 20 },
  {
    factor: '법정공휴일',
    rule: '「관공서의 공휴일에 관한 규정」 §2·§3 공휴일·대체공휴일(부록1: 2026–2035 공휴일수).',
    page: 20,
  },
]

/**
 * 표준 일작업량 1건. 두 가지 표기를 모두 지원:
 *  · dailyOutput : 1일 작업량(단위/일). 작업일수 = 수량 ÷ dailyOutput.
 *  · daysPerUnit : 단위당 소요일(일/단위, 사이클형 공종: 기초·교각·경간 등). 작업일수 = 수량 × daysPerUnit.
 * 둘 중 하나만 채운다.
 */
export interface StandardRate {
  /** workCode 매핑 키(조달청 세부공종분류코드와 호환하도록 부여). */
  code: string
  /** 공종(대분류). */
  work: string
  /** 세부작업(대표 조건). */
  subwork: string
  /** 수량 단위(㎥·㎡·m·ton·본·개소·경간 등). */
  unit: string
  /** 1일 작업량(단위/일). daysPerUnit 사용 시 생략. */
  dailyOutput?: number
  /** 단위당 소요일(일/단위) — 사이클형 공종. dailyOutput 사용 시 생략. */
  daysPerUnit?: number
  /** 비고(원문 조건·대체값). */
  note?: string
  /** 가이드라인 PDF 페이지(부록4). */
  page: number
}

/**
 * 부록4 공종별 1일 작업량(대표값) — 토목·건축 주요 공종 우선. 각 항목의 page는 가이드라인 PDF 쪽.
 * 값이 "N일/개소·Lot·경간"처럼 사이클형인 항목은 daysPerUnit 으로, 그 외는 dailyOutput 으로 표기.
 */
export const STANDARD_RATES: StandardRate[] = [
  // ── 토공사 ──
  { code: 'earthwork-cut-soil', work: '토공사·흙깎기', subwork: '토사(굴삭기 1.0㎥)', unit: '㎥', dailyOutput: 520, note: '도로 토공사', page: 102 },
  { code: 'earthwork-cut-ripping', work: '토공사·흙깎기', subwork: '리핑암(리퍼2본+불도저32톤)', unit: '㎥', dailyOutput: 367, page: 102 },
  { code: 'earthwork-cut-rock', work: '토공사·흙깎기', subwork: '발파암(브레이커, 연·보통·경암 평균)', unit: '㎥', dailyOutput: 27, note: '진동제어발파(소규모)는 83㎥/일', page: 102 },
  { code: 'earthwork-excav-soil', work: '토공사·터파기', subwork: '토사(굴삭기 0.7㎥, 자연터파기)', unit: '㎥', dailyOutput: 349, note: '리핑암 25 / 발파암 18㎥/일', page: 102 },
  { code: 'earthwork-fill-subgrade', work: '토공사·흙쌓기', subwork: '노상(모터그레이더 3.6㎥)', unit: '㎥', dailyOutput: 745, note: '노체 1,118 / 암쌓기 647 / 녹지대 1,231㎥/일', page: 102 },
  { code: 'earthwork-backfill-rammer', work: '토공사·되메우기', subwork: '램머(80kg) 다짐', unit: '㎥', dailyOutput: 42, note: '철근콘크리트공사에도 동일 적용', page: 102 },
  // ── 연약지반 ──
  { code: 'soft-ground-pbd', work: '연약지반처리', subwork: '플라스틱 보드 드레인(PBD, L≤25m)', unit: 'm', dailyOutput: 9396, note: '매트부설(PP/PET) 3,571㎡/일', page: 102 },
  // ── 배수·구조물 ──
  { code: 'drain-pipe-hume600', work: '배수공사·배수관', subwork: '흄관/VR관 ø600 고무링접합', unit: 'm', dailyOutput: 43, note: '강관 ø800(접합제외) 38 / 강관압입추진 3m/일', page: 103 },
  { code: 'retaining-wall-conc', work: '배수공사·옹벽', subwork: '콘크리트 옹벽(B=4m,H=5m)', unit: 'span(15m)', daysPerUnit: 25, note: '1span=15m 기준 25일 / 보강토옹벽(블록식) 14㎡/일', page: 103 },
  // ── 포장 ──
  { code: 'pave-asphalt-surf', work: '포장공사·아스팔트', subwork: '표층/중간층(폭≥3m, 5~7cm)', unit: '㎡', dailyOutput: 4800, note: '기층 4,900(5~7cm)/4,500(8~10cm)㎡/일(1조 기준)', page: 104 },
  { code: 'pave-conc-lean', work: '포장공사·콘크리트', subwork: '린콘크리트 기층 포설', unit: '㎥', dailyOutput: 550, note: '콘크리트표층 1차로 300 / 2차로 700㎥/일', page: 104 },
  // ── 교량 (사이클형: 일/단위) ──
  { code: 'bridge-found-direct', work: '교량공사·기초공', subwork: '직접기초(암반청소~양생 1사이클)', unit: '개소', daysPerUnit: 18, note: 'PSC Beam교 1경간30m 기준 / 말뚝기초(SDA) 10본/일', page: 105 },
  { code: 'bridge-pier-column', work: '교량공사·하부공', subwork: '교각 기둥(1Lot=3.0m)', unit: 'Lot(3.0m)', daysPerUnit: 7, note: '교대벽체 10일/Lot(2.5m) / 코핑 20일/개소', page: 105 },
  { code: 'bridge-super-slab', work: '교량공사·상부공', subwork: '상부슬래브(동바리~양생, 1경간)', unit: '경간', daysPerUnit: 25, note: '2경간 40일 / 거더제작 18일/본 · 거치 2본/일', page: 105 },
  // ── 터널 ──
  { code: 'tunnel-excav-p1', work: '터널공사·굴착·보강', subwork: '2차선 C군 타입P-1 사이클(단면66.2㎡)', unit: 'm', dailyOutput: 4.3, note: 'P-3 2.9 / P-6 상반2.2·하반2.9m/일', page: 106 },
  { code: 'tunnel-lining', work: '터널공사·라이닝', subwork: '라이닝 콘크리트(10m/3일)', unit: 'm', dailyOutput: 3.33, note: '원문 10m/3일 → 3.33m/일 환산 · 방수 50m/일', page: 106 },
  // ── 부대공 ──
  { code: 'road-soundwall', work: '부대공사(도로)', subwork: '방음벽(H≤7.0m)', unit: 'm', dailyOutput: 19, note: '중앙분리대 300m/일 / 가드레일 130개/일', page: 107 },
  // ── 건축 토공 ──
  { code: 'bldg-excav-soil', work: '건축토공사·터파기', subwork: '토사굴착(굴삭기 1.0㎥)', unit: '㎥', dailyOutput: 950, note: '0.6㎥ 560 / 보통 514 / 불량(지장물) 380㎥/일', page: 112 },
  // ── 기초·말뚝 ──
  { code: 'pile-precast', work: '기초공사·기성말뚝', subwork: '기성말뚝(ø508, L=12m, 점질토)', unit: '본', dailyOutput: 15, note: 'H-Pile 천공(ø<500) 27본/일', page: 113 },
  { code: 'pile-head-trim', work: '기초공사·말뚝두부정리', subwork: '강관말뚝 두부정리(ø500)', unit: '본', dailyOutput: 21, note: '콘크리트말뚝 두부정리 18본/일', page: 114 },
  // ── 철근콘크리트 ──
  { code: 'rc-rebar', work: '철근콘크리트·철근', subwork: '현장조립 토목 Type-Ⅱ-1(철근공5+보통2)', unit: 'ton', dailyOutput: 2.5, note: '현장가공 4.0 / 건축 TYPE-Ⅰ 3.4·Ⅱ 3.0ton/일', page: 115 },
  { code: 'rc-form-ply', work: '철근콘크리트·거푸집', subwork: '합판거푸집 설치(난이도 보통)', unit: '㎡', dailyOutput: 60, note: '간단 70 / 복잡 40 / 해체 100㎡/일', page: 115 },
  { code: 'rc-form-euro', work: '철근콘크리트·거푸집', subwork: '유로폼 설치(수직고≤7m, 보통)', unit: '㎡', dailyOutput: 50, note: '간단 65 / 해체 115㎡/일', page: 115 },
  { code: 'rc-conc-pump', work: '철근콘크리트·콘크리트타설', subwork: '펌프카 타설(≥80㎥/hr, 철근구조물 TYPE-Ⅱ)', unit: '㎥', dailyOutput: 130, note: '무근 189 / Type-Ⅰ·Ⅱ 182㎥/일', page: 117 },
  // ── 철골 ──
  { code: 'steel-erect', work: '철골공사', subwork: '철골 현장세우기(20층 미만)', unit: 'ton', dailyOutput: 11.3, note: '탑다운 지하세우기 4.5ton/일 / 데크플레이트 85㎡/일', page: 118 },
  // ── 마감 ──
  { code: 'finish-waterproof-coat', work: '마감·방수공사', subwork: '도막방수(1층, 바닥)', unit: '㎡', dailyOutput: 200, note: '시트 88 / 시멘트액체 40 / 프라이머 272㎡/일', page: 119 },
  // ── 기계설비 ──
  { code: 'mech-pipe-steel100', work: '기계설비·배관공사', subwork: '강관 설치(탄소강관 아크용접 옥내, 100mm)', unit: 'm', dailyOutput: 6.5, note: '50mm 13.5 / 나사식 32mm 16.1m/일', page: 122 },
  // ── 가설 ──
  { code: 'temp-scaffold', work: '가설공사(건축)', subwork: '강관비계 설치(H≤10m 쌍줄)', unit: '㎡', dailyOutput: 60, note: '시스템비계 100㎡/일 / 가설건축물 8개/일', page: 111 },
]

const RATE_BY_CODE = new Map(STANDARD_RATES.map((r) => [r.code, r]))

/** workCode 로 표준 일작업량 조회. */
export function findStandardRate(code?: string): StandardRate | undefined {
  return code ? RATE_BY_CODE.get(code) : undefined
}

/** Inspector 드롭다운용 옵션 목록(공종·세부작업·단위 라벨). */
export const STANDARD_RATE_OPTIONS = STANDARD_RATES.map((r) => ({
  code: r.code,
  label: `${r.work} — ${r.subwork} (${r.dailyOutput != null ? `${r.dailyOutput}${r.unit}/일` : `${r.daysPerUnit}일/${r.unit}`})`,
}))
