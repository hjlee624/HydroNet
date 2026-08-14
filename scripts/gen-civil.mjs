// One-shot generator: merge workflow-authored `packages` into the civil-facility
// metadata and rewrite client/src/data/civilFacilities.ts. Run:
//   node scripts/gen-civil.mjs <workflow-output.json>
import fs from 'node:fs'

const outPath = process.argv[2]
const raw = fs.readFileSync(outPath, 'utf8')
const parsed = JSON.parse(raw)
const list = Array.isArray(parsed) ? parsed : parsed.result
if (!Array.isArray(list)) throw new Error('no result array in workflow output')
const pkgByKey = new Map(list.map((r) => [r.key, r.packages]))

// 시설물 메타데이터 (label/icon/group/desc) — 사람 설계. packages 는 워크플로 결과 병합.
const META = [
  ['road-new', '도로(신설)', '🛣️', 'road', '토공·배수·구조물·포장·부대공 — 국도·단지 진입 등 신설 도로 표준'],
  ['road-widen', '도로 확장·개량', '🚧', 'road', '교통처리 병행 확폭·선형개량 + 덧씌우기 포장'],
  ['interchange', '입체교차로(IC/JCT)', '🔀', 'road', '램프 성토 + 교량(교대·교각·거더) + 교통시설 — 나들목·분기점'],
  ['airport', '공항·활주로', '🛫', 'road', '대규모 부지조성 + 활주로·유도로 포장 + 항행안전·등화'],
  ['bridge-psc', 'PSC 거더교', '🌉', 'bridge', '기초·하부공 + PSC빔 제작·거치 + 바닥판 — 중소경간 표준형'],
  ['bridge-steel', '강교(플레이트/박스)', '🌉', 'bridge', '강거더 공장제작·가설 + 바닥판 합성 + 도장'],
  ['bridge-cable', '사장교', '🌉', 'bridge', '대형기초 + 주탑 + 케이블 + 세그먼트 캔틸레버(FCM) — 장경간'],
  ['bridge-suspension', '현수교', '🌉', 'bridge', '앵커리지 + 주탑 + 주케이블(에어스피닝) + 보강형 — 초장경간'],
  ['tunnel-natm', '산악터널(NATM)', '⛰️', 'tunnel', '발파 굴착 + 숏크리트·록볼트 지보 + 라이닝 — 산악 표준'],
  ['tunnel-tbm', 'TBM 터널', '🕳️', 'tunnel', 'TBM 굴진 + 세그먼트 조립 + 뒤채움 그라우팅'],
  ['tunnel-cut', '개착식 터널', '🧱', 'tunnel', '흙막이 + 굴착 + 박스 구조물 + 되메우기·복공'],
  ['tunnel-immersed', '침매터널', '🌊', 'tunnel', '함체 제작 + 준설·기초 + 예항·침설 + 수중연결 — 하저·해저'],
  ['river-improve', '하천정비·제방', '🏞️', 'river', '하도 준설 + 제방 축조 + 호안 + 수문·통관'],
  ['seawall', '방조제·하구둑', '🌊', 'river', '연약지반 개량 + 제체 축조 + 최종 물막이 + 배수갑문'],
  ['pump-station', '배수펌프장', '💧', 'river', '유수지 + 펌프장 토목구조물 + 기전·전기설비 + 시운전'],
  ['erosion-dam', '사방댐', '⛰️', 'river', '기초굴착 + 본체(콘크리트/전석) + 물받이·계류보전 — 소규모'],
  ['water-treatment', '정수장', '🚰', 'water-supply', '착수·응집·침전·여과 구조물 + 정수지·배수지 + 기계·전기·계장'],
  ['water-intake', '취수장·도수관로', '🏞️', 'water-supply', '취수시설(취수탑/취수보) + 도수관로 부설 + 시운전'],
  ['water-pipe', '상수관로(송·배수)', '🔧', 'water-supply', '관로 부설·접합 + 밸브·소화전 + 수압시험·통수 — 관로 공사'],
  ['sewage-treatment', '하수처리장', '♻️', 'sewer', '전처리·생물반응조·2차침전·소독 + 슬러지 처리 + 시운전'],
  ['sewer-pipe', '하수관로(차집관거)', '🕳️', 'sewer', '관거 부설(개착/추진) + 맨홀·연결 + 통수시험'],
  ['breakwater', '방파제', '🌊', 'port', '기초 사석 + 케이슨 제작·거치 + 상치 + 소파블록(T.T.P)'],
  ['quay', '안벽·부두', '⚓', 'port', '케이슨/잔교식 안벽 + 뒤채움·에이프런 + 계선·하역설비'],
  ['dredging', '준설·매립', '🚢', 'port', '호안 축조 + 준설 + 매립·투기 + 지반개량'],
  ['rail-roadbed', '철도 노반', '🚄', 'rail', '토공 + 구조물(교량·통로박스) + 강화노반 + 배수공'],
  ['rail-track', '궤도부설', '🛤️', 'rail', '도상(자갈/콘크리트궤도) + 레일 부설·용접 + 분기기 + 정정'],
  ['subway', '도시철도(개착)', '🚇', 'rail', '흙막이·복공 + 굴착 + 정거장·본선 구조물 + 궤도·건축·설비'],
  ['land-dev', '택지·산업단지 조성', '🏘️', 'site', '대토공 + 우·오수/상수/전기·통신 + 도로·포장 + 조경'],
  ['earthwork', '부지정지·대절성토', '⛏️', 'site', '절토·운반 + 성토·다짐 + 비탈면 보호 + 배수 — 대규모 토공'],
  ['soft-ground', '연약지반 개량', '🧪', 'geotech', 'PBD/SCP + 선행재하 + 압밀 계측·판정 — 침하 관리'],
  ['retaining', '옹벽·보강토', '🧱', 'geotech', '현장타설 옹벽/보강토 블록·그리드 + 뒤채움·배수'],
  ['slope', '사면 안정·보강', '🪨', 'geotech', '앵커/네일/억지말뚝 + 숏크리트·격자블록 + 배수·녹화'],
  ['landfill', '폐기물 매립장', '🗑️', 'environ', '차수시설(HDPE·점토) + 침출수 집배수·처리 + 매립가스·복토'],
  ['eco-river', '생태하천 복원', '🌿', 'environ', '자연형 호안 + 여울/소·습지·어도 + 식생·수질 개선'],
]

