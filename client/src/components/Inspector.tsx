// Right panel — context-sensitive properties. Shows the text-style editor when
// a chart text is selected, else the selected activity / link editor, else the
// project / paper / 우기 settings.

import type { ChangeEvent } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { standardDurationIndex } from '../data/facilities'
import { findStandardRate, STANDARD_RATE_OPTIONS } from '../data/standardRates'
import { assessConstructionPeriod, assessTaskAdequacy, normWorkName } from '../engine/adequacy'
import { dateToDay, daysInMonth, dayToDate, parseISO, toISO } from '../engine/dates'
import {
  computeLayout,
  fitToPaperView,
  monthWidthFromPxPerDay,
  pxPerDayFromMonthWidth,
} from '../engine/layout'
import { PAPER_SIZES, paperMm } from '../engine/paper'
import { type EditImpact, previewEdit } from '../engine/scheduling'
import type { InspectorTab } from '../state/store'
import { useEditor } from '../state/store'
import { FONT_FAMILY_OPTIONS, TEXT_ROLE_DEFAULTS, TEXT_ROLE_LABELS } from '../styles/theme'
import type { LinkStyle, LinkType, PaperSize, PeriodInputs, Task, TextRole } from '../types/model'
import { PALETTE_MAX } from '../types/model'
import { EditImpactCard } from './EditImpactCard'
import { Modal } from './Modal'

/** 4개 속성 탭(요구사항 3) — 도면·프로젝트 / 텍스트 / 공정 / 연결. SAMPLE.png 형태,
 *  색은 현 Sequence 크림/오렌지. 차트에서 항목을 클릭하면 해당 탭으로 자동 전환된다. */
const INSPECTOR_TABS: { key: InspectorTab; label: string }[] = [
  { key: 'project', label: '도면·프로젝트' },
  { key: 'text', label: '텍스트' },
  { key: 'task', label: '공정 속성' },
  { key: 'link', label: '연결 속성' },
]

/** 적정성 판정 뱃지 색 — engine/adequacy.ts 판정값별. */
const VERDICT_COLOR: Record<string, string> = {
  적정: '#1f9d63',
  과소: '#c33b3b',
  과다: '#c98a1b',
  판정불가: '#8a94a0',
}

