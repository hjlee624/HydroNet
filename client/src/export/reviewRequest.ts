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
import {
  assessConstructionPeriod,
  assessTaskAdequacy,
  DEFAULT_TOLERANCE_PCT,
  findSimilarWorkName,
} from '../engine/adequacy'
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

/** 이미 계산된 편차%를 부호와 함께 표기('+12.3%' · '-8%' · '±0%'). */
function signPct(p: number): string {
  if (p === 0) return '±0%'
  return p > 0 ? `+${p}%` : `${p}%`
}

/** 표준공기 앵커 1건(일수 + 유사 매칭 여부). */
interface StdAnchor {
  days: number
  /** 이름이 정확히 일치하지 않아 토큰 겹침으로 이은 근사 앵커. */
  approx: boolean
  /** 유사 매칭에 쓰인 표준 템플릿 공정명(approx 일 때만). */
  via?: string
}

/**
 * 공정명 → 표준 템플릿 공기. 완전일치가 없으면 **결정론 토큰 겹침**으로 유사 매칭한다
 * ('가물막이 설치' ↔ '상류 가물막이'). 유사 매칭은 approx 로 표시해 근사임을 알린다.
 * front-matter 의 standardDays 에는 **완전일치만** 싣는다(라운드트립 계약 불변).
 */
