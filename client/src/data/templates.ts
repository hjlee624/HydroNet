// Starting-point templates for the "새 도면" gallery. A blank-canvas tool feels
// empty without templates, so we offer a few realistic presets (dam / pumped-
// storage / simple-milestone / blank) beyond the single demo sample.

import { nanoid } from 'nanoid'
import type { Category, Link, Project, ProjectKind, Task } from '../types/model'
import { dateToDay, parseISO } from '../engine/dates'
import { applyCascade } from '../engine/scheduling'
import { lanePalette, DEFAULT_PALETTE } from '../styles/theme'
import { DEFAULT_CI } from './ciLogo'
import { createSampleProject } from './sampleProject'

const START = '2026-01-01'

interface CatDef { id: string; name: string; commissioning?: boolean }
interface TaskDef { id: string; cat: string; name: string; start: string; dur: number; milestone?: boolean; sub?: string }

function build(name: string, cats: CatDef[], taskDefs: TaskDef[], links: Array<[string, string]>, opts: { kind?: ProjectKind; rainy?: boolean } = {}): Project {
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
    kind: opts.kind ?? 'construction',
    startDate: START,
    paper: { size: 'A1', orientation: 'landscape', marginMm: 10, dpi: 150, fitToPage: true },
    view: {
      pxPerDay: 1.5, rowHeight: 46, labelWidth: 150, headerHeight: 56, scale: 'month',
      showCriticalPath: true, showFloat: false, showGrid: true, showTitle: true, textStyles: {},
    },
    categories,
    tasks: consistent,
    links: lk,
    // Design-phase schedules don't model 우기 shading; construction does.
    rainySeasons: opts.rainy === false ? [] : [{ id: 'rs-1', label: '우기', startMonth: 6, startDay: 1, endMonth: 9, endDay: 30, efficiency: 0.7 }],
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

// ── 설계 단계 프리셋 (설계 공정표) ─────────────────────────────────────────────
// 타당성조사
const FEAS_CATS: CatDef[] = [
  { id: 'cf-plan', name: '계획' }, { id: 'cf-survey', name: '조사·분석' },
  { id: 'cf-review', name: '검토' }, { id: 'cf-report', name: '보고' },
]
const FEAS_TASKS: TaskDef[] = [
  { id: 'f-0', cat: 'cf-plan', name: '◆ 착수', start: '2026-01-06', dur: 0, milestone: true },
  { id: 'f-1', cat: 'cf-plan', name: '과업착수·계획', start: '2026-01-06', dur: 15 },
  { id: 'f-2', cat: 'cf-survey', name: '자료조사·현황분석', start: '2026-01-26', dur: 40 },
  { id: 'f-3', cat: 'cf-survey', name: '수요·입지 검토', start: '2026-03-10', dur: 30 },
  { id: 'f-4', cat: 'cf-review', name: '기술적 타당성(개략)', start: '2026-04-10', dur: 35 },
  { id: 'f-5', cat: 'cf-review', name: '경제성 분석(B/C)', start: '2026-04-10', dur: 30 },
  { id: 'f-6', cat: 'cf-review', name: '환경·재해 검토', start: '2026-05-01', dur: 25 },
  { id: 'f-7', cat: 'cf-report', name: '종합·보고서 작성', start: '2026-05-25', dur: 25 },
  { id: 'f-8', cat: 'cf-report', name: '◆ 최종보고', start: '2026-06-22', dur: 0, milestone: true },
]
const FEAS_LINKS: Array<[string, string]> = [['f-1', 'f-2'], ['f-2', 'f-3'], ['f-3', 'f-4'], ['f-3', 'f-5'], ['f-4', 'f-6'], ['f-5', 'f-7'], ['f-6', 'f-7'], ['f-7', 'f-8']]

// 기본설계
const BASIC_CATS: CatDef[] = [
  { id: 'cb-plan', name: '계획' }, { id: 'cb-survey', name: '조사·측량' },
  { id: 'cb-design', name: '기본설계' }, { id: 'cb-permit', name: '인허가' }, { id: 'cb-deliv', name: '심의·납품' },
]
const BASIC_TASKS: TaskDef[] = [
  { id: 'b-0', cat: 'cb-plan', name: '◆ 착수', start: '2026-01-06', dur: 0, milestone: true },
  { id: 'b-1', cat: 'cb-plan', name: '착수계·과업계획', start: '2026-01-06', dur: 15 },
  { id: 'b-2', cat: 'cb-survey', name: '측량·지반·수문조사', start: '2026-01-26', dur: 50 },
  { id: 'b-3', cat: 'cb-design', name: '기본구상·대안비교', start: '2026-03-20', dur: 35 },
  { id: 'b-4', cat: 'cb-design', name: '◆ 대안 확정', start: '2026-04-25', dur: 0, milestone: true },
  { id: 'b-5', cat: 'cb-design', name: '기본설계(수리·구조)', start: '2026-04-27', dur: 55 },
  { id: 'b-6', cat: 'cb-design', name: '개략 공사비·공정', start: '2026-06-22', dur: 25 },
  { id: 'b-7', cat: 'cb-permit', name: '인허가 협의', start: '2026-05-27', dur: 45 },
  { id: 'b-8', cat: 'cb-deliv', name: '중간심의', start: '2026-07-20', dur: 20 },
  { id: 'b-9', cat: 'cb-deliv', name: '성과품 작성', start: '2026-08-10', dur: 30 },
  { id: 'b-10', cat: 'cb-deliv', name: '◆ 납품', start: '2026-09-09', dur: 0, milestone: true },
]
const BASIC_LINKS: Array<[string, string]> = [['b-1', 'b-2'], ['b-2', 'b-3'], ['b-3', 'b-4'], ['b-4', 'b-5'], ['b-5', 'b-6'], ['b-3', 'b-7'], ['b-6', 'b-8'], ['b-8', 'b-9'], ['b-9', 'b-10']]

// 실시설계
const DETAIL_CATS: CatDef[] = [
  { id: 'cd-plan', name: '계획' }, { id: 'cd-survey', name: '조사·측량' }, { id: 'cd-design', name: '설계' },
  { id: 'cd-draw', name: '도면·내역' }, { id: 'cd-permit', name: '인허가' }, { id: 'cd-deliv', name: '심의·납품' },
]
const DETAIL_TASKS: TaskDef[] = [
  { id: 'd-0', cat: 'cd-plan', name: '◆ 착수', start: '2026-01-06', dur: 0, milestone: true },
  { id: 'd-1', cat: 'cd-plan', name: '착수계·과업계획', start: '2026-01-06', dur: 15 },
  { id: 'd-2', cat: 'cd-survey', name: '추가조사·측량', start: '2026-01-26', dur: 45 },
  { id: 'd-3', cat: 'cd-design', name: '실시설계(본체)', start: '2026-03-15', dur: 70 },
  { id: 'd-4', cat: 'cd-design', name: '실시설계(부대)', start: '2026-05-01', dur: 55 },
  { id: 'd-5', cat: 'cd-design', name: '구조·수리 상세계산', start: '2026-05-25', dur: 45 },
  { id: 'd-6', cat: 'cd-draw', name: '도면 작성', start: '2026-06-20', dur: 75 },
  { id: 'd-7', cat: 'cd-draw', name: '◆ 도면 완료', start: '2026-09-05', dur: 0, milestone: true },
  { id: 'd-8', cat: 'cd-draw', name: '시방서·내역서', start: '2026-08-10', dur: 40 },
  { id: 'd-9', cat: 'cd-draw', name: '수량산출·적산', start: '2026-09-06', dur: 40 },
  { id: 'd-10', cat: 'cd-draw', name: '◆ 적산 완료', start: '2026-10-18', dur: 0, milestone: true },
  { id: 'd-11', cat: 'cd-permit', name: '인허가·관계기관 협의', start: '2026-07-01', dur: 60 },
  { id: 'd-12', cat: 'cd-deliv', name: '최종심의·보완', start: '2026-10-20', dur: 30 },
  { id: 'd-13', cat: 'cd-deliv', name: '◆ 성과품 납품', start: '2026-11-20', dur: 0, milestone: true },
]
const DETAIL_LINKS: Array<[string, string]> = [['d-1', 'd-2'], ['d-2', 'd-3'], ['d-3', 'd-4'], ['d-3', 'd-5'], ['d-4', 'd-6'], ['d-5', 'd-6'], ['d-6', 'd-7'], ['d-6', 'd-8'], ['d-8', 'd-9'], ['d-9', 'd-10'], ['d-3', 'd-11'], ['d-10', 'd-12'], ['d-12', 'd-13']]

// ── 사업 유형(단계) 메타 + 프리셋 ─────────────────────────────────────────────
export const KIND_META: Record<ProjectKind, { label: string; icon: string; scheduleLabel: string }> = {
  feasibility: { label: '타당성조사', icon: '🔎', scheduleLabel: '설계 공정표' },
  'basic-design': { label: '기본설계', icon: '📐', scheduleLabel: '설계 공정표' },
  'detailed-design': { label: '실시설계', icon: '📑', scheduleLabel: '설계 공정표' },
  construction: { label: '시공', icon: '🏗️', scheduleLabel: '시공 공정표' },
}

export interface ProjectTypeDef {
  kind: ProjectKind
  label: string
  icon: string
  scheduleLabel: string
  desc: string
  highlights: string[]
  make: () => Project
}

export const PROJECT_TYPES: ProjectTypeDef[] = [
  { kind: 'feasibility', ...KIND_META.feasibility,
    desc: '사업 추진 여부 판단 — 개략 검토·경제성·환경 중심',
    highlights: ['자료조사·현황분석', '수요·입지', '경제성(B/C)', '환경·재해', '종합보고서'],
    make: () => build('타당성조사 공정표', FEAS_CATS, FEAS_TASKS, FEAS_LINKS, { kind: 'feasibility', rainy: false }) },
  { kind: 'basic-design', ...KIND_META['basic-design'],
    desc: '기본구상·대안비교 + 기본설계 + 개략공사비',
    highlights: ['측량·지반·수문', '대안비교', '기본설계', '인허가 협의', '심의·납품'],
    make: () => build('기본설계 공정표', BASIC_CATS, BASIC_TASKS, BASIC_LINKS, { kind: 'basic-design', rainy: false }) },
  { kind: 'detailed-design', ...KIND_META['detailed-design'],
    desc: '실시설계·상세도면·시방·적산·인허가',
    highlights: ['실시설계', '상세 도면', '시방서·내역', '수량·적산', '인허가·심의'],
    make: () => build('실시설계 공정표', DETAIL_CATS, DETAIL_TASKS, DETAIL_LINKS, { kind: 'detailed-design', rainy: false }) },
  { kind: 'construction', ...KIND_META.construction,
    desc: '착공~준공 시공 공정 + 시운전 (마일스톤·CPM·우기 음영)',
    highlights: ['가설·가물막이', '본체·부대공', '시운전', '우기 음영', '주공정'],
    make: () => { const p = createSampleProject(); p.id = `proj-${nanoid(8)}`; p.kind = 'construction'; return p } },
]