export function Inspector({ width }: { width: number }) {
  const tab = useEditor((s) => s.inspectorTab)
  const selectedTaskId = useEditor((s) => s.selectedTaskId)
  const selectedLinkId = useEditor((s) => s.selectedLinkId)
  const selectedTextRole = useEditor((s) => s.selectedTextRole)
  const a = useEditor.getState

  return (
    <aside className="panel panel--right" style={{ width }}>
      <div className="insp-tabs" role="tablist" aria-label="속성 설정">
        {INSPECTOR_TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`insp-tab ${tab === t.key ? 'active' : ''}`}
            title={`${t.label} 설정`}
            onClick={() => a().setInspectorTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="panel__scroll">
        {tab === 'project' ? (
          <ProjectInspector />
        ) : tab === 'text' ? (
          selectedTextRole ? (
            <TextStyleInspector role={selectedTextRole} />
          ) : (
            <TextRolePicker />
          )
        ) : tab === 'task' ? (
          selectedTaskId ? (
            <TaskInspector id={selectedTaskId} />
          ) : (
            <SelectHint kind="task" />
          )
        ) : selectedLinkId ? (
          <LinkInspector id={selectedLinkId} />
        ) : (
          <SelectHint kind="link" />
        )}
      </div>
    </aside>
  )
}

/** 텍스트 탭에서 아직 대상 글자를 안 골랐을 때 — 스타일을 바꿀 텍스트 종류 목록. */
function TextRolePicker() {
  const a = useEditor.getState
  const roles = Object.keys(TEXT_ROLE_LABELS) as TextRole[]
  return (
    <>
      <div className="field">
        <label>텍스트 스타일</label>
        <p className="note">
          스타일을 바꿀 텍스트 종류를 고르거나, 차트에서 글자를 직접 클릭하세요.
        </p>
      </div>
      <div className="role-list">
        {roles.map((r) => (
          <button
            key={r}
            type="button"
            className="role-list__item"
            onClick={() => a().selectTextRole(r)}
          >
            {TEXT_ROLE_LABELS[r]}
          </button>
        ))}
      </div>
    </>
  )
}

/** 공정/연결 탭에서 선택된 항목이 없을 때 안내. */
function SelectHint({ kind }: { kind: 'task' | 'link' }) {
  return (
    <div className="empty-hint">
      {kind === 'task'
        ? '차트나 왼쪽 공종 구성에서 공정(막대·마일스톤)을 클릭하면 여기에서 속성을 편집할 수 있습니다.'
        : '차트에서 연결(화살표)을 클릭하면 여기에서 관계·지연·선 스타일을 편집할 수 있습니다.'}
    </div>
  )
}

/** Number input that commits on blur / Enter (not per keystroke) so multi-digit
 *  entry isn't clamped mid-typing — same guard as the zoom field. */
function PtInput({
  value,
  min,
  max,
  onCommit,
  maxWidth,
  disabled,
}: {
  value: number
  min: number
  max: number
  onCommit: (v: number) => void
  maxWidth?: number
  disabled?: boolean
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => {
    setText(String(value))
  }, [value])
  function commit() {
    const v = Number(text)
    if (Number.isFinite(v) && v > 0) {
      // Reflect the actually-applied (clamped) value even when the store ref
      // doesn't change — e.g. typing >max while already at max.
      const clamped = Math.max(min, Math.min(max, v))
      setText(String(clamped))
      onCommit(clamped)
    } else {
      setText(String(value))
    }
  }
  return (
    <input
      className="input"
      type="number"
      min={min}
      max={max}
      step={1}
      disabled={disabled}
      style={maxWidth ? { maxWidth } : undefined}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}

/** 물량 등 실수 입력 — blur/Enter에서 커밋. 빈 값이면 undefined(미입력)로 지운다. */
function FloatField({
  value,
  onCommit,
  placeholder,
  id,
}: {
  value?: number
  onCommit: (v: number | undefined) => void
  placeholder?: string
  /** 라벨(htmlFor)과 연결할 input id — 지정하면 접근성 연결이 만들어진다. */
  id?: string
}) {
  const [text, setText] = useState(value == null ? '' : String(value))
  useEffect(() => {
    setText(value == null ? '' : String(value))
  }, [value])
  function commit() {
    const t = text.trim()
    if (t === '') {
      onCommit(undefined)
      return
    }
    const v = Number(t)
    if (Number.isFinite(v) && v >= 0) onCommit(v)
    else setText(value == null ? '' : String(value))
  }
  return (
    <input
      className="input"
      id={id}
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}

function TextStyleInspector({ role }: { role: TextRole }) {
  const styles = useEditor((s) => s.project.view.textStyles)
  const showTitle = useEditor((s) => s.project.view.showTitle) !== false
  const a = useEditor.getState
  const d = TEXT_ROLE_DEFAULTS[role]
  const cur = styles?.[role] ?? {}
  const size = cur.fontSize ?? d.fontSize
  const color = cur.color ?? d.color
  const family = cur.fontFamily ?? ''

  return (
    <>
      <div className="field">
        <label>대상 텍스트</label>
        <div style={{ fontSize: 13, color: 'var(--charcoal)', fontWeight: 600, padding: '4px 0' }}>
          {TEXT_ROLE_LABELS[role]}
        </div>
        <p className="note">차트에서 같은 종류의 텍스트 전체에 적용됩니다.</p>
      </div>
      {role === 'title' && (
        <label className="toggle" style={{ display: 'flex', marginBottom: 10 }}>
          <input type="checkbox" checked={showTitle} onChange={() => a().toggleTitle()} />
          상단 중앙에 도면 제목 표시
        </label>
      )}
      <div className="field-row">
        <div className="field">
          <label>글자 크기 (pt)</label>
          <PtInput
            value={size}
            min={6}
            max={120}
            onCommit={(v) => a().setTextStyle(role, { fontSize: v })}
          />
        </div>
        <div className="field" style={{ maxWidth: 64 }}>
          <label>색상</label>
          <input
            className="input"
            style={{ padding: 2 }}
            type="color"
            value={color}
            onChange={(e) => a().setTextStyle(role, { color: e.target.value })}
          />
        </div>
      </div>
      <div className="field">
        <label>글꼴</label>
        <select
          className="select"
          value={family}
          onChange={(e) => a().setTextStyle(role, { fontFamily: e.target.value || undefined })}
        >
          <option value="">기본 글꼴</option>
          {FONT_FAMILY_OPTIONS.map((f) => (
            <option key={f.label} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
        <button
          className="btn btn--sm"
          style={{ flex: 1 }}
          onClick={() => a().resetTextStyle(role)}
        >
          기본값 초기화
        </button>
        <button
          className="btn btn--sm"
          style={{ flex: 1 }}
          onClick={() => a().selectTextRole(null)}
        >
          ← 텍스트 목록
        </button>
      </div>
      <p className="note">
        차트의 다른 텍스트(제목·공정명·축 등)를 클릭하면 그 텍스트 스타일 편집으로 전환됩니다.
      </p>
    </>
  )
}

function TaskInspector({ id }: { id: string }) {
  const project = useEditor((s) => s.project)
  const pro = useEditor((s) => s.uiMode) === 'pro'
  const selectedTaskIds = useEditor((s) => s.selectedTaskIds)
  const editMode = useEditor((s) => s.editMode)
  const autoCascade = useEditor((s) => s.autoCascade)
  // 시작일·기간을 **직접 입력**할 때는 커밋 전에 영향(지연 변경·후행 이동·준공)을 먼저 보여준다.
  const [pending, setPending] = useState<{ patch: Partial<Task>; impact: EditImpact } | null>(null)
  const task = project.tasks.find((t) => t.id === id)
  const a = useEditor.getState
  // ② 표준대비 판정에 쓸 시설물 표준 템플릿 공기(일). 훅이므로 early return 앞에서 구한다.
  const standardDuration = useMemo(() => {
    if (!task || task.isMilestone) return undefined
    const std = standardDurationIndex(project.facility).get(normWorkName(task.name))
    return typeof std === 'number' ? std : undefined
  }, [project.facility, task])
  if (!task) return <div className="empty-hint">선택된 공정이 없습니다.</div>

  /** 일정 필드(시작일·기간) 입력 — 영향이 있으면 확인창을 먼저 띄우고, 없으면 바로 반영. */
  const commitSchedulePatch = (patch: Partial<Task>) => {
    const imp = previewEdit(
      project.tasks,
      project.links,
      { id, start: patch.start, duration: patch.duration },
      editMode,
      autoCascade,
    )
    if (imp && (imp.lagChanges.length > 0 || imp.successorMoves.length > 0 || imp.clamped)) {
      setPending({ patch, impact: imp })
      return
    }
    a().updateTask(id, patch)
  }

  // 색상 변경은 다중 선택 시 **선택된 공정 모두**에 적용(단일이면 그 하나만).
  const multiSel = selectedTaskIds.length > 1
  const applyColor = (color: string, opts?: { history?: boolean }) => {
    if (multiSel) a().setTasksColor(selectedTaskIds, color, opts)
    else a().updateTask(id, { color }, opts)
  }

  const startISO = toISO(dayToDate(project.startDate, task.start))
  const finishISO = toISO(dayToDate(project.startDate, task.start + task.duration))
  const currentColor =
    task.color ?? project.categories.find((c) => c.id === task.categoryId)?.color ?? '#7c93a8'
  const palette = project.palette ?? []
  // 물량 기반 공기 적정성(법정 산정식) — 마일스톤은 기간 개념이 없어 제외.
  // ② 표준대비는 표준 템플릿 공기를 넘겨야 판정된다. 넘기지 않으면 화면에선 영원히 null 이
  // 되어 검토요청서(export/reviewRequest)와 판정이 어긋난다 — 같은 색인(standardDurationIndex)을 쓴다.
  // 허용 편차도 같은 이유로 사용자 입력(periodInputs.tolerancePct)을 그대로 넘긴다.
  const adq = task.isMilestone
    ? null
    : assessTaskAdequacy(task, {
        standardDuration,
        tolerancePct: project.periodInputs?.tolerancePct,
      })

  return (
    <>
      <div className="field">
        <label>이름</label>
        <input
          className="input"
          value={task.name}
          onChange={(e) => a().updateTask(id, { name: e.target.value })}
        />
      </div>
      <div className="field">
        <label>공종</label>
        <select
          className="select"
          value={task.categoryId}
          onChange={(e) => a().updateTask(id, { categoryId: e.target.value })}
        >
          {project.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>세부공종 (선택)</label>
        <input
          className="input"
          value={task.subName ?? ''}
          placeholder="예: 상류 가물막이"
          onChange={(e) => a().updateTask(id, { subName: e.target.value }, { history: false })}
        />
      </div>
      <div className="field-row">
        <div className="field">
          <label>시작일</label>
          <input
            className="input"
            type="date"
            value={startISO}
            onChange={(e) =>
              e.target.value &&
              commitSchedulePatch({ start: dateToDay(project.startDate, parseISO(e.target.value)) })
            }
          />
        </div>
        <div className="field" style={{ maxWidth: 96 }}>
          <label>기간(일)</label>
          <PtInput
            value={task.duration}
            min={1}
            max={100000}
            disabled={task.isMilestone}
            onCommit={(v) => commitSchedulePatch({ duration: v })}
          />
        </div>
      </div>
      {pending && (
        <Modal
          title="변경 영향 확인"
          sub="이 편집이 실제로 무엇을 바꾸는지 먼저 확인하세요."
          width={460}
          onClose={() => setPending(null)}
          footer={(close) => (
            <>
              <button type="button" className="btn" onClick={close}>
                취소
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  a().updateTask(id, pending.patch)
                  a().setLastEditImpact(pending.impact)
                  setPending(null)
                }}
              >
                적용
              </button>
            </>
          )}
        >
          <EditImpactCard impact={pending.impact} startDate={project.startDate} />
        </Modal>
      )}
      <div className="field">
        <label className="toggle">
          <input
            type="checkbox"
            checked={task.isMilestone}
            onChange={() => a().toggleMilestone(id)}
          />
          마일스톤(◆)으로 표시
        </label>
      </div>
      {!task.isMilestone && (
        <div className="field">
          <label className="toggle">
            <input type="checkbox" checked={!!task.isDummy} onChange={() => a().toggleDummy(id)} />
            DUMMY(가상·연결) 공정 — 공종색 60% 투명
          </label>
          <p className="note">
            막대 위에서 <b>우클릭</b>으로도 켜고 끌 수 있습니다.
          </p>
        </div>
      )}
      {pro && (
        <div className="field">
          <label>주공정(Critical Path)</label>
          <select
            className="select"
            value={task.forceCritical === undefined ? 'auto' : task.forceCritical ? 'on' : 'off'}
            onChange={(e) => {
              const v = e.target.value
              a().updateTask(id, { forceCritical: v === 'auto' ? undefined : v === 'on' })
            }}
          >
            <option value="auto">자동 (CPM 계산)</option>
            <option value="on">주공정으로 지정</option>
            <option value="off">주공정 제외</option>
          </select>
        </div>
      )}
      <div className="field-row">
        <div className="field" style={{ maxWidth: 64 }}>
          <label>색상</label>
          <input
            className="input"
            style={{ padding: 2 }}
            type="color"
            value={currentColor}
            onChange={(e) => applyColor(e.target.value, { history: false })}
          />
        </div>
        <div className="field">
          <label>종료일</label>
          <input className="input" value={finishISO} disabled />
        </div>
      </div>
      {multiSel && (
        <p className="note" style={{ marginTop: 0 }}>
          공정 <b>{selectedTaskIds.length}개</b>가 선택되어 있어 색상은 선택된 공정 전체에
          적용됩니다.
        </p>
      )}

      <div className="field">
        <label>Palette · 즐겨찾기 (최대 {PALETTE_MAX})</label>
        <div className="palette">
          {Array.from({ length: PALETTE_MAX }).map((_, i) => {
            const c = palette[i]
            return c ? (
              <button
                key={i}
                type="button"
                className="palette__sw"
                style={{ background: c }}
                title={`${c} · 클릭 적용 / 우클릭 삭제`}
                onClick={() => applyColor(c)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  a().removePaletteColor(i)
                }}
              />
            ) : (
              <button
                key={i}
                type="button"
                className="palette__sw palette__sw--empty"
                title="현재 색상을 즐겨찾기에 추가"
                onClick={() => a().addPaletteColor(currentColor)}
              >
                ＋
              </button>
            )
          })}
        </div>
        <p className="note">
          색을 클릭하면 이 공정에 적용됩니다. 빈 칸 ＋ 로 현재 색을 저장(최대 {PALETTE_MAX}개),
          우클릭으로 삭제합니다.
        </p>
      </div>

      <div
        style={{
          background: 'var(--cream)',
          borderRadius: 8,
          padding: '10px 12px',
          margin: '6px 0 12px',
          fontSize: 12,
          color: 'var(--slate)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>여유(Float)</span>
          <strong>{task.totalFloat ?? 0}일</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>주공정 여부</span>
          <span
            className="badge"
            style={task.critical ? { background: 'var(--primary)', color: '#fff' } : {}}
          >
            {task.critical ? '주공정(Critical)' : '여유 있음'}
          </span>
        </div>
      </div>

      {adq && (
        <div
          style={{
            border: '1px solid var(--hairline)',
            borderRadius: 8,
            padding: '10px 12px',
            margin: '6px 0 12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--charcoal)' }}>
              물량 · 공기 적정성
            </span>
            <span
              className="badge"
              style={{ background: '#3b6ea5', color: '#fff', fontSize: 10, fontWeight: 700 }}
            >
              법정 산정기준
            </span>
          </div>
          <div className="field-row">
            <div className="field">
              <label>물량(수량)</label>
              <FloatField
                value={task.quantity}
                placeholder="예: 1200"
                onCommit={(v) => a().updateTask(id, { quantity: v }, { history: false })}
              />
            </div>
            <div className="field" style={{ maxWidth: 84 }}>
              <label>단위</label>
              <input
                className="input"
                value={task.unit ?? ''}
                placeholder={adq.unitCheck.rateUnit ?? '㎥'}
                style={
                  adq.unitCheck.status === 'mismatch'
                    ? { borderColor: VERDICT_COLOR.과소, background: '#fdf3f2' }
                    : undefined
                }
                onChange={(e) =>
                  a().updateTask(id, { unit: e.target.value || undefined }, { history: false })
                }
              />
            </div>
          </div>
          {adq.unitCheck.status === 'mismatch' && (
            <p className="note" style={{ marginTop: 0, color: VERDICT_COLOR.과소 }}>
              ⚠ {adq.unitCheck.message} 표준 단위 «{adq.unitCheck.rateUnit}» 로 바꾸거나 공종코드를
              다시 선택하세요.
            </p>
          )}
          {adq.unitCheck.status === 'missing' && adq.unitCheck.rateUnit && (
            <p className="note" style={{ marginTop: 0 }}>
              단위 미입력 — 표준 단위 «{adq.unitCheck.rateUnit}» 기준으로 <b>가정</b>해 계산합니다.
            </p>
          )}
          <div className="field">
            <label>표준 일작업량 (가이드라인 부록4 공종)</label>
            <select
              className="select"
              value={task.workCode ?? ''}
              onChange={(e) => {
                const code = e.target.value || undefined
                const rate = findStandardRate(code)
                a().updateTask(
                  id,
                  { workCode: code, ...(rate ? { unit: rate.unit } : {}) },
                  { history: false },
                )
              }}
            >
              <option value="">(미지정)</option>
              {STANDARD_RATE_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div
            style={{
              fontSize: 11.5,
              lineHeight: 1.55,
              color: 'var(--slate)',
              background: 'var(--cream)',
              borderRadius: 6,
              padding: '8px 10px',
              marginTop: 4,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 6,
              }}
            >
              <span style={{ fontWeight: 600 }}>적정성 판정</span>
              <span
                className="badge"
                style={{ color: '#fff', background: VERDICT_COLOR[adq.verdict], fontWeight: 700 }}
              >
                {adq.verdict}
              </span>
            </div>
            {adq.theoretical != null ? (
              <div style={{ marginBottom: 6 }}>
                현 공기 <b>{adq.current}일</b> · 이론 작업일수 <b>{adq.theoretical}일</b>
                {adq.deviationPct != null && (
                  <>
                    {' · 편차 '}
                    <b
                      style={{
                        color:
                          adq.verdict === '적정'
                            ? 'var(--primary-deep)'
                            : VERDICT_COLOR[adq.verdict],
                      }}
                    >
                      {adq.deviationPct > 0 ? '+' : ''}
                      {adq.deviationPct}%
                    </b>
                  </>
                )}
              </div>
            ) : (
              <div style={{ marginBottom: 6, color: 'var(--stone)' }}>
                물량과 표준 일작업량을 연결하면 이론 작업일수가 자동 계산됩니다.
              </div>
            )}
            {adq.standardDeviationPct != null && standardDuration != null && (
              <div style={{ marginBottom: 6 }}>
                표준 템플릿 공기 <b>{standardDuration}일</b> 대비{' '}
                <b style={{ color: VERDICT_COLOR[adq.verdict] }}>
                  {adq.standardDeviationPct > 0 ? '+' : ''}
                  {adq.standardDeviationPct}%
                </b>{' '}
                <span style={{ color: 'var(--stone)' }}>(② 표준대비)</span>
              </div>
            )}
            <div style={{ borderTop: '1px dashed var(--hairline)', paddingTop: 6 }}>
              {adq.basis.map((b, i) => (
                <div key={i} style={{ margin: '2px 0' }}>
                  · {b}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 변경 이력(F13)의 **수동** 진입점. 키 입력마다 결재를 만들지 않기 위해, 사용자가 스스로
          '이건 남길 변경이다' 라고 판단한 순간에만 1건을 기록한다. 결과는 변경이력·확정본 모듈에서. */}
      <button
        type="button"
        className="btn"
        style={{ width: '100%', marginBottom: 6 }}
        title="이 공정의 현재 기간·시작일을 사유와 함께 변경 이력에 남깁니다(변경이력·확정본 모듈에서 조회)"
        onClick={() => {
          if (typeof window === 'undefined') return
          const reason = window.prompt(`'${task.name}' 변경 사유를 적어주세요`)
          if (!reason?.trim()) return
          a().appendChange({
            kind: task.isMilestone ? 'schedule' : 'duration',
            taskIds: [id],
            summary: `${task.name} — 시작 ${startISO} · ${task.duration}일`,
            reason: reason.trim(),
          })
        }}
      >
        ✎ 변경 사유 남기기
      </button>
      <button className="btn" style={{ width: '100%' }} onClick={() => a().deleteTask(id)}>
        공정 삭제
      </button>
      <p className="note">
        바를 드래그해 이동하고, 선택 후 <b>막대 앞·뒤 끝의 동그라미</b>를 다른 공정의 앞/뒤로 끌어
        연결합니다(끝점 조합으로 FS/SS/FF/SF 자동 결정). 차트의 글자를 클릭하면 글꼴·크기·색을 바꿀
        수 있습니다.
      </p>
    </>
  )
}

function LinkInspector({ id }: { id: string }) {
  const project = useEditor((s) => s.project)
  const link = project.links.find((l) => l.id === id)
  const a = useEditor.getState
  if (!link) return <div className="empty-hint">선택된 연결이 없습니다.</div>
  const from = project.tasks.find((t) => t.id === link.from)
  const to = project.tasks.find((t) => t.id === link.to)
  // 두께 슬라이더 기본값을 실제 자동 두께(주공정 2·그 외 1.3)에 맞춰 표시(미지정 시 렌더와 일치).
  const autoWidth = from?.critical && to?.critical ? 2 : 1.3

  return (
    <>
      <div className="field">
        <label>연결</label>
        <div style={{ fontSize: 13, color: 'var(--charcoal)', padding: '6px 0' }}>
          {from?.name ?? '?'} <span style={{ color: 'var(--primary)' }}>→</span> {to?.name ?? '?'}
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>관계</label>
          <select
            className="select"
            value={link.type}
            onChange={(e) => a().updateLink(id, { type: e.target.value as LinkType })}
          >
            <option value="FS">FS · 종료-시작</option>
            <option value="SS">SS · 시작-시작</option>
            <option value="FF">FF · 종료-종료</option>
            <option value="SF">SF · 시작-종료</option>
          </select>
        </div>
        <div className="field" style={{ maxWidth: 90 }}>
          <label>지연(일)</label>
          <input
            className="input"
            type="number"
            value={link.lag}
            onChange={(e) => a().updateLink(id, { lag: Number(e.target.value) })}
          />
        </div>
      </div>
      <div className="field">
        <label>화살표 선 스타일</label>
        <select
          className="select"
          value={link.style ?? 'auto'}
          onChange={(e) => {
            const v = e.target.value
            a().updateLink(id, { style: v === 'auto' ? undefined : (v as LinkStyle) })
          }}
        >
          <option value="auto">자동 (주공정 실선·그 외 파선)</option>
          <option value="solid">─── 실선</option>
          <option value="dashed">– – – 파선</option>
          <option value="dotted">····· 점선</option>
        </select>
      </div>
      <div className="field">
        <label>
          화살표 선 두께{' '}
          <span style={{ color: 'var(--stone)', fontWeight: 400 }}>
            {(link.width ?? autoWidth).toFixed(1)}px{link.width == null ? ' (자동)' : ''}
          </span>
        </label>
        <input
          type="range"
          min={1}
          max={8}
          step={0.5}
          value={link.width ?? autoWidth}
          onChange={(e) => a().updateLink(id, { width: Number(e.target.value) })}
          aria-label="화살표 선 두께"
          style={{ width: '100%', accentColor: 'var(--primary)' }}
        />
      </div>
      <label className="toggle" style={{ display: 'flex', marginBottom: 8 }}>
        <input
          type="checkbox"
          checked={link.showDummy !== false}
          onChange={(e) => a().updateLink(id, { showDummy: e.target.checked })}
        />
        연결 음영(DUMMY) 표시
      </label>
      <p className="note" style={{ marginTop: 0 }}>
        같은 줄에서 연결된 두 공정 <b>사이 빈 구간</b>을 공종색 옅게 채우는 음영입니다. 끄면 그
        구간을 비웁니다(다른 줄로 이어지는 연결에는 영향 없음).
      </p>
      <button className="btn" style={{ width: '100%' }} onClick={() => a().deleteLink(id)}>
        연결 삭제
      </button>
    </>
  )
}

function ProjectInspector() {
  const project = useEditor((s) => s.project)
  const a = useEditor.getState
  const fontScale = project.view.fontScale ?? 1
  const monthWidth = Math.round(monthWidthFromPxPerDay(project.view.pxPerDay))
  // Margin the letterbox fit would leave = how far the drawing aspect is from
  // the sheet. Paper selection preserves the editing density; the explicit fit
  // button below is the only action that rewrites the time/row scale.
  const fitState = useMemo(() => {
    const m = computeLayout(project)
    const { w, h } = paperMm(project.paper.size, project.paper.orientation)
    const offPct = Math.round((Math.abs(m.contentWidth / m.contentHeight - w / h) / (w / h)) * 100)
    // canFit = whether "맞춤" would actually change anything — so the button never
    // advertises a margin it can't remove (e.g. at the density clamp limits).
    const patch = fitToPaperView(project, w, h)
    const canFit =
      patch.pxPerDay !== undefined || patch.rowHeight !== undefined || patch.fontScale !== undefined
    return { offPct, canFit }
  }, [project])
  function setSheet(patch: { size?: PaperSize; orientation?: 'landscape' | 'portrait' }) {
    a().setPaper(patch)
  }
  const rainy = project.rainySeasons[0]
  const logos = project.branding?.logos ?? []
  // ③ 법정준수(총공기) — 지금까지는 .md 로 내보내야만 볼 수 있었던 산정 결과를 화면에서 바로 본다.
  const periodInputs = project.periodInputs
  const cp = useMemo(
    () =>
      assessConstructionPeriod({
        tasks: project.tasks,
        links: project.links,
        rainySeasons: project.rainySeasons,
        startDate: project.startDate,
        prepDays: periodInputs?.prepDays,
        cleanupDays: periodInputs?.cleanupDays,
        holidayDays: periodInputs?.holidayDays,
        weatherDays: periodInputs?.weatherDays,
        tolerancePct: periodInputs?.tolerancePct,
      }),
    [project.tasks, project.links, project.rainySeasons, project.startDate, periodInputs],
  )
  /** 전제 1건 수정 — periodInputs 는 통째로 교체되므로 기존 값을 펼쳐 넘긴다. */
  function setPeriod(patch: Partial<PeriodInputs>): void {
    a().setProjectMeta({ periodInputs: { ...periodInputs, ...patch } })
  }

  function onUploadLogo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      window.alert('CI 이미지는 2MB 이하만 추가할 수 있습니다.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const src = reader.result
      if (typeof src !== 'string') return
      // Size the default box to the image's own aspect ratio.
      const probe = new Image()
      probe.onload = () => {
        const w = 168
        const ratio = probe.naturalWidth ? probe.naturalHeight / probe.naturalWidth : 0.36
        a().addLogo(src, w, Math.max(24, Math.round(w * ratio)))
      }
      probe.onerror = () => a().addLogo(src)
      probe.src = src
    }
    reader.readAsDataURL(file)
  }

  return (
    <>
      <div className="field">
        <label>프로젝트 착수일 (Day 0)</label>
        <input
          className="input"
          type="date"
          value={project.startDate}
          onChange={(e) => e.target.value && a().setProjectMeta({ startDate: e.target.value })}
        />
      </div>

      <div style={{ height: 1, background: 'var(--hairline)', margin: '8px 0 14px' }} />
      <div className="panel__title" style={{ marginBottom: 10 }}>
        공기 산정 전제
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="pi-prep">준비기간(일)</label>
          <FloatField
            id="pi-prep"
            value={periodInputs?.prepDays}
            placeholder="30 (가정)"
            onCommit={(v) => setPeriod({ prepDays: v })}
          />
        </div>
        <div className="field">
          <label htmlFor="pi-cleanup">정리기간(일)</label>
          <FloatField
            id="pi-cleanup"
            value={periodInputs?.cleanupDays}
            placeholder="30 (가정)"
            onCommit={(v) => setPeriod({ cleanupDays: v })}
          />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="pi-holiday">법정공휴일수(일)</label>
          <FloatField
            id="pi-holiday"
            value={periodInputs?.holidayDays}
            placeholder="0 (가정 · 부록1)"
            onCommit={(v) => setPeriod({ holidayDays: v })}
          />
        </div>
        <div className="field">
          <label htmlFor="pi-weather">기상 공사불능일수(일)</label>
          <FloatField
            id="pi-weather"
            value={periodInputs?.weatherDays}
            placeholder="우기밴드 추정"
            onCommit={(v) => setPeriod({ weatherDays: v })}
          />
        </div>
      </div>
      <div className="field" style={{ maxWidth: 140 }}>
        <label htmlFor="pi-tol">허용 편차(±%)</label>
        <FloatField
          id="pi-tol"
          value={periodInputs?.tolerancePct}
          placeholder="15 (기본값)"
          onCommit={(v) => setPeriod({ tolerancePct: v })}
        />
      </div>
      <p className="note" style={{ marginTop: 0 }}>
        미입력 항목은 기본 가정값(준비 30 · 정리 30 · 공휴일 0 · 허용편차 ±15%)으로 계산되며, 아래
        산정 결과와 AI 검토요청서에 <b>‘가정 기반 참고값’</b>으로 표기됩니다. 허용편차 ±15%는
        「산정기준」의 법정 수치가 아니라 이 제품의 기본 허용치입니다.
      </p>

      <div
        style={{
          border: '1px solid var(--hairline)',
          borderRadius: 8,
          padding: '10px 12px',
          margin: '6px 0 12px',
          fontSize: 12,
          color: 'var(--slate)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--charcoal)' }}>
            ③ 법정 산정 총공기
          </span>
          <span
            className="badge"
            style={{ color: '#fff', background: VERDICT_COLOR[cp.verdict], fontWeight: 700 }}
          >
            {cp.verdict}
          </span>
        </div>
        {cp.assumed && (
          <div
            style={{
              background: '#fbf1dc',
              border: '1px solid #f0d9a8',
              borderRadius: 6,
              padding: '6px 8px',
              color: '#8a5a12',
              marginBottom: 8,
            }}
          >
            ⚠ <b>가정 기반 참고값</b> — 미입력 전제가 있어 확정(법정) 판정이 아닙니다. 위 전제를
            입력하면 그대로 산정에 반영됩니다.
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>
            준비 {cp.parts.prep} + 비작업 {cp.parts.nonWork} + 작업 {cp.parts.work} + 정리{' '}
            {cp.parts.cleanup}
          </span>
          <strong>{cp.legalTotal}일</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>현재 계획 공기(달력)</span>
          <strong>
            {cp.actualSpan}일
            {cp.deviationPct != null
              ? ` (${cp.deviationPct > 0 ? '+' : ''}${cp.deviationPct}%)`
              : ''}
          </strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
          <span>작업량 합계(주공정 {cp.criticalCount}개 총합 · 병렬 포함)</span>
          <strong>{cp.workSum}일</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>경과 작업공기(선후행망 최장경로)</span>
          <strong>{cp.workSpan}일</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>
            비작업일수(주말 {cp.nonWork.weekend} + 기상 {cp.nonWork.weather} + 공휴일{' '}
            {cp.nonWork.holiday} − 중복 {cp.nonWork.overlap})
          </span>
          <strong>{cp.nonWork.total}일</strong>
        </div>
        {cp.unitIssueCount > 0 && (
          <div style={{ color: VERDICT_COLOR.과소, marginTop: 4 }}>
            ⚠ 단위 불일치 {cp.unitIssueCount}개 공종은 물량 산정에서 제외(현 공기로 근사) — 공정
            속성에서 단위를 정정하세요.
          </div>
        )}
        <div style={{ borderTop: '1px dashed var(--hairline)', marginTop: 6, paddingTop: 6 }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>산정 전제</div>
          {cp.assumptions.map((as) => (
            <div key={as.key} style={{ margin: '2px 0' }}>
              · {as.label} {as.value}
              {as.key === 'tolerance' ? '%' : '일'}{' '}
              <span style={{ color: as.source === 'default' ? '#8a5a12' : 'var(--stone)' }}>
                ({as.source === 'default' ? '가정' : '입력'} · {as.note})
              </span>
            </div>
          ))}
        </div>
        <details style={{ marginTop: 6 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--stone)' }}>산정 근거 보기</summary>
          <div style={{ marginTop: 4, lineHeight: 1.55 }}>
            {cp.basis.map((b) => (
              <div key={b} style={{ margin: '2px 0' }}>
                · {b}
              </div>
            ))}
          </div>
        </details>
      </div>

      <div style={{ height: 1, background: 'var(--hairline)', margin: '8px 0 14px' }} />
      <div className="panel__title" style={{ marginBottom: 10 }}>
        도면 / 용지
      </div>
      <div className="field-row">
        <div className="field">
          <label>용지 규격</label>
          <select
            className="select"
            value={project.paper.size}
            onChange={(e) => setSheet({ size: e.target.value as PaperSize })}
          >
            {PAPER_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>방향</label>
          <select
            className="select"
            value={project.paper.orientation}
            onChange={(e) => setSheet({ orientation: e.target.value as 'landscape' | 'portrait' })}
          >
            <option value="landscape">가로</option>
            <option value="portrait">세로</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label>
          월 폭{' '}
          <span style={{ color: 'var(--stone)', fontWeight: 400 }}>{monthWidth}px</span>
        </label>
        <input
          type="range"
          min={8}
          max={600}
          step={2}
          value={monthWidth}
          onChange={(e) =>
            a().setView({ pxPerDay: pxPerDayFromMonthWidth(Number(e.target.value)) })
          }
          aria-label="월 폭"
          style={{ width: '100%', accentColor: 'var(--primary)' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="note" style={{ margin: 0 }}>
            좁게 · 전체 기간 확인
          </span>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => a().setView({ pxPerDay: 1.5 })}
          >
            기본 46px
          </button>
          <span className="note" style={{ margin: 0 }}>
            넓게 · 세부 편집
          </span>
        </div>
      </div>
      <div className="field">
        <label>
          글자 크기{' '}
          <span style={{ color: 'var(--stone)', fontWeight: 400 }}>
            {Math.round(fontScale * 100)}%
          </span>
        </label>
        <input
          type="range"
          min={50}
          max={600}
          step={10}
          value={Math.round(fontScale * 100)}
          onChange={(e) => a().setView({ fontScale: Number(e.target.value) / 100 })}
          aria-label="글자 크기 배율"
          style={{ width: '100%', accentColor: 'var(--primary)' }}
        />
      </div>
      {!fitState.canFit ? (
        fitState.offPct <= 1 ? (
          <p className="note" style={{ color: 'var(--primary-deep)' }}>
            ✓ 용지 비율에 맞아 여백 없이 출력됩니다.
          </p>
        ) : (
          <p className="note">
            여백 약 {fitState.offPct}% — 용지 방향/규격을 바꾸면 더 줄일 수 있습니다.
          </p>
        )
      ) : (
        <div className="field">
          <button
            className="btn btn--sm"
            style={{ width: '100%' }}
            title="도면 비율을 용지에 맞춰 여백 없이 채우고 글자 크기를 조정"
            onClick={() => {
              a().beginGesture()
              a().fitToPaper()
              a().endGesture()
            }}
          >
            ⤢ 여백 없이 시트에 맞추기
            {fitState.offPct > 1 ? ` (현재 여백 약 ${fitState.offPct}%)` : ''}
          </button>
        </div>
      )}
      <p className="note">
        용지·방향을 바꿔도 월 폭과 행 높이는 유지됩니다. 필요할 때만 위 버튼으로 시트 비율을
        맞추세요. 출력 해상도(DPI)는 <b>도면 출력</b> 창에서 정합니다.
      </p>

      <div style={{ height: 1, background: 'var(--hairline)', margin: '8px 0 14px' }} />
      <div className="panel__title" style={{ marginBottom: 10 }}>
        표시 옵션
      </div>
      <label className="toggle" style={{ display: 'flex', marginBottom: 8 }}>
        <input
          type="checkbox"
          checked={project.view.showCriticalPath}
          onChange={(e) => a().setView({ showCriticalPath: e.target.checked })}
        />
        주공정(Critical Path) 강조
      </label>
      <label className="toggle" style={{ display: 'flex', marginBottom: 8 }}>
        <input
          type="checkbox"
          checked={project.view.showGrid}
          onChange={(e) => a().setView({ showGrid: e.target.checked })}
        />
        행 구분선(가로 격자) 표시
      </label>
      <label className="toggle" style={{ display: 'flex', marginBottom: 8 }}>
        <input
          type="checkbox"
          checked={project.view.taskColumn !== false}
          onChange={(e) => a().setView({ taskColumn: e.target.checked })}
        />
        공정명을 왼쪽 표(공종 하위)에 표시
      </label>
      <p className="note" style={{ marginTop: 0 }}>
        도면 왼쪽에 공종 아래로 각 공정 이름을 나열합니다(사이드바 ‘공종 구성’처럼). 끄면 공정명이
        막대 위에 표시됩니다. 마일스톤에서 특정 공정을 빼려면 왼쪽 사이드바에서 그 공정의 표시
        스위치를 끄세요.
      </p>

      <div style={{ height: 1, background: 'var(--hairline)', margin: '8px 0 14px' }} />
      <div className="panel__title" style={{ marginBottom: 10 }}>
        공사기간 구분선
      </div>

      {/* 연도 구분선 (제목↔연도 가로선 포함) */}
      <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--charcoal)', marginBottom: 6 }}>
        연도 구분선
      </div>
      <label className="toggle" style={{ display: 'flex', marginBottom: 8 }}>
        <input
          type="checkbox"
          checked={project.view.showYearLine !== false}
          onChange={(e) => a().setView({ showYearLine: e.target.checked })}
        />
        연도 구분선 표시(제목↔연도 가로선 포함)
      </label>
      <div className="field">
        <label>
          선 두께{' '}
          <span style={{ color: 'var(--stone)', fontWeight: 400 }}>
            {(project.view.yearLineWidth ?? 2.5).toFixed(1)}px
          </span>
        </label>
        <input
          type="range"
          min={1}
          max={20}
          step={0.5}
          value={project.view.yearLineWidth ?? 2.5}
          disabled={project.view.showYearLine === false}
          onChange={(e) => a().setView({ yearLineWidth: Number(e.target.value) })}
          aria-label="연도 구분선 두께"
          style={{ width: '100%', accentColor: 'var(--primary)' }}
        />
      </div>

      {/* 월 구분선 */}
      <div
        style={{ fontWeight: 600, fontSize: 12, color: 'var(--charcoal)', margin: '14px 0 6px' }}
      >
        월 구분선
      </div>
      <label className="toggle" style={{ display: 'flex', marginBottom: 8 }}>
        <input
          type="checkbox"
          checked={project.view.showMonthLine !== false}
          onChange={(e) => a().setView({ showMonthLine: e.target.checked })}
        />
        월 구분선 표시
      </label>
      <div className="field">
        <label>
          선 두께{' '}
          <span style={{ color: 'var(--stone)', fontWeight: 400 }}>
            {(project.view.monthLineWidth ?? 1).toFixed(1)}px
          </span>
        </label>
        <input
          type="range"
          min={1}
          max={20}
          step={0.5}
          value={project.view.monthLineWidth ?? 1}
          disabled={project.view.showMonthLine === false}
          onChange={(e) => a().setView({ monthLineWidth: Number(e.target.value) })}
          aria-label="월 구분선 두께"
          style={{ width: '100%', accentColor: 'var(--primary)' }}
        />
      </div>
      <p className="note" style={{ marginTop: 0 }}>
        공사기간을 세로선으로 나눕니다. <b>연도 구분선</b>은 해 경계(+제목↔연도 가로선),{' '}
        <b>월 구분선</b>은 달 경계에 긋습니다. 각각 표시/두께(최대 20px)를 조절할 수 있습니다.
      </p>

      <div style={{ height: 1, background: 'var(--hairline)', margin: '8px 0 14px' }} />
      <div className="panel__title" style={{ marginBottom: 10 }}>
        CI (로고)
      </div>
      <p className="note" style={{ marginTop: 0, marginBottom: 8 }}>
        도면 제목은 차트에서 제목 글자를 클릭해 <b>텍스트</b> 탭에서 편집합니다(표시
        ON/OFF·글꼴·크기·색).
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10, marginTop: 6 }}>
        {logos.map((logo, i) => (
          <div
            key={i}
            style={{
              position: 'relative',
              border: '1px solid var(--hairline-strong)',
              borderRadius: 8,
              padding: 5,
              background: '#fff',
            }}
          >
            <img
              src={logo.src}
              alt={`CI ${i + 1}`}
              style={{ height: 34, maxWidth: 116, objectFit: 'contain', display: 'block' }}
            />
            <button
              className="icon-btn"
              title="삭제"
              style={{
                position: 'absolute',
                top: -9,
                right: -9,
                width: 20,
                height: 20,
                background: 'var(--canvas)',
                border: '1px solid var(--hairline-strong)',
                borderRadius: 9999,
              }}
              onClick={() => a().removeLogo(i)}
            >
              ×
            </button>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 2, marginTop: 4 }}>
              <button
                className="icon-btn"
                title="오른쪽으로 이동"
                disabled={i === 0}
                onClick={() => a().moveLogo(i, -1)}
              >
                ◀
              </button>
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--stone)',
                  minWidth: 30,
                  textAlign: 'center',
                  lineHeight: '24px',
                }}
              >
                {logo.w}×{logo.h}
              </span>
              <button
                className="icon-btn"
                title="왼쪽으로 이동"
                disabled={i === logos.length - 1}
                onClick={() => a().moveLogo(i, 1)}
              >
                ▶
              </button>
            </div>
          </div>
        ))}
      </div>
      <label className="btn btn--sm" style={{ cursor: 'pointer' }}>
        ＋ CI 이미지 추가
        <input
          type="file"
          accept="image/png,image/jpeg,image/gif,image/svg+xml"
          hidden
          onChange={onUploadLogo}
        />
      </label>
      <p className="note">
        우측 하단에 표시되며 도면 출력(PNG·JPG·PDF·SVG)에 함께 포함됩니다. 도면 위에서 좌하단 모서리
        핸들을 드래그해 크기를 조절하고, ◀▶ 로 배치 순서를 바꿉니다. (PNG·JPG·GIF·SVG, 2MB 이하)
      </p>

      <div style={{ height: 1, background: 'var(--hairline)', margin: '8px 0 14px' }} />
      <div className="panel__title" style={{ marginBottom: 10 }}>
        우기(雨期) 보정
      </div>
      {rainy ? (
        <>
          <div className="field-row">
            <div className="field">
              <label>시작 월</label>
              <select
                className="select"
                value={rainy.startMonth}
                onChange={(e) => {
                  const m = Number(e.target.value)
                  a().setRainySeason({
                    startMonth: m,
                    startDay: Math.min(rainy.startDay, daysInMonth(2001, m - 1)),
                  })
                }}
              >
                {months()}
              </select>
            </div>
            <div className="field" style={{ maxWidth: 76 }}>
              <label>시작 일</label>
              <PtInput
                value={rainy.startDay}
                min={1}
                max={daysInMonth(2001, rainy.startMonth - 1)}
                onCommit={(v) => a().setRainySeason({ startDay: v })}
              />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>종료 월</label>
              <select
                className="select"
                value={rainy.endMonth}
                onChange={(e) => {
                  const m = Number(e.target.value)
                  a().setRainySeason({
                    endMonth: m,
                    endDay: Math.min(rainy.endDay, daysInMonth(2001, m - 1)),
                  })
                }}
              >
                {months()}
              </select>
            </div>
            <div className="field" style={{ maxWidth: 76 }}>
              <label>종료 일</label>
              <PtInput
                value={rainy.endDay}
                min={1}
                max={daysInMonth(2001, rainy.endMonth - 1)}
                onCommit={(v) => a().setRainySeason({ endDay: v })}
              />
            </div>
          </div>
          {/* 우기 작업효율 — 기상 비작업일수(= 우기 평일 × (1−효율))를 좌우하는 값이라
              모델·store 에만 있고 편집 UI 가 없으면 산정 결과를 손댈 방법이 없다. */}
          <div className="field">
            <label htmlFor="rainy-eff">
              우기 작업효율{' '}
              <span style={{ color: 'var(--stone)', fontWeight: 400 }}>
                {Math.round((rainy.efficiency ?? 1) * 100)}% · 기상 비작업{' '}
                {Math.round((1 - (rainy.efficiency ?? 1)) * 100)}%
              </span>
            </label>
            <input
              id="rainy-eff"
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round((rainy.efficiency ?? 1) * 100)}
              onChange={(e) => a().setRainySeason({ efficiency: Number(e.target.value) / 100 })}
              aria-label="우기 작업효율"
              style={{ width: '100%', accentColor: 'var(--primary)' }}
            />
            <p className="note" style={{ marginTop: 2 }}>
              우기 구간의 평일 중 <b>(1−효율)</b>만큼을 기상 공사불능일로 산정합니다(효율 100% =
              기상 비작업 0일). 위 <b>공기 산정 전제</b>의 ‘기상 공사불능일수’를 직접 입력하면 그
              값이 우선합니다.
            </p>
          </div>
          <button className="btn btn--sm" onClick={() => a().clearRainySeasons()}>
            우기 제거
          </button>
        </>
      ) : (
        <button
          className="btn btn--sm"
          onClick={() =>
            a().setRainySeason({ startMonth: 6, startDay: 1, endMonth: 9, endDay: 30 })
          }
        >
          ＋ 우기 밴드 추가
        </button>
      )}
      <p className="note">
        우기 구간은 회색 음영으로 표시됩니다(일 단위). 도면에서 <b>밴드 양 끝을 드래그</b>해 조절할
        수 있고, 한 해를 바꾸면 모든 해의 우기가 동일하게 변동됩니다.
      </p>
    </>
  )
}

function months() {
  return Array.from({ length: 12 }, (_, i) => (
    <option key={i + 1} value={i + 1}>
      {i + 1}월
    </option>
  ))
}
