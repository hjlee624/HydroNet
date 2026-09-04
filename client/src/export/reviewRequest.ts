// AI 검토 라운드트립 — 1단계(export). ADR-003 §4·§5.
//
// 현재 공정표를 '공기(공사기간) 적정성 검토요청' 마크다운(.md)으로 내보낸다. 사용자가 이
// 파일을 GPT/Gemini/Claude 등 외부 LLM 에 붙여넣어 검토받는 용도다. 이 단계는 프로젝트를
// **읽기만** 하며 어떤 상태도 바꾸지 않는다(read-only, 위험 0).
//
// 정본(회신)은 사용자가 받아올 ```sequence-review 펜스(JSONL)이며 그 반영(import)은 2단계.
// 여기서 각 공정에는 안정적인 원본 id 를 [[id:<원본 전체 id>]] 로 심어(접두사·하이픈 포함
// 그대로) 왕복 매핑을 결정적으로 만든다(ADR-003 §9-①).

import { facilityLabel, standardDurationIndex } from '../data/facilities'
import { assessConstructionPeriod, assessTaskAdequacy } from '../engine/adequacy'
import { dayToDate, toISO } from '../engine/dates'
import { computeSchedule } from '../engine/scheduling'
import { reviewFingerprint } from '../state/reviewFingerprint'
import type { Project } from '../types/model'

const M = 30 // 개략 1개월 = 30일 (facilities.ts 와 동일 기준)

const pad = (n: number): string => String(n).padStart(2, '0')
const normName = (s: string): string => s.replace(/^◆\s*/, '').replace(/\s+/g, ' ').trim()
const escCell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')
const yamlStr = (s: string): string => JSON.stringify(s ?? '')

function fmtPct(cur: number, std: number): string {
  if (!std) return '—'
  const p = Math.round(((cur - std) / std) * 100)
  return p === 0 ? '±0%' : p > 0 ? `+${p}%` : `${p}%`
}

