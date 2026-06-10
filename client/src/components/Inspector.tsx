// Right panel — context-sensitive properties. Shows the text-style editor when
// a chart text is selected, else the selected activity / link editor, else the
// project / paper / 우기 settings.

import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useEditor } from '../state/store'
import { dateToDay, dayToDate, parseISO, toISO } from '../engine/dates'
import { PAPER_SIZES, DPI_OPTIONS } from '../engine/paper'
import { PALETTE_MAX } from '../types/model'
import type { LinkType, PaperSize, TextRole } from '../types/model'
import { TEXT_ROLE_DEFAULTS, TEXT_ROLE_LABELS, FONT_FAMILY_OPTIONS } from '../styles/theme'

export function Inspector({ width }: { width: number }) {
  const selectedTaskId = useEditor((s) => s.selectedTaskId)
  const selectedLinkId = useEditor((s) => s.selectedLinkId)
  const selectedTextRole = useEditor((s) => s.selectedTextRole)

  const heading = selectedTextRole ? '텍스트 스타일'
    : selectedTaskId ? '공정 속성'
      : selectedLinkId ? '연결 속성'
        : '도면 · 프로젝트'

  return (
    <aside className="panel panel--right" style={{ width }}>
      <div className="panel__header">
        <span className="panel__title">{heading}</span>
      </div>
      <div className="panel__scroll">
        {selectedTextRole ? <TextStyleInspector role={selectedTextRole} />
          : selectedTaskId ? <TaskInspector id={selectedTaskId} />
            : selectedLinkId ? <LinkInspector id={selectedLinkId} />
              : <ProjectInspector />}
      </div>
    </aside>
  )
}

/** Number input that commits on blur / Enter (not per keystroke) so multi-digit
 *  entry isn't clamped mid-typing — same guard as the zoom field. */
function PtInput({ value, min, max, onCommit, maxWidth, disabled }: {
  value: number; min: number; max: number; onCommit: (v: number) => void; maxWidth?: number; disabled?: boolean
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => { setText(String(value)) }, [value])
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
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
    />
  )
}

function TextStyleInspector({ role }: { role: TextRole }) {
  const styles = useEditor((s) => s.project.view.textStyles)
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
      <div className="field-row">
        <div className="field">
          <label>글자 크기 (pt)</label>
          <PtInput value={size} min={6} max={120} onCommit={(v) => a().setTextStyle(role, { fontSize: v })} />
        </div>
        <div className="field" style={{ maxWidth: 64 }}>
          <label>색상</label>
          <input className="input" style={{ padding: 2 }} type="color" value={color}
            onChange={(e) => a().setTextStyle(role, { color: e.target.value })} />
        </div>
      </div>
      <div className="field">
        <label>글꼴</label>
        <select className="select" value={family}
          onChange={(e) => a().setTextStyle(role, { fontFamily: e.target.value || undefined })}>
          <option value="">기본 글꼴</option>
          {FONT_FAMILY_OPTIONS.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
        <button className="btn btn--sm" style={{ flex: 1 }} onClick={() => a().resetTextStyle(role)}>기본값 초기화</button>
        <button className="btn btn--sm" style={{ flex: 1 }} onClick={() => a().selectTextRole(null)}>닫기</button>
      </div>
      <p className="note">차트의 다른 텍스트를 클릭하면 그 텍스트 스타일 편집으로 전환됩니다.</p>
    </>
  )
}

