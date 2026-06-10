// Export modal — pick paper, orientation, DPI and format, then render the live
// vector chart to SVG / PNG / JPG / PDF.

import { useState } from 'react'
import { useEditor } from '../state/store'
import { Modal } from './Modal'
import { exportChart, type ExportFormat } from '../export/exporter'
import { PAPER_SIZES, paperPx, DPI_OPTIONS } from '../engine/paper'
import type { PaperSize } from '../types/model'
import { logError } from '../state/logger'

const FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: 'pdf', label: 'PDF', hint: '인쇄용 · 용지 규격 그대로' },
  { id: 'png', label: 'PNG', hint: '보고서 첨부 · 무손실' },
  { id: 'jpg', label: 'JPG', hint: '용량 작은 이미지' },
  { id: 'svg', label: 'SVG', hint: '벡터 원본 · 무한 확대' },
]

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project)
  const a = useEditor.getState
  const [format, setFormat] = useState<ExportFormat>('pdf')
  const [transparent, setTransparent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const px = paperPx(project.paper)

  async function run() {
    // Clear any selection first so the on-screen selection ring (orange stroke on
    // the selected bar/milestone/link) isn't baked into the exported image. Wait
    // two frames for React to commit the deselected DOM before we clone the SVG.
    a().selectTask(null)
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    const svg = document.getElementById('hydronet-chart') as SVGSVGElement | null
    if (!svg) { setMsg('차트를 찾을 수 없습니다.'); return }
    const width = Number(svg.getAttribute('width')) || svg.clientWidth
    const height = Number(svg.getAttribute('height')) || svg.clientHeight
    const filename = (project.name || 'hydronet').replace(/[\\/:*?"<>|]/g, '_')
    setBusy(true); setMsg(null)
    try {
      const r = await exportChart({ svg, content: { width, height }, paper: project.paper, filename, format, transparent })
      setMsg(r.clamped
        ? `완료 — 용량 보호를 위해 ${px.effectiveDpi}dpi로 자동 조정되었습니다.`
        : '내보내기를 완료했습니다.')
    } catch (e) {
      logError('내보내기 실패', e)
      setMsg('내보내기에 실패했습니다. error.log를 확인하세요.')
    } finally {
      setBusy(false)
    }
  }

  const footer = (close: () => void) => (
    <>
      <button className="btn" onClick={close}>닫기</button>
      <button className="btn btn--primary" disabled={busy} onClick={run}>{busy ? '처리 중…' : '내보내기'}</button>
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
          {FORMATS.map((f) => (
            <button key={f.id} className={format === f.id ? 'active' : ''} onClick={() => setFormat(f.id)} title={f.hint}>
              {f.label}
            </button>
          ))}
        </div>
        <p className="note">{FORMATS.find((f) => f.id === format)?.hint}</p>
      </div>

      {format !== 'svg' && (
        <>
          <div className="field-row">
            <div className="field">
              <label>용지</label>
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
            <div className="field" style={{ maxWidth: 96 }}>
              <label>DPI</label>
              <select className="select" value={project.paper.dpi} onChange={(e) => a().setPaper({ dpi: Number(e.target.value) })}>
                {DPI_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>
          <p className="note">
            출력 크기 ≈ <strong>{px.wPx.toLocaleString()} × {px.hPx.toLocaleString()} px</strong> ({px.effectiveDpi}dpi)
            {px.clamped && ' · 용량 보호로 자동 축소됨'}
          </p>
        </>
      )}

      {format === 'png' && (
        <label className="toggle" style={{ marginTop: 4 }}>
          <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} />
          배경 투명
        </label>
      )}

      {msg && <p className="note" style={{ color: 'var(--primary-deep)' }}>{msg}</p>}
    </Modal>
  )
}
