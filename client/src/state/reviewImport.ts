// AI 검토 라운드트립 — 2단계(import) 파서·검증. ADR-003 §6·§7. 순수(store 비의존).
//
// 외부 LLM 이 회신한 .md 에서 **유일한** ```sequence-review 펜스(JSONL)만 정본으로 파싱하고,
// 현재 프로젝트를 진실로 삼아 델타별 ok/stale/rejected 를 판정한다. 자유 서술 본문은 무시한다.
//
// 안전 원칙: 반영(store.applyReviewDeltas)은 오직 taskId 로 찾은 공정의 duration 만 건드리므로,
// 델타에 start/parentId/link 같은 위험 키가 섞여 들어와도 **반영 경로에서 무력**하다(inert).
// 여기서는 그 위에 형식·범위·존재·stale 게이트를 더한다.

import type { Project } from '../types/model'

export interface ReviewDelta {
  taskId: string
  field: 'duration'
  from: number
  to: number
  reason?: string
  basis?: string
}

export type DeltaVerdict = 'ok' | 'stale' | 'rejected'

export interface ReviewItem {
  delta: ReviewDelta
  verdict: DeltaVerdict
  /** 사람이 읽는 사유/경고(rejected·stale 일 때). */
  note?: string
  taskName?: string
  categoryName?: string
  currentDuration?: number
}

export type DegradeKind =
  | 'no-fence'
  | 'multi-fence'
  | 'empty'
  | 'project-mismatch'
  | 'sheet-mismatch'

export interface ReviewPlan {
  /** null 이면 정상(자동반영 가능). 값이 있으면 저하 — 자동반영 중단, 원문을 사람이 검토. */
  degraded: DegradeKind | null
  message: string
  items: ReviewItem[]
  fenceCount: number
  brokenLines: number
}

const unquote = (s: string): string =>
  s
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .replace(/^'(.*)'$/, '$1')

/** front-matter 최상위 스칼라(projectId·activeSheetId)만 뽑는다. 없으면 빈 객체. */
function parseFrontMatter(text: string): { projectId?: string; activeSheetId?: string } {
  const m = text.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return {}
  const fm: { projectId?: string; activeSheetId?: string } = {}
  for (const line of m[1].split(/\r?\n/)) {
    const mm = line.match(/^(projectId|activeSheetId):\s*(.*)$/)
    if (mm) fm[mm[1] as 'projectId' | 'activeSheetId'] = unquote(mm[2])
  }
  return fm
}