function TaskInspector({ id }: { id: string }) {
  const project = useEditor((s) => s.project)
  const task = project.tasks.find((t) => t.id === id)
  const a = useEditor.getState
  if (!task) return <div className="empty-hint">선택된 공정이 없습니다.</div>

  const startISO = toISO(dayToDate(project.startDate, task.start))
  const finishISO = toISO(dayToDate(project.startDate, task.start + task.duration))
  const currentColor = task.color ?? project.categories.find((c) => c.id === task.categoryId)?.color ?? '#7c93a8'
  const palette = project.palette ?? []

  return (
    <>
      <div className="field">
        <label>이름</label>
        <input className="input" value={task.name} onChange={(e) => a().updateTask(id, { name: e.target.value })} />
      </div>
      <div className="field">
        <label>공종</label>
        <select className="select" value={task.categoryId} onChange={(e) => a().updateTask(id, { categoryId: e.target.value })}>
          {project.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="field">
        <label>세부공종 (선택)</label>
        <input className="input" value={task.subName ?? ''} placeholder="예: 상류 가물막이"
          onChange={(e) => a().updateTask(id, { subName: e.target.value }, { history: false })} />
      </div>
      <div className="field-row">
        <div className="field">
          <label>시작일</label>
          <input className="input" type="date" value={startISO}
            onChange={(e) => e.target.value && a().updateTask(id, { start: dateToDay(project.startDate, parseISO(e.target.value)) })} />
        </div>
        <div className="field" style={{ maxWidth: 96 }}>
          <label>기간(일)</label>
          <PtInput value={task.duration} min={1} max={100000} disabled={task.isMilestone}
            onCommit={(v) => a().updateTask(id, { duration: v })} />
        </div>
      </div>
      <div className="field">
        <label className="toggle">
          <input type="checkbox" checked={task.isMilestone} onChange={() => a().toggleMilestone(id)} />
          마일스톤(◆)으로 표시
        </label>
      </div>
      <div className="field-row">
        <div className="field" style={{ maxWidth: 64 }}>
          <label>색상</label>
          <input className="input" style={{ padding: 2 }} type="color"
            value={currentColor}
            onChange={(e) => a().updateTask(id, { color: e.target.value }, { history: false })} />
        </div>
        <div className="field">
          <label>종료일</label>
          <input className="input" value={finishISO} disabled />
        </div>
      </div>

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
                onClick={() => a().updateTask(id, { color: c })}
                onContextMenu={(e) => { e.preventDefault(); a().removePaletteColor(i) }}
              />
            ) : (
              <button
                key={i}
                type="button"
                className="palette__sw palette__sw--empty"
                title="현재 색상을 즐겨찾기에 추가"
                onClick={() => a().addPaletteColor(currentColor)}
              >＋</button>
            )
          })}
        </div>
        <p className="note">색을 클릭하면 이 공정에 적용됩니다. 빈 칸 ＋ 로 현재 색을 저장(최대 {PALETTE_MAX}개), 우클릭으로 삭제합니다.</p>
      </div>

      <div style={{ background: 'var(--cream)', borderRadius: 8, padding: '10px 12px', margin: '6px 0 12px', fontSize: 12, color: 'var(--slate)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>여유(Float)</span><strong>{task.totalFloat ?? 0}일</strong></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>주공정 여부</span>
          <span className="badge" style={task.critical ? { background: 'var(--primary)', color: '#fff' } : {}}>
            {task.critical ? '주공정(Critical)' : '여유 있음'}
          </span>
        </div>
      </div>

      <button className="btn" style={{ width: '100%' }} onClick={() => a().deleteTask(id)}>공정 삭제</button>
      <p className="note">바를 드래그해 이동하고, 선택 후 우측 끝의 동그라미를 다른 공정으로 끌어 연결합니다. 차트의 글자를 클릭하면 글꼴·크기·색을 바꿀 수 있습니다.</p>
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
          <select className="select" value={link.type} onChange={(e) => a().updateLink(id, { type: e.target.value as LinkType })}>
            <option value="FS">FS · 종료-시작</option>
            <option value="SS">SS · 시작-시작</option>
            <option value="FF">FF · 종료-종료</option>
            <option value="SF">SF · 시작-종료</option>
          </select>
        </div>
        <div className="field" style={{ maxWidth: 90 }}>
          <label>지연(일)</label>
          <input className="input" type="number" value={link.lag} onChange={(e) => a().updateLink(id, { lag: Number(e.target.value) })} />
        </div>
      </div>
      <button className="btn" style={{ width: '100%' }} onClick={() => a().deleteLink(id)}>연결 삭제</button>
    </>
  )
}

