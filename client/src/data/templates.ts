// Starting-point templates for the "새 도면" gallery. A blank-canvas tool feels
// empty without templates, so we offer a few realistic presets (dam / pumped-
// storage / simple-milestone / blank) beyond the single demo sample.

import { nanoid } from 'nanoid'
import type { Category, Link, Project, Task } from '../types/model'
import { dateToDay, parseISO } from '../engine/dates'
import { applyCascade } from '../engine/scheduling'
import { lanePalette, DEFAULT_PALETTE } from '../styles/theme'
import { DEFAULT_CI } from './ciLogo'
import { createSampleProject } from './sampleProject'

const START = '2026-01-01'

interface CatDef { id: string; name: string; commissioning?: boolean }
interface TaskDef { id: string; cat: string; name: string; start: string; dur: number; milestone?: boolean; sub?: string }

function build(name: string, cats: CatDef[], taskDefs: TaskDef[], links: Array<[string, string]>): Project {
  const day = (iso: string) => dateToDay(START, parseISO(iso))
  const categories: Category[] = cats.map((c, i) => ({
    id: c.id, name: c.name, color: lanePalette[i % lanePalette.length],
    collapsed: false, order: i, isCommissioning: c.commissioning,
  }))
  const tasks: Task[] = taskDefs.map((t) => ({
    id: t.id, categoryId: t.cat, name: t.name, start: day(t.start), duration: t.dur,
    isMilestone: !!t.milestone, ...(t.sub ? { subName: t.sub } : {}),
  }))
  const lk: Link[] = links.map(([from, to], i) => ({ id: `l-${i + 1}`, from, to, type: 'FS', lag: 0 }))
  const consistent = applyCascade(tasks, lk).tasks
  const now = new Date().toISOString()
  return {
    id: `proj-${nanoid(8)}`,
    name,
    startDate: START,
    paper: { size: 'A1', orientation: 'landscape', marginMm: 10, dpi: 150, fitToPage: true },
    view: {
      pxPerDay: 1.5, rowHeight: 46, labelWidth: 150, headerHeight: 56, scale: 'month',
      showCriticalPath: true, showFloat: false, showGrid: true, showTitle: true, textStyles: {},
    },
    categories,
    tasks: consistent,
    links: lk,
    rainySeasons: [{ id: 'rs-1', label: '우기', startMonth: 6, startDay: 1, endMonth: 9, endDay: 30, efficiency: 0.7 }],
    palette: [...DEFAULT_PALETTE],
    branding: { logos: [{ src: DEFAULT_CI, w: 168, h: 60 }] },
    commissioningEnabled: false,
    meta: { createdAt: now, updatedAt: now, schemaVersion: 1 },
  }
}

// ── 양수발전 ──
const PUMPED_CATS: CatDef[] = [
  { id: 'cp-temp', name: '가설공' },
  { id: 'cp-upper', name: '상부저수지' },
  { id: 'cp-tunnel', name: '진입·수직터널' },
  { id: 'cp-penstock', name: '수압관로' },
  { id: 'cp-power', name: '지하발전소' },
  { id: 'cp-tail', name: '방수로' },
  { id: 'cp-turbine', name: '수차·발전기' },
  { id: 'cp-aux', name: '부대공' },
  { id: 'cp-comm', name: '시운전', commissioning: true },
]
const PUMPED_TASKS: TaskDef[] = [
  { id: 'pt-1', cat: 'cp-temp', name: '가설건물·진입로', start: '2026-01-10', dur: 70 },
  { id: 'pt-2', cat: 'cp-upper', name: '상부저수지 굴착', start: '2026-03-01', dur: 180 },
  { id: 'pt-3', cat: 'cp-upper', name: '상부저수지 차수', start: '2026-09-10', dur: 120 },
  { id: 'pt-4', cat: 'cp-tunnel', name: '진입터널 굴착', start: '2026-04-01', dur: 200 },
  { id: 'pt-5', cat: 'cp-tunnel', name: '수직터널 굴착', start: '2026-11-01', dur: 150 },
  { id: 'pt-6', cat: 'cp-power', name: '지하발전소 굴착', start: '2027-01-15', dur: 180 },
  { id: 'pt-7', cat: 'cp-power', name: '발전소 구조물', start: '2027-08-01', dur: 200 },
  { id: 'pt-8', cat: 'cp-penstock', name: '수압관로 설치', start: '2027-05-01', dur: 160 },
  { id: 'pt-9', cat: 'cp-tail', name: '방수로 라이닝', start: '2027-09-01', dur: 120 },
  { id: 'pt-10', cat: 'cp-turbine', name: '수차 설치', start: '2028-03-01', dur: 120 },
  { id: 'pt-11', cat: 'cp-turbine', name: '발전기 설치', start: '2028-07-01', dur: 90 },
  { id: 'pt-12', cat: 'cp-aux', name: '◆ 초기 담수', start: '2028-06-15', dur: 0, milestone: true },
  { id: 'pt-13', cat: 'cp-aux', name: '◆ 준공', start: '2028-11-30', dur: 0, milestone: true },
  { id: 'pt-14', cat: 'cp-comm', name: '개별 시운전', start: '2028-10-01', dur: 30 },
  { id: 'pt-15', cat: 'cp-comm', name: '◆ 상업운전', start: '2028-12-15', dur: 0, milestone: true },
]
const PUMPED_LINKS: Array<[string, string]> = [
  ['pt-4', 'pt-6'], ['pt-6', 'pt-7'], ['pt-7', 'pt-10'], ['pt-10', 'pt-11'],
  ['pt-11', 'pt-12'], ['pt-12', 'pt-13'], ['pt-12', 'pt-14'], ['pt-14', 'pt-15'],
  ['pt-2', 'pt-3'], ['pt-5', 'pt-8'],
]