/** ```sequence-review … ``` 펜스 본문들(언어태그 대소문자·앞뒤 공백·백틱/틸드 관대). */
function extractFenceBodies(text: string): string[] {
  const re =
    /(?:^|\n)[ \t]*(`{3,}|~{3,})[ \t]*sequence-review[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\1[ \t]*(?=\r?\n|$)/gi
  const bodies: string[] = []
  let m: RegExpExecArray | null
  // biome-ignore lint/suspicious/noAssignInExpressions: 표준 exec 루프
  while ((m = re.exec(text)) !== null) bodies.push(m[2])
  return bodies
}

/** 펜스 본문(JSONL)을 관대하게 파싱 — 깨진 줄만 버리고 나머지는 살린다(부분 성공). */
function parseJsonl(body: string): { objs: Record<string, unknown>[]; broken: number } {
  const objs: Record<string, unknown>[] = []
  let broken = 0
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim().replace(/,\s*$/, '') // 후행 쉼표 관대 허용
    if (!line || line.startsWith('//') || line.startsWith('#')) continue
    try {
      const o = JSON.parse(line) as unknown
      if (o && typeof o === 'object' && !Array.isArray(o)) objs.push(o as Record<string, unknown>)
      else broken++
    } catch {
      broken++
    }
  }
  return { objs, broken }
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v))

/** 회신 .md → 검증된 반영 계획. 현재 project 를 진실로 삼는다. */
export function buildReviewPlan(project: Project, text: string): ReviewPlan {
  const bodies = extractFenceBodies(text)
  const base = (degraded: DegradeKind, message: string): ReviewPlan => ({
    degraded,
    message,
    items: [],
    fenceCount: bodies.length,
    brokenLines: 0,
  })

  if (bodies.length === 0)
    return base(
      'no-fence',
      'sequence-review 코드블록을 찾지 못했습니다. LLM 회신에 형식이 빠졌을 수 있어요 — 아래 원문을 직접 확인하세요.',
    )
  if (bodies.length > 1)
    return base(
      'multi-fence',
      `sequence-review 코드블록이 ${bodies.length}개입니다. 정확히 1개여야 자동 반영할 수 있어요.`,
    )

  const fm = parseFrontMatter(text)
  if (fm.projectId && project.id && fm.projectId !== project.id)
    return base('project-mismatch', '다른 프로젝트의 검토본입니다(projectId 불일치).')
  const activeSheetId = project.activeSheet?.id
  if (fm.activeSheetId && activeSheetId && fm.activeSheetId !== activeSheetId)
    return base(
      'sheet-mismatch',
      '다른 시트(예정공정표/마일스톤)의 검토본입니다 — 해당 시트로 전환한 뒤 반영하세요.',
    )

  const { objs, broken } = parseJsonl(bodies[0])
  if (objs.length === 0)
    return base('empty', 'sequence-review 블록에서 반영할 항목을 읽지 못했습니다(형식 확인 필요).')

  const byId = new Map(project.tasks.map((t) => [t.id, t]))
  const catName = new Map(project.categories.map((c) => [c.id, c.name]))
  const items: ReviewItem[] = []

  for (const o of objs) {
    const taskId = typeof o.taskId === 'string' ? o.taskId : ''
    const reject = (delta: ReviewDelta, note: string): void => {
      items.push({ delta, verdict: 'rejected', note })
    }
    const delta: ReviewDelta = {
      taskId,
      field: 'duration',
      from: num(o.from),
      to: num(o.to),
      reason: typeof o.reason === 'string' ? o.reason : undefined,
      basis: typeof o.basis === 'string' ? o.basis : undefined,
    }

    if (!taskId) {
      reject(delta, '형식 오류: taskId 없음')
      continue
    }
    if (o.field !== 'duration') {
      reject(delta, 'MVP는 duration(공기)만 반영합니다')
      continue
    }
    if (!Number.isFinite(delta.to)) {
      reject(delta, 'to 값이 없거나 숫자가 아님')
      continue
    }
    const to = Math.round(delta.to)
    if (to < 1) {
      reject(delta, 'to 는 1일 이상이어야 함')
      continue
    }
    delta.to = to
    const task = byId.get(taskId)
    if (!task) {
      reject(delta, '알 수 없는 공정 — export 이후 삭제/재생성되었을 수 있음')
      continue
    }
    const meta = {
      taskName: task.name.replace(/^◆\s*/, ''),
      categoryName: catName.get(task.categoryId),
      currentDuration: task.duration,
    }
    if (task.isMilestone) {
      items.push({ delta, verdict: 'rejected', note: '마일스톤은 공기를 바꿀 수 없음', ...meta })
      continue
    }
    if (to === task.duration) {
      items.push({ delta, verdict: 'rejected', note: '현재 값과 동일(변경 없음)', ...meta })
      continue
    }
    if (Number.isFinite(delta.from) && delta.from !== task.duration) {
      items.push({
        delta,
        verdict: 'stale',
        note: `export 이후 이 공정이 ${task.duration}일로 바뀌었습니다 — 확인 후 선택하세요`,
        ...meta,
      })
      continue
    }
    items.push({ delta, verdict: 'ok', ...meta })
  }

  const okCount = items.filter((i) => i.verdict === 'ok').length
  return {
    degraded: null,
    message: `반영 가능 ${okCount}건 · 확인 필요 ${items.filter((i) => i.verdict === 'stale').length}건 · 제외 ${items.filter((i) => i.verdict === 'rejected').length}건`,
    items,
    fenceCount: 1,
    brokenLines: broken,
  }
}