function resolveStandard(name: string, stdIdx: Map<string, number | null>): StdAnchor | null {
  const exact = stdIdx.get(normName(name))
  if (typeof exact === 'number') return { days: exact, approx: false }
  const keys = [...stdIdx.keys()].filter((k) => typeof stdIdx.get(k) === 'number')
  const hit = findSimilarWorkName(name, keys)
  if (!hit) return null
  const days = stdIdx.get(hit.key)
  return typeof days === 'number' ? { days, approx: true, via: hit.key } : null
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
  // 미해결 문제(순환 의존성)가 있으면 이 일정 자체가 '잠정'이므로 외부 검토자에게 그대로 알린다.
  const sched = computeSchedule(project.tasks, project.links)
  const scheduled = sched.tasks
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

  // 공기 산정 전제 — 표(공정별 판정)와 아래 「법정 산정 근거」가 **같은 허용 편차**를 쓰도록
  // 표를 그리기 전에 꺼내 둔다. 표에 넘기지 않으면 문서 안에서 '허용 편차 5%(입력)' 라고
  // 적어 놓고 각 공정은 15%로 판정하는 자기모순이 생긴다.
  const pi = project.periodInputs
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
  out.push(`unresolvedProblems: ${sched.problems.length}`)
  out.push(`scheduleStatus: ${sched.problems.length > 0 ? 'provisional' : 'final'}`)
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
  // 잠정 상태를 사람이 읽는 본문에도 명시 — front-matter 만으로는 검토자가 놓친다.
  if (sched.problems.length > 0) {
    out.push(
      `- **⚠ 미해결 일정 문제:** ${sched.problems.length}건(순환 의존성) — 아래 일정(시작·종료·주공정)은 **잠정** 산정입니다.`,
    )
    for (const p of sched.problems) out.push(`  - ${p.message}`)
  }
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
  // 표를 그리면서 모으는 주의 항목(단위 불일치·유사 매칭) — 표 아래에 한 번에 알린다.
  const unitIssues: string[] = []
  const approxStd: string[] = []
  out.push('## 공정표 (공기 적정성 검토 대상)')
  out.push('')
  // 표의 「적정성(법정)」 칸이 어떤 허용 편차로 판정됐는지 문서에 명시 — 아래 「산정 전제」와
  // 반드시 같은 값이어야 한다(같은 project.periodInputs.tolerancePct 를 쓴다).
  out.push(
    `> 「적정성(법정)」 판정 허용 편차: **±${pi?.tolerancePct ?? DEFAULT_TOLERANCE_PCT}%**` +
      ` (${pi?.tolerancePct != null ? '사용자 입력' : '제품 기본 가정'}) — 아래 「산정 전제」와 동일한 값입니다.`,
  )
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
      const anchor = resolveStandard(t.name, stdIdx)
      // 유사 매칭은 '≈' 와 매칭된 표준 공정명을 함께 적어, 앵커가 근사임을 LLM 이 알게 한다.
      const stdCell = anchor ? `${anchor.approx ? '≈' : ''}${anchor.days}` : '—'
      const cmp = anchor ? fmtPct(t.duration, anchor.days) : '—'
      const adq = assessTaskAdequacy(sTask, {
        standardDuration: anchor?.days,
        tolerancePct: pi?.tolerancePct,
      })
      const theo = adq.theoretical != null ? String(adq.theoretical) : '—'
      const unitBad = adq.unitCheck.status === 'mismatch'
      if (unitBad)
        unitIssues.push(
          `${normName(t.name)} — 입력 «${adq.unitCheck.taskUnit}» vs 표준 «${adq.unitCheck.rateUnit}»`,
        )
      if (anchor?.approx) approxStd.push(`${normName(t.name)} ← 표준 «${anchor.via}» (유사 매칭)`)
      // 판정이 **근사 앵커(유사 매칭 표준공기)에만 기대어** 내려졌는지 — ①산정식(물량÷생산성)
      // 편차가 없어 ②표준대비로 승격된 경우다. 이때 판정 셀에도 '≈'·'근사 앵커'를 달아,
      // 표준(일) 칸의 '≈' 만 보고 판정은 확정으로 읽는 오독(외부 LLM 포함)을 막는다.
      const approxVerdict =
        !!anchor?.approx && adq.deviationPct == null && adq.standardDeviationPct != null
      const verdictCell = unitBad
        ? '판정불가(⚠단위)'
        : adq.verdict === '판정불가'
          ? '—'
          : `${approxVerdict ? '≈' : ''}${adq.verdict}` +
            (adq.deviationPct != null
              ? ` (${adq.deviationPct > 0 ? '+' : ''}${adq.deviationPct}%${approxVerdict ? ', 근사 앵커' : ''})`
              : approxVerdict
                ? ` (${signPct(adq.standardDeviationPct as number)}, 근사 앵커)`
                : '')
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
    prepDays: pi?.prepDays,
    cleanupDays: pi?.cleanupDays,
    holidayDays: pi?.holidayDays,
    weatherDays: pi?.weatherDays,
    tolerancePct: pi?.tolerancePct,
  })
  out.push('## 공기 적정성 — 법정 산정 근거')
  out.push('')
  if (cp.assumed)
    out.push(
      '> ⚠️ **가정 기반 참고값** — 아래 「산정 전제」 중 사용자가 입력하지 않아 기본 가정값으로 계산한 항목이 있습니다. 확정(법정) 판정이 아니므로 검토 의견에 그 한계를 함께 적어 주세요.',
    )
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
    `- **작업량 합계:** ${cp.workSum}일(주공정 ${cp.criticalCount}개 작업일수 총합 · **병렬 포함**) · ` +
      `**경과 작업공기:** ${cp.workSpan}일(선후행망 최장경로) — 총공기 산정에는 경과 작업공기를 씁니다. 두 값을 합산하거나 혼용하지 마세요.`,
  )
  out.push(
    `- **작업일수 산정:** 주공정 ${cp.criticalCount}개 중 물량기반 산정 ${cp.workByQuantityCount}개(나머지는 현 공기로 근사)`,
  )
  out.push(
    `- **비작업일수:** 주말 ${cp.nonWork.weekend} + 기상 ${cp.nonWork.weather} + 법정공휴일 ${cp.nonWork.holiday} − 중복 ${cp.nonWork.overlap} = ${cp.nonWork.total}일`,
  )
  if (cp.unitIssueCount > 0)
    out.push(
      `- **⚠ 단위 불일치 ${cp.unitIssueCount}개 공종** — 물량 산정에서 제외했습니다(현 공기로 근사). 회신 전 단위를 정정하세요.`,
    )
  out.push('')
  out.push('### 산정 전제')
  out.push('')
  for (const as of cp.assumptions)
    out.push(
      `- ${as.label} **${as.value}${as.key === 'tolerance' ? '%' : '일'}** ` +
        `(${as.source === 'default' ? '가정' : '입력'} · ${escCell(as.note)})`,
    )
  out.push('')
  out.push(
    `> 허용 편차 ±${cp.assumptions.find((a) => a.key === 'tolerance')?.value ?? 15}% 는 이 제품의 기본 허용치이며 「산정기준」이 정한 법정 수치가 아닙니다.`,
  )
  out.push('')
  if (unitIssues.length > 0) {
    out.push('### ⚠ 단위 불일치 공정 (적정성 판정 제외)')
    out.push('')
    out.push(
      '아래 공정은 입력 물량의 단위가 표준 일작업량(부록4)의 단위와 달라 **물량÷생산성이 성립하지 않습니다**. 임의 환산 없이 판정을 보류했으니, 기간 검토 시 이 점을 감안해 주세요.',
    )
    for (const u of unitIssues) out.push(`- ${escCell(u)}`)
    out.push('')
  }
  if (approxStd.length > 0) {
    out.push('### 표준공기 유사 매칭 (근사 앵커)')
    out.push('')
    out.push(
      '아래 공정은 표준 템플릿에 **같은 이름이 없어** 이름이 닮은 공정의 표준공기를 근사 앵커로 붙였습니다(표의 "표준(일)" 앞 `≈` 표시). 정확한 동일 공종이 아닐 수 있으니 참고값으로만 쓰세요.',
    )
    for (const s of approxStd) out.push(`- ${escCell(s)}`)
    out.push('')
  }
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