const missing = META.filter(([k]) => !(pkgByKey.get(k) || []).length).map(([k]) => k)
if (missing.length) console.error('WARN empty packages:', missing.join(', '))

const facilities = META.map(([key, label, icon, group, desc]) => ({
  key,
  label,
  icon,
  group,
  desc,
  packages: pkgByKey.get(key) || [],
}))

const header = `// ─────────────────────────────────────────────────────────────────────────────
// 전사공통(토목설계 전반) 시설물 유형 + 유형별 시공 공정표(공종/공정/마일스톤) 프리셋.
//
// 메타데이터(label/icon/group/desc)는 사람이 설계하고, \`packages\`(시공 공정표)는
// civil-facility-schedules 워크플로가 유형별로 저작·검증한 결과다(scripts/gen-civil.mjs 로 병합).
// facilities.ts 가 이 배열을 FACILITY_TYPES 와 SCHEMES 에 병합한다(수력·댐 9종 + 여기 토목 다분야).
//
// packages 구조는 facilities.ts 의 Scheme/Pkg/Row/Step 과 동일:
//  packages[0] = "주요 마일스톤"(steps 모두 ms:true + atMonth), 이후 = 공종 레인.
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
export const CIVIL_FACILITIES: CivilFacility[] = `

const body = JSON.stringify(facilities, null, 2)
fs.writeFileSync('client/src/data/civilFacilities.ts', `${header}${body}\n`, 'utf8')
console.log('wrote civilFacilities.ts —', facilities.length, 'facilities,', missing.length, 'empty')
