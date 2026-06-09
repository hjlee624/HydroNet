// Right panel — context-sensitive properties. Shows the selected activity or
// link editor; when nothing is selected, the project / paper / 우기 settings.

import type { ChangeEvent } from 'react'
import { useEditor } from '../state/store'
import { dateToDay, dayToDate, parseISO, toISO } from '../engine/dates'
import { PAPER_SIZES } from '../engine/paper'
import type { LinkType, PaperSize } from '../types/model'

export function Inspector() {
  const selectedTaskId = useEditor((s) => s.selectedTaskId)
  const selectedLinkId = useEditor((s) => s.selectedLinkId)

  return (
    <aside className="panel panel--right">
      <div className="panel__header">
        <span className="panel__title">
          {selectedTaskId ? '공정 속성' : selectedLinkId ? '연결 속성' : '도면 · 프로젝트'}
        </span>
      </div>
      <div className="panel__scroll">
        {selectedTaskId ? <TaskInspector id={selectedTaskId} />
          : selectedLinkId ? <LinkInspector id={selectedLinkId} />
            : <ProjectInspector />}
      </div>
    </aside>
  )
}

function TaskInspector({ id }: { id: string }) {
  const project = useEditor((s) => s.project)
  const task = project.tasks.find((t) => t.id === id)
  const a = useEditor.getState
  if (!task) return <div className="empty-hint">선택된 공정이 없습니다.</div>

  const startISO = toISO(dayToDate(project.startDate, task.start))
  const finishISO = toISO(dayToDate(project.startDate, task.start + task.duration))

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
      <div className="field-row">
        <div className="field">
          <label>시작일</label>
          <input className="input" type="date" value={startISO}
            onChange={(e) => e.target.value && a().updateTask(id, { start: dateToDay(project.startDate, parseISO(e.target.value)) })} />
        </div>
        <div className="field" style={{ maxWidth: 96 }}>
          <label>기간(일)</label>
          <input className="input" type="number" min={0} value={task.duration} disabled={task.isMilestone}
            onChange={(e) => a().updateTask(id, { duration: Math.max(0, Number(e.target.value)) })} />
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
            value={task.color ?? project.categories.find((c) => c.id === task.categoryId)?.color ?? '#7c93a8'}
            onChange={(e) => a().updateTask(id, { color: e.target.value })} />
        </div>
        <div className="field">
          <label>종료일</label>
          <input className="input" value={finishISO} disabled />
        </div>
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
      <p className="note">바를 드래그해 이동하고, 선택 후 우측 끝의 동그라미를 다른 공정으로 끌어 연결합니다.</p>
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

  function onUploadLogo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      window.alert('CI 이미지는 2MB 이하만 추가할 수 있습니다.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => { if (typeof reader.result === 'string') a().addLogo(reader.result) }
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
            {[96, 150, 200, 300].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div className="field">
          <label>밀도(px/일)</label>
          <input className="input" type="number" min={0.5} step={0.5} value={project.view.pxPerDay}
            onChange={(e) => a().setView({ pxPerDay: Math.max(0.3, Number(e.target.value)) })} />
        </div>
      </div>

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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
        {logos.map((src, i) => (
          <div key={i} style={{ position: 'relative', border: '1px solid var(--hairline-strong)', borderRadius: 8, padding: 5, background: '#fff' }}>
            <img src={src} alt={`CI ${i + 1}`} style={{ height: 34, maxWidth: 116, objectFit: 'contain', display: 'block' }} />
            <button
              className="icon-btn"
              title="삭제"
              style={{ position: 'absolute', top: -9, right: -9, width: 20, height: 20, background: 'var(--canvas)', border: '1px solid var(--hairline-strong)', borderRadius: 9999 }}
              onClick={() => a().removeLogo(i)}
            >×</button>
          </div>
        ))}
      </div>
      <label className="btn btn--sm" style={{ cursor: 'pointer' }}>
        ＋ CI 이미지 추가
        <input type="file" accept="image/png,image/jpeg,image/gif,image/svg+xml" hidden onChange={onUploadLogo} />
      </label>
      <p className="note">우측 하단에 표시되며 도면 출력(PNG·JPG·PDF·SVG)에 함께 포함됩니다. PNG·JPG·GIF·SVG 지원 (2MB 이하).</p>

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