function ProjectInspector() {
  const project = useEditor((s) => s.project)
  const a = useEditor.getState
  const rainy = project.rainySeasons[0]
  const logos = project.branding?.logos ?? []
  const titleSize = project.view.textStyles?.title?.fontSize ?? TEXT_ROLE_DEFAULTS.title.fontSize

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
        <input className="input" type="date" value={project.startDate}
          onChange={(e) => e.target.value && a().setProjectMeta({ startDate: e.target.value })} />
      </div>

      <div style={{ height: 1, background: 'var(--hairline)', margin: '8px 0 14px' }} />
      <div className="panel__title" style={{ marginBottom: 10 }}>도면 / 용지</div>
      <div className="field-row">
        <div className="field">
          <label>용지 규격</label>
          <select className="select" value={project.paper.size} onChange={(e) => a().setPaper({ size: e.target.value as PaperSize })}>
            {PAPER_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="field">
          <label>방향</label>
          <select className="select" value={project.paper.orientation} onChange={(e) => a().setPaper({ orientation: e.target.value as 'landscape' | 'portrait' })}>
            <option value="landscape">가로</option>
            <option value="portrait">세로</option>
          </select>
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>출력 해상도(DPI)</label>
          <select className="select" value={project.paper.dpi} onChange={(e) => a().setPaper({ dpi: Number(e.target.value) })}>
            {DPI_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div className="field">
          <label>밀도(px/일)</label>
          <input className="input" type="number" min={0.5} step={0.5} value={project.view.pxPerDay}
            onChange={(e) => a().setView({ pxPerDay: Math.max(0.3, Number(e.target.value)) })} />
        </div>
      </div>
      <p className="note">DPI 600은 A4~A2에서 원본 그대로 출력됩니다. A1·A0 등 큰 용지는 메모리 보호를 위해 자동으로 낮춰질 수 있습니다.</p>

      <div style={{ height: 1, background: 'var(--hairline)', margin: '8px 0 14px' }} />
      <div className="panel__title" style={{ marginBottom: 10 }}>표시 옵션</div>
      <label className="toggle" style={{ display: 'flex', marginBottom: 8 }}>
        <input type="checkbox" checked={project.view.showCriticalPath} onChange={(e) => a().setView({ showCriticalPath: e.target.checked })} />
        주공정(Critical Path) 강조
      </label>
      <label className="toggle" style={{ display: 'flex', marginBottom: 8 }}>
        <input type="checkbox" checked={project.view.showGrid} onChange={(e) => a().setView({ showGrid: e.target.checked })} />
        격자 표시
      </label>

      <div style={{ height: 1, background: 'var(--hairline)', margin: '8px 0 14px' }} />
      <div className="panel__title" style={{ marginBottom: 10 }}>도면 제목 / CI</div>
      <label className="toggle" style={{ display: 'flex', marginBottom: 10 }}>
        <input type="checkbox" checked={project.view.showTitle !== false} onChange={() => a().toggleTitle()} />
        상단 중앙에 도면 제목(볼드) 표시
      </label>
      <div className="field" style={{ maxWidth: 160 }}>
        <label>제목 글자 크기 (pt)</label>
        <PtInput value={titleSize} min={8} max={96} onCommit={(v) => a().setTextStyle('title', { fontSize: v })} />
      </div>
      <p className="note">제목을 차트에서 직접 클릭해도 같은 편집 창이 열립니다.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10, marginTop: 6 }}>
        {logos.map((logo, i) => (
          <div key={i} style={{ position: 'relative', border: '1px solid var(--hairline-strong)', borderRadius: 8, padding: 5, background: '#fff' }}>
            <img src={logo.src} alt={`CI ${i + 1}`} style={{ height: 34, maxWidth: 116, objectFit: 'contain', display: 'block' }} />
            <button
              className="icon-btn"
              title="삭제"
              style={{ position: 'absolute', top: -9, right: -9, width: 20, height: 20, background: 'var(--canvas)', border: '1px solid var(--hairline-strong)', borderRadius: 9999 }}
              onClick={() => a().removeLogo(i)}
            >×</button>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 2, marginTop: 4 }}>
              <button className="icon-btn" title="오른쪽으로 이동" disabled={i === 0} onClick={() => a().moveLogo(i, -1)}>◀</button>
              <span style={{ fontSize: 10, color: 'var(--stone)', minWidth: 30, textAlign: 'center', lineHeight: '24px' }}>{logo.w}×{logo.h}</span>
              <button className="icon-btn" title="왼쪽으로 이동" disabled={i === logos.length - 1} onClick={() => a().moveLogo(i, 1)}>▶</button>
            </div>
          </div>
        ))}
      </div>
      <label className="btn btn--sm" style={{ cursor: 'pointer' }}>
        ＋ CI 이미지 추가
        <input type="file" accept="image/png,image/jpeg,image/gif,image/svg+xml" hidden onChange={onUploadLogo} />
      </label>
      <p className="note">우측 하단에 표시되며 도면 출력(PNG·JPG·PDF·SVG)에 함께 포함됩니다. 도면 위에서 좌하단 모서리 핸들을 드래그해 크기를 조절하고, ◀▶ 로 배치 순서를 바꿉니다. (PNG·JPG·GIF·SVG, 2MB 이하)</p>

      <div style={{ height: 1, background: 'var(--hairline)', margin: '8px 0 14px' }} />
      <div className="panel__title" style={{ marginBottom: 10 }}>우기(雨期) 보정</div>
      {rainy ? (
        <>
          <div className="field-row">
            <div className="field">
              <label>시작 월</label>
              <select className="select" value={rainy.startMonth} onChange={(e) => a().setRainySeason(Number(e.target.value), rainy.endMonth)}>
                {months()}
              </select>
            </div>
            <div className="field">
              <label>종료 월</label>
              <select className="select" value={rainy.endMonth} onChange={(e) => a().setRainySeason(rainy.startMonth, Number(e.target.value))}>
                {months()}
              </select>
            </div>
          </div>
          <button className="btn btn--sm" onClick={() => a().clearRainySeasons()}>우기 제거</button>
        </>
      ) : (
        <button className="btn btn--sm" onClick={() => a().setRainySeason(6, 9)}>＋ 우기 밴드 추가</button>
      )}
      <p className="note">우기 구간은 회색 음영으로 표시됩니다. 댐 공사 일정 검토 시 장마철 영향을 시각화합니다.</p>
    </>
  )
}

function months() {
  return Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}월</option>)
}
