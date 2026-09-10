// Export modal — pick 출력 범위, paper, orientation, DPI and format, check the
// preflight warnings and the preview, then render the live vector chart to
// SVG / PNG / JPG / PDF / DXF.
//
// 출력 범위(F14): '전체 도면' 은 화면 필터를 무시하고 도면 전체를, '현재 표시 범위' 는
// 화면에 보이는 그대로(필터 적용) 내보낸다. 어느 쪽이든 표시 OFF(숨김) 항목은 빠지며,
// 그 사실은 아래 점검란에 숫자로 표기된다 — export/preflight.ts 가 계산한다.

import { useMemo, useState } from 'react'
import { DPI_OPTIONS, PAPER_SIZES, paperPx } from '../engine/paper'
import { projectToDxf } from '../export/dxf'
import { buildExportSvgString, type ExportFormat, exportChart } from '../export/exporter'
import { type ExportScope, exportDiagnostics, exportPreflight } from '../export/preflight'
import { logError, logInfo } from '../state/logger'
import { filterActive, useEditor } from '../state/store'
import { colors } from '../styles/theme'
import type { PaperSize } from '../types/model'
import { Modal } from './Modal'

const FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: 'pdf', label: 'PDF', hint: '인쇄용 · 용지 규격 그대로' },
  { id: 'png', label: 'PNG', hint: '보고서 첨부 · 무손실' },
  { id: 'jpg', label: 'JPG', hint: '용량 작은 이미지' },
  { id: 'svg', label: 'SVG', hint: '벡터 원본 · 일러스트레이터(AI)에서 바로 편집' },
  { id: 'dxf', label: 'DXF', hint: 'CAD · AutoCAD에서 열고 DWG로 저장 (텍스트·선·해치)' },
]

