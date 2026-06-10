// ─────────────────────────────────────────────────────────────────────────────
// Seed project that reproduces DESIGN/milestone sample.png:
// the 댐 시공 마일스톤 chart — 12 공종 lanes, time-scaled bars with name above /
// duration below, 우기 bands over the summer months, a red critical spine
// running 가물막이 → 접근수로 → 조절부 → 담수 → 준공, dependency arrows and
// diamond milestones. Acts as the default document a new user sees.
// ─────────────────────────────────────────────────────────────────────────────

import type { Category, Link, Project, RainySeason, Task } from '../types/model'
import { dateToDay, parseISO } from '../engine/dates'
import { applyCascade } from '../engine/scheduling'
import { lanePalette } from '../styles/theme'
import { DEFAULT_CI } from './ciLogo'

const START = '2026-01-01'
const day = (iso: string) => dateToDay(START, parseISO(iso))

interface CatDef { id: string; name: string; commissioning?: boolean }
const CATS: CatDef[] = [
  { id: 'c-gaseol', name: '가설공' },
  { id: 'c-road', name: '공사용도로' },
  { id: 'c-coffer', name: '가물막이' },
  { id: 'c-approach', name: '접근수로' },
  { id: 'c-control', name: '조절부' },
  { id: 'c-chute', name: '도류부' },
  { id: 'c-spill1', name: '여수로 1' },
  { id: 'c-spill2', name: '여수로 2' },
  { id: 'c-stilling', name: '감세지' },
  { id: 'c-intake', name: '신설 취수탑' },
  { id: 'c-valve', name: '신설 제수변실' },
  { id: 'c-aux', name: '부대공' },
  { id: 'c-commission', name: '시운전', commissioning: true },
]

const categories: Category[] = CATS.map((c, i) => ({
  id: c.id,
  name: c.name,
  color: lanePalette[i % lanePalette.length],
  collapsed: false,
  order: i,
  isCommissioning: c.commissioning,
}))

interface TaskDef {
  id: string
  cat: string
  name: string
  start: string
  dur: number
  milestone?: boolean
}

const TASKS: TaskDef[] = [
  // 가설공
  { id: 't-g1', cat: 'c-gaseol', name: '가설건물 설치', start: '2026-01-10', dur: 55 },
  { id: 't-g2', cat: 'c-gaseol', name: '공사용 전력·용수', start: '2026-02-05', dur: 95 },
  { id: 't-g3', cat: 'c-gaseol', name: '가설 우회도로', start: '2026-01-25', dur: 70 },
  // 공사용도로
  { id: 't-r1', cat: 'c-road', name: '공사용도로 개설', start: '2026-02-15', dur: 120 },
  { id: 't-r2', cat: 'c-road', name: '일괄관리도로', start: '2026-06-20', dur: 150 },
  // 가물막이 (critical spine start)
  { id: 't-cf1', cat: 'c-coffer', name: '상류 가물막이', start: '2026-05-01', dur: 90 },
  { id: 't-cf2', cat: 'c-coffer', name: '하류 가물막이', start: '2026-05-20', dur: 80 },
  { id: 't-cf3', cat: 'c-coffer', name: '하천 우회', start: '2026-08-10', dur: 55 },
  // 접근수로 (critical)
  { id: 't-ap1', cat: 'c-approach', name: '접근수로 굴착', start: '2026-07-30', dur: 120 },
  { id: 't-ap2', cat: 'c-approach', name: '접근수로 콘크리트', start: '2026-11-27', dur: 95 },
  // 조절부 (critical core)
  { id: 't-ct1', cat: 'c-control', name: '기초 굴착', start: '2026-11-27', dur: 100 },
  { id: 't-ct2', cat: 'c-control', name: '기초 콘크리트', start: '2027-03-07', dur: 120 },
  { id: 't-ct3', cat: 'c-control', name: '구조물 축조', start: '2027-07-05', dur: 220 },
  { id: 't-ct4', cat: 'c-control', name: '수문 설치', start: '2028-02-10', dur: 120 },
  { id: 't-ms-fill', cat: 'c-control', name: '◆ 초기 담수 시작', start: '2028-06-09', dur: 0, milestone: true },
  // 도류부
  { id: 't-ch1', cat: 'c-chute', name: '도류부 굴착', start: '2027-02-01', dur: 90 },
  { id: 't-ch2', cat: 'c-chute', name: '도류부 라이닝', start: '2027-05-10', dur: 150 },
  // 여수로 1
  { id: 't-s1a', cat: 'c-spill1', name: '여수로1 굴착', start: '2026-11-01', dur: 110 },
  { id: 't-s1b', cat: 'c-spill1', name: '여수로1 콘크리트', start: '2027-03-05', dur: 160 },
  // 여수로 2
  { id: 't-s2a', cat: 'c-spill2', name: '여수로2 굴착', start: '2027-04-01', dur: 120 },
  { id: 't-s2b', cat: 'c-spill2', name: '여수로2 콘크리트', start: '2027-08-15', dur: 150 },
  // 감세지
  { id: 't-st1', cat: 'c-stilling', name: '감세지 굴착', start: '2027-06-01', dur: 90 },
  { id: 't-st2', cat: 'c-stilling', name: '감세지 구조물', start: '2027-09-20', dur: 130 },
  // 신설 취수탑
  { id: 't-in1', cat: 'c-intake', name: '취수탑 기초', start: '2027-03-15', dur: 80 },
  { id: 't-in2', cat: 'c-intake', name: '취수탑 본체', start: '2027-06-25', dur: 160 },
  // 신설 제수변실
  { id: 't-v1', cat: 'c-valve', name: '제수변실 기초', start: '2027-07-01', dur: 70 },
  { id: 't-v2', cat: 'c-valve', name: '제수변 설비', start: '2027-09-25', dur: 110 },
  // 부대공 (critical tail → 준공)
  { id: 't-aux1', cat: 'c-aux', name: '조경·마감', start: '2028-06-09', dur: 80 },
  { id: 't-ms-done', cat: 'c-aux', name: '◆ 준공', start: '2028-08-28', dur: 0, milestone: true },
  // 시운전 (commissioning — hidden until enabled)
  { id: 't-cm1', cat: 'c-commission', name: '개별 시운전', start: '2028-06-15', dur: 40 },
  { id: 't-cm2', cat: 'c-commission', name: '연동 시운전', start: '2028-07-28', dur: 30 },
  { id: 't-ms-comm', cat: 'c-commission', name: '◆ 상업 운전', start: '2028-09-05', dur: 0, milestone: true },
]

