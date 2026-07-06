// Export modal — pick paper, orientation, DPI and format, then render the live
// vector chart to SVG / PNG / JPG / PDF.

import { useMemo, useState } from 'react'
import { useEditor, filterActive } from '../state/store'
import { Modal } from './Modal'
import { exportChart, type ExportFormat } from '../export/exporter'
import { projectToDxf } from '../export/dxf'
import { computeLayout } from '../engine/layout'
import { PAPER_SIZES, paperPx, DPI_OPTIONS } from '../engine/paper'
import type { PaperSize } from '../types/model'
import { logError, logInfo } from '../state/logger'

const FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: 'pdf', label: 'PDF', hint: '인쇄용 · 용지 규격 그대로' },
  { id: 'png', label: 'PNG', hint: '보고서 첨부 · 무손실' },
  { id: 'jpg', label: 'JPG', hint: '용량 작은 이미지' },
  { id: 'svg', label: 'SVG', hint: '벡터 원본 · 일러스트레이터(AI)에서 바로 편집' },
  { id: 'dxf', label: 'DXF', hint: 'CAD · AutoCAD에서 열고 DWG로 저장 (텍스트·선·해치)' },
]

/** Trigger a client-side text download. */
function download(content: string, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project)
  const pro = useEditor((s) => s.uiMode) === 'pro'
  const a = useEditor.getState
  // Simple mode hides the advanced vector/CAD formats and very-high DPIs.
  const formats = pro ? FORMATS : FORMATS.filter((f) => f.id !== 'svg' && f.id !== 'dxf')
  const dpiOptions = pro ? DPI_OPTIONS : DPI_OPTIONS.filter((d) => d <= 300)
  const [format, setFormat] = useState<ExportFormat>('pdf')
  const [transparent, setTransparent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  // In simple mode the DPI control is capped at 300; clamp the effective DPI so
  // the dropdown value, the size note and the actual export all agree even if a
  // higher DPI was chosen earlier in pro mode (the persisted value is untouched).
  const effectiveDpi = pro ? project.paper.dpi : Math.min(project.paper.dpi, 300)
  const paperEff =
    effectiveDpi === project.paper.dpi ? project.paper : { ...project.paper, dpi: effectiveDpi }
  const px = paperPx(paperEff)

  // How far the drawing's aspect ratio is from the sheet's — i.e. how much margin
  // the letterbox fit would leave. Drives the "fill the sheet" button below.
  const fitInfo = useMemo(() => {
    if (format === 'svg' || format === 'dxf') return null
    const m = computeLayout(project)
    const contentAspect = m.contentWidth / m.contentHeight
    const paperAspect = px.wMm / px.hMm
    const offPct = Math.round((Math.abs(contentAspect - paperAspect) / paperAspect) * 100)
    return { offPct, fitted: offPct <= 1 }
  }, [project, px.wMm, px.hMm, format])

  async function run() {
    const filename = (project.name || 'hydronet').replace(/[\\/:*?"<>|]/g, '_')

    // DXF is built purely from the data model (no SVG/raster needed).
    if (format === 'dxf') {
      setBusy(true)
      setMsg(null)
      try {
        download(projectToDxf(project), `${filename}.dxf`, 'application/dxf')
        logInfo(`DXF 내보내기 완료: ${filename}.dxf`)
        setMsg('DXF(캐드)로 내보냈습니다. AutoCAD에서 열어 편집하거나 DWG로 저장하세요.')
      } catch (e) {
        logError('DXF 내보내기 실패', e)
        setMsg('DXF 내보내기에 실패했습니다. error.log를 확인하세요.')
      } finally {
        setBusy(false)
      }
      return
    }

    // The exported deliverable is always the FULL chart: a view filter is a
    // transient on-screen review aid, not a document edit, and DXF is already
    // built unfiltered. Clear any selection ring AND any active filter before
    // cloning the on-screen SVG, then restore the filter so the working view is
    // untouched. Wait two frames for React to commit the DOM before we clone.
    const prevFilter = a().filter
    const restoreFilter = filterActive(prevFilter)
    a().selectTask(null)
    if (restoreFilter) a().clearFilter()
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    setBusy(true)
    setMsg(null)
    try {
      const svg = document.getElementById('hydronet-chart') as SVGSVGElement | null
      if (!svg) {
        setMsg('차트를 찾을 수 없습니다.')
        return
      }
      const width = Number(svg.getAttribute('width')) || svg.clientWidth
      const height = Number(svg.getAttribute('height')) || svg.clientHeight
      const r = await exportChart({
        svg,
        content: { width, height },
        paper: paperEff,
        filename,
        format,
        transparent,
      })
      setMsg(
        r.clamped
          ? `완료 — 용량 보호를 위해 ${px.effectiveDpi}dpi로 자동 조정되었습니다.`
          : '내보내기를 완료했습니다.',
      )
    } catch (e) {
      logError('내보내기 실패', e)
      setMsg('내보내기에 실패했습니다. error.log를 확인하세요.')
    } finally {
      setBusy(false)
      if (restoreFilter) a().setFilter(prevFilter)
    }
  }

  const footer = (close: () => void) => (
    <>
      <button className="btn" onClick={close}>
        닫기
      </button>
      <button className="btn btn--primary" disabled={busy} onClick={run}>
        {busy ? '처리 중…' : '내보내기'}
      </button>
    </>
  )

  return (
    <Modal
      title="도면 출력"
      sub="SVG 기반 벡터 렌더링으로 A4~A0까지 깨짐 없이 출력합니다."
      width={460}
      onClose={onClose}
      footer={footer}
    >
      <div className="field">
        <label>형식</label>
        <div className="seg">
          {formats.map((f) => (
            <button
              key={f.id}
              className={format === f.id ? 'active' : ''}
              onClick={() => {
                setFormat(f.id)
                setMsg(null)
              }}
              title={f.hint}
            >
              {f.label}
            </button>
          ))}
        </div>
        <p className="note">{FORMATS.find((f) => f.id === format)?.hint}</p>
      </div>

      {format !== 'svg' && format !== 'dxf' && (
        <>
          <div className="field-row">
            <div className="field">
              <label>용지</label>
              <select
                className="select"
                value={project.paper.size}
                onChange={(e) => a().setPaper({ size: e.target.value as PaperSize })}
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
                onChange={(e) =>
                  a().setPaper({ orientation: e.target.value as 'landscape' | 'portrait' })
                }
              >
                <option value="landscape">가로</option>
                <option value="portrait">세로</option>
              </select>
            </div>
            <div className="field" style={{ maxWidth: 96 }}>
              <label>DPI</label>
              <select
                className="select"
                value={effectiveDpi}
                onChange={(e) => a().setPaper({ dpi: Number(e.target.value) })}
              >
                {dpiOptions.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="note">
            출력 크기 ≈{' '}
            <strong>
              {px.wPx.toLocaleString()} × {px.hPx.toLocaleString()} px
            </strong>{' '}
            ({px.effectiveDpi}dpi)
            {px.clamped && ' · 용량 보호로 자동 축소됨'}
          </p>
          {fitInfo &&
            (fitInfo.fitted ? (
              <p className="note" style={{ color: 'var(--primary-deep)' }}>
                ✓ 도면이 용지 비율에 맞아 여백 없이 꽉 차게 출력됩니다.
              </p>
            ) : (
              <div className="field" style={{ marginTop: 2 }}>
                <button
                  className="btn btn--sm"
                  onClick={() => {
                    a().fitToPaper()
                    setMsg('용지 비율에 맞춰 배율을 조정했습니다 — 여백 없이 출력됩니다.')
                  }}
                >
                  ⤢ 여백 없이 시트에 맞추기
                </button>
                <p className="note">
                  현재 도면 비율이 용지와 약 <strong>{fitInfo.offPct}%</strong> 달라 여백이
                  생깁니다. 누르면 배율(시간축·행 높이)을 조정해 꽉 채웁니다 — 글자·막대 왜곡 없음.
                </p>
              </div>
            ))}
        </>
      )}

      {format === 'png' && (
        <label className="toggle" style={{ marginTop: 4 }}>
          <input
            type="checkbox"
            checked={transparent}
            onChange={(e) => setTransparent(e.target.checked)}
          />
          배경 투명
        </label>
      )}

      {msg && (
        <p className="note" style={{ color: 'var(--primary-deep)' }}>
          {msg}
        </p>
      )}
    </Modal>
  )
}