function isoOffset(d: Date): string {
  const tz = -d.getTimezoneOffset()
  const sign = tz >= 0 ? '+' : '-'
  const hh = pad(Math.floor(Math.abs(tz) / 60))
  const mm = pad(Math.abs(tz) % 60)
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${hh}:${mm}`
  )
}

export function reviewRequestFileName(project: Project): string {
  const base = (project.name || 'Sequence').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Sequence'
  const d = new Date()
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
  return `${base}_공기검토요청_${stamp}.md`
}

const RESPONSE_GUIDE = `## 회신 형식 (반드시 지켜주세요)

검토 의견은 위에 자유롭게 서술하시고, **수정 제안은 이 파일 맨 끝에 아래 형식의 코드블록**으로 넣어주세요.

**규칙**
1. 코드블록 언어태그는 정확히 \`sequence-review\` (백틱 3개로 여닫기). **이 블록은 파일 전체에 정확히 1개만.**
2. 한 줄에 완전한 JSON 1개(JSONL). 주석·후행쉼표·설명문 금지.
3. \`id\` 는 표의 \`[[id:…]]\` 안의 값을 **그대로** 복사(변형·정규화 금지).
4. \`field\` 는 \`"duration"\` 만. 값(\`to\`)은 **정수 '일'**(개월·주·범위·소수 금지 — 개월 환산은 \`reason\` 에만).
5. \`from\` 은 표의 "현재공기"와 **동일하게** 적어주세요(불일치 시 앱이 그 항목을 무시합니다).
6. **바꿀 값이 있는 공정만** 넣으세요. 마일스톤(◆)·공정 신설/삭제/이동은 금지입니다.

**예시** — 실제 회신은 아래처럼 쓰되, 언어태그는 반드시 \`sequence-review\` 로 바꿔주세요:
\`\`\`jsonl
{"id":"<표의 [[id:…]] 값>","field":"duration","from":180,"to":210,"reason":"우기 간섭 대비 저타설 여유 부족"}
\`\`\`

> ⚠️ **중요:** \`sequence-review\` 코드블록이 **없거나 2개 이상**이면 앱이 자동 반영하지 못합니다.`

/** 검토요청 .md 문자열 생성(순수 함수, read-only). */
export function buildReviewRequestMd(project: Project): string {
  const startDate = project.startDate
  const stdIdx = standardDurationIndex(project.facility)
  // CPM 계산으로 주공정(critical) 을 확정 — 표의 주공정 표기·적정성 판정(주공정선 한정)이 실측 기반이 된다.
  const scheduled = computeSchedule(project.tasks, project.links).tasks
  const critById = new Map(scheduled.map((t) => [t.id, t] as const))
  const tasks = project.tasks
  const work = tasks.filter((t) => !t.isMilestone)
  const milestones = tasks
    .filter((t) => t.isMilestone)
    .slice()
    .sort((a, b) => a.start - b.start)

  const durationsById: Array<[string, number]> = []
  const standardById: Array<[string, number]> = []
  for (const t of work) {
    durationsById.push([t.id, t.duration])
    const std = stdIdx.get(normName(t.name))
    if (typeof std === 'number') standardById.push([t.id, std])
  }

  const totalDays = tasks.reduce((m, t) => Math.max(m, t.start + t.duration), 0)
  const cats = [...project.categories].sort((a, b) => a.order - b.order)
  const catCount = cats.filter((c) => work.some((t) => t.categoryId === c.id)).length
  const label = facilityLabel(project.facility) || '미지정'

  const out: string[] = []

  // ── [1] front-matter (기계 메타) ──
  out.push('---')
  out.push('sequence_review_request: v1')
  out.push(`projectId: ${yamlStr(project.id)}`)
  out.push(`activeSheetId: ${yamlStr(project.activeSheet?.id ?? '')}`)
  out.push(`sheetRole: ${project.activeSheet?.role ?? 'plan'}`)
  out.push(`reviewFingerprint: ${yamlStr(reviewFingerprint(project))}`)
  out.push('unit: integer-days')
  out.push(`exportedAt: ${yamlStr(isoOffset(new Date()))}`)
  out.push('taskDurations:')
  for (const [id, d] of durationsById) out.push(`  ${yamlStr(id)}: ${d}`)
  out.push('standardDays:')
  for (const [id, d] of standardById) out.push(`  ${yamlStr(id)}: ${d}`)
  out.push('---')
  out.push('')

  // ── [2] 상단 지시문 ──
  out.push(`# 공기(공사기간) 적정성 검토 요청 — ${escCell(project.name || 'Sequence')}`)
  out.push('')
  out.push(
    '> 🤖 **AI 검토 요청** — 아래 공정표의 각 공정 **공사기간(일)** 이 적정한지 검토해 주세요.',
  )
  out.push(
    '> - 이 파일의 **법정 산정 근거·이론작업일수(물량÷생산성)·표준공기·현재공기·주공정**을 근거로 판단하세요(일반 지식보다 이 파일 우선).',
  )
  out.push('> - **공정 신설·삭제·이동·병합 금지.** 기존 공정의 기간만 검토합니다.')
  out.push('> - 수정 제안은 **파일 맨 끝의 「회신 형식」** 대로만 작성하세요.')
  out.push('')

  // ── [3] 프로젝트 컨텍스트 ──
  out.push('## 프로젝트 개요')
  out.push('')
  out.push(`- **사업명:** ${escCell(project.name || '(무제)')}`)
  out.push(`- **시설물 유형:** ${escCell(label)}`)
  out.push(`- **착수일(Day 0):** ${startDate}`)
  out.push(`- **총 공사기간:** 약 ${totalDays}일 (≈ ${Math.round(totalDays / M)}개월)`)
  out.push(`- **검토 대상:** 공정 ${work.length}개 · 공종 ${catCount}개`)
  if (stdIdx.size > 0)
    out.push(
      `- **표준공기 기준:** 시설물 «${escCell(label)}» 표준 템플릿 (개략 1개월 = 30일). 표의 "표준(일)"·"표준대비" 참고.`,
    )
  else
    out.push(
      '- **표준공기 기준:** 없음(사용자 정의 시설물) — 유사 실적·공학적 판단으로 검토해 주세요.',
    )
  out.push('')

  // ── 마일스톤(참고) ──
  if (milestones.length > 0) {
    out.push('### 주요 마일스톤 (참고 · 검토 대상 아님)')
    out.push('')
    for (const m of milestones)
      out.push(`- ◆ ${escCell(normName(m.name))} — ${toISO(dayToDate(startDate, m.start))}`)
    out.push('')
  }

  // ── [4] 공정표 본표 (공종별) ──
  out.push('## 공정표 (공기 적정성 검토 대상)')
  out.push('')
  for (const c of cats) {
    const rows = work.filter((t) => t.categoryId === c.id)
    if (rows.length === 0) continue
    out.push(`### 공종 · ${escCell(c.name)}`)
    out.push('')
    out.push(
      '| 공정 | 현재공기(일) | 이론작업일수(일) | 적정성(법정) | 시작 | 종료 | 주공정 | 표준(일) | 표준대비 | ID |',
    )
    out.push('|---|---:|---:|:---:|---|---|:---:|---:|---:|---|')
    for (const t of rows) {
      const sTask = critById.get(t.id) ?? t
      const name = (t.parentId ? '└ ' : '') + normName(t.name)
      const start = toISO(dayToDate(startDate, t.start))
      const end = toISO(dayToDate(startDate, t.start + t.duration))
      const crit = sTask.critical ? '●' : ''
      const std = stdIdx.get(normName(t.name))
      const stdCell = typeof std === 'number' ? String(std) : '—'
      const cmp = typeof std === 'number' ? fmtPct(t.duration, std) : '—'
      const adq = assessTaskAdequacy(sTask, {
        standardDuration: typeof std === 'number' ? std : undefined,
      })
      const theo = adq.theoretical != null ? String(adq.theoretical) : '—'
      const verdictCell =
        adq.verdict === '판정불가'
          ? '—'
          : `${adq.verdict}${adq.deviationPct != null ? ` (${adq.deviationPct > 0 ? '+' : ''}${adq.deviationPct}%)` : ''}`
      out.push(
        `| ${escCell(name)} | ${t.duration} | ${theo} | ${verdictCell} | ${start} | ${end} | ${crit} | ${stdCell} | ${cmp} | \`[[id:${t.id}]]\` |`,
      )
    }
    out.push('')
  }

  // ── [4b] 공기 적정성 — 법정 산정 근거(뉴로-심볼릭: 결정론 엔진이 계산한 근거를 LLM에 제공) ──
  const cp = assessConstructionPeriod({
    tasks: project.tasks,
    links: project.links,
    rainySeasons: project.rainySeasons,
    startDate: project.startDate,
  })
  out.push('## 공기 적정성 — 법정 산정 근거')
  out.push('')
  out.push(
    '> 아래는 「공공 건설공사의 공사기간 산정기준」(국토부고시 제2024-1021호)에 따른 **결정론 산정 결과**입니다. 일반 지식이 아니라 **이 근거를 우선**으로 각 공정과 전체 공기의 적정성을 판단하세요.',
  )
  out.push('')
  out.push(
    `- **법정 산정 총공기:** 준비 ${cp.parts.prep} + 비작업 ${cp.parts.nonWork} + 작업 ${cp.parts.work} + 정리 ${cp.parts.cleanup} = **${cp.legalTotal}일**`,
  )
  out.push(
    `- **현재 계획 공기(달력):** ${cp.actualSpan}일` +
      (cp.deviationPct != null
        ? ` — 법정 대비 ${cp.deviationPct > 0 ? '+' : ''}${cp.deviationPct}% · **${cp.verdict}**`
        : ''),
  )
  out.push(
    `- **작업일수:** 주공정 ${cp.criticalCount}개 중 물량기반 산정 ${cp.workByQuantityCount}개(나머지는 현 공기로 근사)`,
  )
  out.push(
    `- **비작업일수:** 주말 ${cp.nonWork.weekend} + 기상(우기밴드) ${cp.nonWork.weather} + 법정공휴일 ${cp.nonWork.holiday} = ${cp.nonWork.total}일`,
  )
  out.push('')
  for (const b of cp.basis) out.push(`  - ${escCell(b)}`)
  out.push('')

  // ── [5] 하단 지시문(회신 형식) ──
  out.push('---')
  out.push('')
  out.push(RESPONSE_GUIDE)
  out.push('')

  return out.join('\n')
}

const MD_TYPES = [{ description: 'AI 검토 요청(Markdown)', accept: { 'text/markdown': ['.md'] } }]

/** 검토요청 .md 를 사용자가 고른 경로(또는 다운로드)로 저장. read-only. */
export async function downloadReviewRequest(project: Project): Promise<void> {
  if (project.tasks.filter((t) => !t.isMilestone).length === 0) {
    if (typeof window !== 'undefined')
      window.alert('검토할 공정이 없습니다. 공정을 먼저 추가한 뒤 AI 검토를 요청하세요.')
    return
  }
  const md = buildReviewRequestMd(project)
  await saveText(md, reviewRequestFileName(project))
}

async function saveText(text: string, filename: string): Promise<void> {
  const w = window as unknown as {
    showSaveFilePicker?: (opts?: unknown) => Promise<{
      createWritable: () => Promise<{
        write: (d: string) => Promise<void>
        close: () => Promise<void>
      }>
    }>
  }
  if (typeof window !== 'undefined' && typeof w.showSaveFilePicker === 'function') {
    try {
      const handle = await w.showSaveFilePicker({ suggestedName: filename, types: MD_TYPES })
      const writable = await handle.createWritable()
      await writable.write(text)
      await writable.close()
      return
    } catch (e) {
      if ((e as { name?: string } | null)?.name === 'AbortError') return
      // 그 외(file:// 보안 제한 등) → 아래 다운로드 폴백
    }
  }
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