const tasks: Task[] = TASKS.map((t) => ({
  id: t.id,
  categoryId: t.cat,
  name: t.name,
  start: day(t.start),
  duration: t.dur,
  isMilestone: !!t.milestone,
}))

let linkSeq = 0
const fs = (from: string, to: string, lag = 0): Link => ({
  id: `l-${++linkSeq}`,
  from,
  to,
  type: 'FS',
  lag,
})

const links: Link[] = [
  // critical spine
  fs('t-cf1', 't-ap1'),
  fs('t-ap1', 't-ct1'),
  fs('t-ct1', 't-ct2'),
  fs('t-ct2', 't-ct3'),
  fs('t-ct3', 't-ct4'),
  fs('t-ct4', 't-ms-fill'),
  fs('t-ms-fill', 't-aux1'),
  fs('t-aux1', 't-ms-done'),
  // feeders / branches (positive float — drawn as plain dashed arrows)
  fs('t-r1', 't-cf1'),
  fs('t-ap1', 't-ap2'),
  fs('t-ct3', 't-ch2'),
  fs('t-s1a', 't-s1b'),
  fs('t-s2a', 't-s2b'),
  fs('t-st1', 't-st2'),
  fs('t-in1', 't-in2'),
  fs('t-v1', 't-v2'),
  fs('t-s1b', 't-st2'),
  // commissioning chain
  fs('t-ms-fill', 't-cm1'),
  fs('t-cm1', 't-cm2'),
  fs('t-cm2', 't-ms-comm'),
]

const rainySeasons: RainySeason[] = [
  { id: 'rs-1', label: '우기', startMonth: 6, endMonth: 9, efficiency: 0.7 },
]

export function createSampleProject(): Project {
  const now = new Date().toISOString()
  // Pre-apply the cascade so the seed is internally consistent: every bar
  // already satisfies its FS dependencies (no link is drawn "backwards").
  const consistentTasks = applyCascade(tasks, links).tasks
  return {
    id: 'sample-hydronet',
    name: 'OO댐 시공·시운전 마일스톤',
    startDate: START,
    paper: { size: 'A1', orientation: 'landscape', marginMm: 10, dpi: 150, fitToPage: true },
    view: {
      pxPerDay: 1.5,
      rowHeight: 46,
      labelWidth: 132,
      headerHeight: 56,
      scale: 'month',
      showCriticalPath: true,
      showFloat: false,
      showGrid: true,
      showTitle: true,
    },
    categories,
    tasks: consistentTasks,
    links,
    rainySeasons,
    branding: { logos: [{ src: DEFAULT_CI, w: 168, h: 60 }] },
    commissioningEnabled: false,
    meta: { createdAt: now, updatedAt: now, schemaVersion: 1 },
  }
}