const SCOPES: { id: ExportScope; label: string; hint: string }[] = [
  { id: 'full', label: '전체 도면', hint: '화면 필터·표시 기간을 제외하고 실제 공정 기간 전체를 출력합니다.' },
  {
    id: 'view',
    label: '현재 표시 범위',
    hint: '지금 화면에 보이는 그대로(필터 적용) 출력합니다.',
  },
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

/** 실패 메시지 → 사람이 이해하고 다음 수를 둘 수 있는 한 문장으로. */
function failureText(e: unknown): string {
  const m = (e as { message?: string })?.message ?? ''
  if (/캔버스|toBlob/.test(m))
    return '이 해상도에서 브라우저가 이미지를 만들지 못했습니다. DPI를 낮춰 다시 시도하세요.'
  if (/SVG 이미지를 로드/.test(m))
    return '도면을 이미지로 변환하지 못했습니다. 잠시 후 다시 시도하거나 DPI를 낮춰 주세요.'
  return `내보내기에 실패했습니다${m ? ` (${m})` : ''}.`
}

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project)
  const filter = useEditor((s) => s.filter)
  const pro = useEditor((s) => s.uiMode) === 'pro'
  const a = useEditor.getState
  // Simple mode hides the advanced vector/CAD formats and very-high DPIs.
  const formats = pro ? FORMATS : FORMATS.filter((f) => f.id !== 'svg' && f.id !== 'dxf')
  const dpiOptions = pro ? DPI_OPTIONS : DPI_OPTIONS.filter((d) => d <= 300)
  const [format, setFormat] = useState<ExportFormat>('pdf')
  // 기본은 '전체 도면' — 기존 정책(필터를 해제하고 전체를 출력)을 그대로 유지한다.
  const [scope, setScope] = useState<ExportScope>('full')
  const [transparent, setTransparent] = useState(false)
  const [stamp, setStamp] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  // 미리보기는 '어떤 조건으로 만든 그림인지'를 함께 들고 있는다 — 조건이 바뀌면
  // (범위·형식·용지·버전표기) 옛 그림은 더 이상 사실이 아니므로 자동으로 숨겨진다.
  const [preview, setPreview] = useState<{ key: string; url: string } | null>(null)
  const [fail, setFail] = useState<{ text: string; diag: string } | null>(null)
  const [showDiag, setShowDiag] = useState(false)

  // In simple mode the DPI control is capped at 300; clamp the effective DPI so
  // the dropdown value, the size note and the actual export all agree even if a
  // higher DPI was chosen earlier in pro mode (the persisted value is untouched).
  const effectiveDpi = pro ? project.paper.dpi : Math.min(project.paper.dpi, 300)
  const paperEff = useMemo(
    () =>
      effectiveDpi === project.paper.dpi ? project.paper : { ...project.paper, dpi: effectiveDpi },
    [project.paper, effectiveDpi],
  )
  const px = paperPx(paperEff)

  const preInput = useMemo(
    () => ({ project, filter, scope, paper: paperEff, format }),
    [project, filter, scope, paperEff, format],
  )
  // 출력 사전 점검 — 무엇이 몇 개 나가는지, 글자가 몇 pt로 찍히는지 미리 계산한다.
  const pre = useMemo(() => exportPreflight(preInput), [preInput])

  const stampText = `${project.name} · ${pre.sheetName} · ${pre.scopeLabel} · ${new Date().toLocaleString('ko-KR')}`

  // 미리보기가 '지금 조건으로 만든 그림'인지 가리는 지문. 범위·형식·용지·버전표기뿐 아니라
  // **배치 배율(시간축·행 높이·글자 크기)**까지 넣는다 — 아래 [여백 없이 시트에 맞추기]가
  // 바로 그 값을 바꾸므로, 빼놓으면 옛 그림이 '실제 출력과 같다'는 설명 아래 그대로 남는다.
  // 여기에 **문서 내용 지문**(최종수정 시각·공종/공정 개수)과 배경 투명 옵션도 넣는다 —
  // 팀원이 협업 중에 공종을 지우거나 투명 배경을 켜면 옛 그림은 더 이상 실제 출력이 아니다.
  // '현재 표시 범위'로 출력할 때는 **필터 자체가 문서 내용의 일부**다(무엇이 그려지는지를
  // 정한다). 예전엔 지문에서 필터를 빼 두어, 범위를 '현재 표시 범위'로 두고 필터만 바꾸면
  // 옛 그림이 '실제 출력과 같은 방식으로 보여줍니다' 설명 아래 그대로 남고, 바로 옆 사전
  // 점검은 다른 공정 집합을 설명했다. filterActive 가 보는 필드와 같은 필드를 넣는다.
  const v = project.view
  const scopeFilterKey =
    scope === 'view' ? `${filter.critical}|${filter.milestone}|${filter.query.trim()}` : 'full'
  const contentKey = `${project.meta.updatedAt}|${project.categories.length}x${project.tasks.length}|${scopeFilterKey}`
  const previewKey = `${scope}|${format}|${stamp}|${transparent}|${px.wMm}x${px.hMm}@${px.effectiveDpi}|${v.pxPerDay}x${v.rowHeight}x${v.fontScale ?? 1}|${contentKey}`
  const previewUrl = preview?.key === previewKey ? preview.url : null

  // 레터박스로 남는 여백 — 사전 점검(preflight)이 계산한 값을 그대로 쓴다. 예전엔 여기서
  // 필터를 무시한 전체 레이아웃으로 따로 계산해, '현재 표시 범위'를 고르면 두 줄 아래
  // 경고가 '약 70%가 여백'이라고 하는데 여기선 '여백 없이 꽉 차게'라고 하는 모순이 났다.
  const fitInfo = useMemo(() => {
    if (format === 'svg' || format === 'dxf') return null
    return { offPct: pre.marginPct, fitted: pre.marginPct <= 1 }
  }, [pre.marginPct, format])

  /**
   * 선택한 출력 범위를 실제 화면(=클론 원본인 라이브 SVG)에 반영한 뒤 fn 을 실행한다.
   *   • '전체 도면'      → 필터와 화면용 표시 기간을 잠시 해제해 실제 공정 범위로 캡처
   *   • '현재 표시 범위' → 필터를 그대로 둔 채 캡처
   * 어느 쪽이든 선택 링은 지우고, React 가 DOM 을 커밋하도록 두 프레임 기다린 뒤
   * 캡처하며, 끝나면 원래 필터를 복원해 작업 화면은 건드리지 않는다.
   */
  async function withScope<T>(fn: () => Promise<T> | T): Promise<T> {
    const prevFilter = a().filter
    const restoreFilter = scope === 'full' && filterActive(prevFilter)
    const prevStart = a().project.view.displayStart
    const prevEnd = a().project.view.displayEnd
    const restoreRange = scope === 'full' && !!(prevStart || prevEnd)
    a().selectTask(null)
    if (restoreFilter) a().clearFilter()
    if (restoreRange) a().setView({ displayStart: undefined, displayEnd: undefined })
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    try {
      return await fn()
    } finally {
      if (restoreFilter) a().setFilter(prevFilter)
      if (restoreRange) a().setView({ displayStart: prevStart, displayEnd: prevEnd })
    }
  }

  /** 라이브 차트 SVG 를 실제 출력과 같은 방식으로 직렬화 — 미리보기·출력이 같은 코드 경로. */
  function liveChartSvg(): { svg: SVGSVGElement; width: number; height: number } | null {
    const svg = document.getElementById('sequence-chart') as SVGSVGElement | null
    if (!svg) return null
    const width = Number(svg.getAttribute('width')) || svg.clientWidth
    const height = Number(svg.getAttribute('height')) || svg.clientHeight
    return { svg, width, height }
  }

  async function buildPreview() {
    setMsg(null)
    setBusy(true)
    try {
      await withScope(() => {
        const live = liveChartSvg()
        if (!live) {
          setMsg('차트를 찾을 수 없습니다.')
          return
        }
        const s = buildExportSvgString(
          live.svg,
          { width: live.width, height: live.height },
          { background: colors.canvas, stamp: stamp ? stampText : undefined },
        )
        setPreview({
          key: previewKey,
          url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`,
        })
      })
    } catch (e) {
      logError('출력 미리보기 실패', e)
      setMsg('미리보기를 만들지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  async function run() {
    const filename = (project.name || 'sequence').replace(/[\\/:*?"<>|]/g, '_')
    setFail(null)
    setShowDiag(false)

    // DXF is built purely from the data model (no SVG/raster needed).
    if (format === 'dxf') {
      setBusy(true)
      setMsg(null)
      try {
        const exportProject =
          scope === 'full'
            ? { ...project, view: { ...project.view, displayStart: undefined, displayEnd: undefined } }
            : project
        const dxf = projectToDxf(exportProject, scope === 'view' ? filter : undefined)
        download(dxf, `${filename}.dxf`, 'application/dxf')
        logInfo(`DXF 내보내기 완료(${pre.scopeLabel}): ${filename}.dxf`)
        setMsg(
          `DXF(캐드)로 내보냈습니다 — ${pre.scopeLabel} · 공정 ${pre.taskCount}개. AutoCAD에서 열어 편집하거나 DWG로 저장하세요.`,
        )
      } catch (e) {
        logError('DXF 내보내기 실패', e)
        setFail({ text: failureText(e), diag: exportDiagnostics(preInput, e) })
      } finally {
        setBusy(false)
      }
      return
    }

    setMsg(null)
    try {
      await withScope(async () => {
        setBusy(true)
        const live = liveChartSvg()
        if (!live) {
          setMsg('차트를 찾을 수 없습니다.')
          return
        }
        const r = await exportChart({
          svg: live.svg,
          content: { width: live.width, height: live.height },
          paper: paperEff,
          filename,
          format,
          transparent,
          stamp: stamp ? stampText : undefined,
          pdfTiles:
            format === 'pdf' && pre.pages > 1
              ? {
                  scale: pre.legibleScale,
                  cols: pre.legibleCols,
                  rows: pre.legibleRows,
                  labelWidth: pre.frozenLabelWidth,
                  headerHeight: pre.frozenHeaderHeight,
                  titleHeight: pre.frozenTitleHeight,
                }
              : undefined,
        })
        setMsg(
          `${pre.scopeLabel} · 공정 ${pre.taskCount}개 · ${pre.sheetName} · ${r.pages}장 — ` +
            (r.clamped
              ? `완료(용량 보호를 위해 ${px.effectiveDpi}dpi로 자동 조정)`
              : '내보내기를 완료했습니다.'),
        )
      })
    } catch (e) {
      logError('내보내기 실패', e)
      setFail({ text: failureText(e), diag: exportDiagnostics(preInput, e) })
    } finally {
      setBusy(false)
    }
  }

  /** 지금 DPI 바로 아래 단계(없으면 null) — 실패했을 때 한 단계 낮춰 재시도용. */
  const lowerDpi = dpiOptions.filter((d) => d < effectiveDpi).pop() ?? null

  async function retryLower() {
    if (lowerDpi == null) return
    a().setPaper({ dpi: lowerDpi })
    setFail(null)
    // setPaper 반영 후 실행되도록 한 프레임 양보.
    await new Promise<void>((r) => requestAnimationFrame(() => r()))
    void run()
  }

  async function copyDiag() {
    if (!fail) return
    try {
      await navigator.clipboard?.writeText(fail.diag)
      setMsg('진단 정보를 클립보드에 복사했습니다 — 담당자에게 붙여넣어 전달하세요.')
    } catch {
      setShowDiag(true)
    }
  }

  const footer = (close: () => void) => (
    <>
      <button type="button" className="btn" onClick={close}>
        닫기
      </button>
      <button
        type="button"
        className="btn btn--primary"
        disabled={busy}
        onClick={run}
        data-autofocus
      >
        {busy ? '처리 중…' : '내보내기'}
      </button>
    </>
  )

  const vector = format === 'svg' || format === 'dxf'

  return (
    <Modal
      title="도면 출력"
      sub="SVG 기반 벡터 렌더링으로 A4~A0까지 깨짐 없이 출력합니다."
      width={560}
      onClose={onClose}
      footer={footer}
    >
      <div className="field">
        <label>형식</label>
        <div className="seg">
          {formats.map((f) => (
            <button
              type="button"
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

      <div className="field">
        <label>출력 범위</label>
        <div className="seg">
          {SCOPES.map((s) => (
            <button
              type="button"
              key={s.id}
              className={scope === s.id ? 'active' : ''}
              onClick={() => {
                setScope(s.id)
                setMsg(null)
              }}
              title={
                s.id === 'view' && !filterActive(filter)
                  ? '지금은 필터가 없어 전체 도면과 같습니다.'
                  : s.hint
              }
            >
              {s.label}
            </button>
          ))}
        </div>
        <p className="note">{SCOPES.find((s) => s.id === scope)?.hint}</p>
      </div>

      {!vector && (
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
        </>
      )}

      {/* ── 출력 사전 점검 — 무엇이 어떻게 나가는지 확정해서 보여준다 ── */}
      <div className="field" style={{ marginTop: 2 }}>
        <label>출력 전 점검</label>
        <p className="note">
          시트 <strong>{pre.sheetName}</strong> · {pre.scopeLabel} · 공정{' '}
          <strong>{pre.taskCount}</strong>개
          {!vector && (
            <>
              {' '}
              · 용지 {project.paper.size}{' '}
              {project.paper.orientation === 'landscape' ? '가로' : '세로'} · 최소 글자{' '}
              <strong>{pre.minFontPt.toFixed(1)}pt</strong> · 여백 {pre.marginPct}% · {pre.pages}장
            </>
          )}
          {pre.rangeLabel && <> · 표시 기간 {pre.rangeLabel}</>}
        </p>
        {pre.warnings.length === 0 ? (
          <p className="note" style={{ color: 'var(--primary-deep)' }}>
            ✓ 범위·글자 크기·용지 점검 이상 없음
          </p>
        ) : (
          pre.warnings.map((w) => (
            <p className="note" key={w} style={{ color: '#B4531F' }}>
              ⚠ {w}
            </p>
          ))
        )}
      </div>

      {!vector &&
        fitInfo &&
        (fitInfo.fitted ? (
          <p className="note" style={{ color: 'var(--primary-deep)' }}>
            ✓ 도면이 용지 비율에 맞아 여백 없이 꽉 차게 출력됩니다.
          </p>
        ) : (
          <div className="field" style={{ marginTop: 2 }}>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => {
                // '현재 표시 범위'로 출력할 거면 **그 필터가 남기는 도면**에 맞춘다. 예전엔
                // 늘 전체 도면 기준으로 맞춰서, 필터를 건 채 누르면 여백이 그대로거나 더
                // 나빠지는데도 '여백 없이 출력됩니다'라고 단정했다.
                const scoped = scope === 'view' && filterActive(filter) ? filter : undefined
                a().fitToPaper(scoped)
                // 결과 문구는 단정하지 않고 **다시 점검한 값**에서 끌어온다.
                const after = exportPreflight({
                  project: a().project,
                  filter,
                  scope,
                  paper: paperEff,
                  format,
                })
                setMsg(
                  after.marginPct <= 1
                    ? `${after.scopeLabel} 기준으로 용지 비율에 맞췄습니다 — 여백 ${after.marginPct}%로 출력됩니다.`
                    : `배율을 조정했지만 ${after.scopeLabel} 기준 여백이 약 ${after.marginPct}% 남습니다 — 용지 방향·크기를 바꾸거나 표시 기간을 조정해 보세요.`,
                )
              }}
            >
              ⤢ 여백 없이 시트에 맞추기
            </button>
            <p className="note">
              이 범위로 출력하면 용지의 약 <strong>{fitInfo.offPct}%</strong>가 여백으로 남습니다.
              누르면 배율(시간축·행 높이)을 조정해 꽉 채웁니다 — 글자·막대 왜곡 없음.
            </p>
          </div>
        ))}

      {/* ── 미리보기 — 실제 출력과 같은 직렬화·같은 레터박스로 그린다 ── */}
      <div className="field" style={{ marginTop: 2 }}>
        <label>미리보기</label>
        <button type="button" className="btn btn--sm" disabled={busy} onClick={buildPreview}>
          {previewUrl ? '↻ 미리보기 새로고침' : '👁 미리보기 만들기'}
        </button>
        {previewUrl && (
          <div className="export-preview" style={{ aspectRatio: `${px.wMm} / ${px.hMm}` }}>
            <img src={previewUrl} alt={`출력 미리보기 — ${pre.scopeLabel}`} />
          </div>
        )}
        <p className="note">
          {vector
            ? '미리보기는 래스터 출력(PNG·JPG·PDF) 기준 배치입니다. SVG·DXF는 벡터 원본이라 여백 개념이 없습니다.'
            : format === 'pdf' && pre.pages > 1
              ? `미리보기는 전체 도면 개요입니다. 실제 PDF는 ${pre.legibleCols}×${pre.legibleRows} = ${pre.pages}장으로 나뉘며 각 장에 공사명·좌측 WBS·연·월 헤더를 반복합니다.`
            : '용지 안에 도면이 어떻게 앉는지(여백 포함) 실제 출력과 같은 방식으로 보여줍니다.'}
        </p>
      </div>

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

      <label className="toggle" style={{ marginTop: 4 }}>
        <input
          type="checkbox"
          checked={stamp}
          onChange={(e) => {
            setStamp(e.target.checked)
          }}
        />
        버전 표기(우측 하단에 사업명 · 시트 · 범위 · 출력 시각)
      </label>

      {msg && (
        <p className="note" style={{ color: 'var(--primary-deep)' }}>
          {msg}
        </p>
      )}

      {/* ── 실패했을 때: error.log 를 보라고 하지 않고 여기서 복구한다 ── */}
      {fail && (
        <div className="field" style={{ marginTop: 4 }}>
          <p className="note" style={{ color: '#B4531F' }}>
            ⚠ {fail.text}
          </p>
          <div className="seg seg--sm" style={{ flexWrap: 'wrap' }}>
            <button type="button" onClick={run} disabled={busy}>
              다시 시도
            </button>
            {lowerDpi != null && (
              <button type="button" onClick={retryLower} disabled={busy}>
                {lowerDpi}dpi로 다시 시도
              </button>
            )}
            <button type="button" onClick={copyDiag}>
              진단 정보 복사
            </button>
          </div>
          {showDiag && (
            <textarea className="export-diag" readOnly value={fail.diag} aria-label="진단 정보" />
          )}
        </div>
      )}
    </Modal>
  )
}