// ── 간단 마일스톤 ──
const SIMPLE_CATS: CatDef[] = [
  { id: 'cs-design', name: '설계' },
  { id: 'cs-permit', name: '인허가' },
  { id: 'cs-build', name: '시공' },
  { id: 'cs-comm', name: '시운전' },
]
const SIMPLE_TASKS: TaskDef[] = [
  { id: 'st-1', cat: 'cs-design', name: '기본설계', start: '2026-01-05', dur: 90 },
  { id: 'st-2', cat: 'cs-design', name: '실시설계', start: '2026-04-10', dur: 120 },
  { id: 'st-3', cat: 'cs-permit', name: '인허가', start: '2026-08-15', dur: 60 },
  { id: 'st-4', cat: 'cs-build', name: '◆ 착공', start: '2026-11-01', dur: 0, milestone: true },
  { id: 'st-5', cat: 'cs-build', name: '본공사', start: '2026-11-01', dur: 400 },
  { id: 'st-6', cat: 'cs-build', name: '◆ 준공', start: '2028-01-10', dur: 0, milestone: true },
  { id: 'st-7', cat: 'cs-comm', name: '시운전', start: '2028-01-15', dur: 45 },
  { id: 'st-8', cat: 'cs-comm', name: '◆ 상업운전', start: '2028-03-05', dur: 0, milestone: true },
]
const SIMPLE_LINKS: Array<[string, string]> = [
  ['st-1', 'st-2'], ['st-2', 'st-3'], ['st-3', 'st-4'], ['st-4', 'st-5'],
  ['st-5', 'st-6'], ['st-6', 'st-7'], ['st-7', 'st-8'],
]

export interface TemplateDef {
  key: string
  name: string
  desc: string
  make: () => Project
}

export const TEMPLATES: TemplateDef[] = [
  {
    key: 'dam',
    name: '댐 시공·시운전',
    desc: '표준 공종 12종 + 마일스톤·주공정·우기 (전체 예시)',
    make: () => { const p = createSampleProject(); p.id = `proj-${nanoid(8)}`; return p },
  },
  {
    key: 'pumped',
    name: '양수발전 시공·시운전',
    desc: '상부저수지·터널·수압관로·지하발전소·수차/발전기·시운전',
    make: () => build('양수발전 시공·시운전 마일스톤', PUMPED_CATS, PUMPED_TASKS, PUMPED_LINKS),
  },
  {
    key: 'simple',
    name: '간단 마일스톤',
    desc: '설계·인허가·시공·시운전 핵심 단계만 (소규모·빠른 작성)',
    make: () => build('공정 마일스톤', SIMPLE_CATS, SIMPLE_TASKS, SIMPLE_LINKS),
  },
  {
    key: 'blank',
    name: '빈 프로젝트',
    desc: '표준 공종 12종만 — 공정은 직접 추가',
    make: () => {
      const p = createSampleProject()
      p.id = `proj-${nanoid(8)}`
      p.name = '새 프로젝트'
      p.tasks = []
      p.links = []
      return p
    },
  },
]
