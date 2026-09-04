// 내역서·수량산출서(BoQ) 취입 다이얼로그 — 검토서 B3.
//  ① 파일(엑셀/CSV/HWPX/PDF) 또는 붙여넣기 → 표 인식(항목·단위·수량)
//  ② 공정과 자동 매핑(이름 유사도) + 공종코드 추천
//  ③ 사용자가 매핑 표에서 **확인·수정한 것만** [반영] → store.importBoqQuantities(단일 커밋)
//
// 안전 원칙: 모든 파싱은 try/catch 로 감싸 실패 시 붙여넣기(수동)로 degrade 한다 —
// 절대 크래시하거나 미확인 값을 자동 반영하지 않는다. 구버전 .hwp(바이너리)는 파싱이
// 불안정하므로 HWPX/PDF/엑셀 저장을 안내한다(대충 파서로 오류를 만들지 않는다).

import { type CSSProperties, useState } from 'react'
import { STANDARD_RATE_OPTIONS } from '../data/standardRates'
import {
  type BoqColumns,
  type BoqParseResult,
  type BoqTaskMapping,
  extractRows,
  matchRowsToTasks,
  parseBoqAoa,
  parseCsv,
} from '../state/boqImport'
import { useEditor } from '../state/store'
import { Modal } from './Modal'

type Loaded =
  | { kind: 'aoa'; aoa: string[][] }
  | { kind: 'text'; text: string; note?: string }
  | { kind: 'error'; message: string }

/** 시트 뷰어에서 한 열에 지정하는 역할. */
type ColRole = 'name' | 'unit' | 'qty' | 'spec' | 'none'

async function readFileToLoaded(file: File): Promise<Loaded> {
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()
  try {
    if (ext === 'csv' || ext === 'txt') {
      return { kind: 'aoa', aoa: parseCsv(await file.text()) }
    }
    if (ext === 'xlsx' || ext === 'xls') {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      if (!ws) return { kind: 'error', message: '엑셀에서 시트를 찾지 못했습니다.' }
      const aoa = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '' })
      return { kind: 'aoa', aoa: aoa as string[][] }
    }
    if (ext === 'hwpx') {
      return { kind: 'aoa', aoa: await hwpxToAoa(await file.arrayBuffer()) }
    }
    if (ext === 'pdf') {
      const text = await pdfToText(await file.arrayBuffer())
      // PDF는 표 구조가 보존되지 않을 수 있으므로: 2칸+ 공백/탭으로 열을 추정해 자동 시도,
      // 실패하면 추출 텍스트를 붙여넣기 창으로 넘겨 사용자가 정리(안전 degrade).
      const aoa = text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => l.split(/\s{2,}|\t/))
      const probe = parseBoqAoa(aoa)
      if (probe.rows.length > 0) return { kind: 'aoa', aoa }
      return {
        kind: 'text',
        text,
        note: 'PDF에서 텍스트를 추출했습니다. 표 인식이 어려우면 항목·단위·수량이 콤마/탭으로 구분되도록 정리 후 [텍스트 인식]을 누르세요.',
      }
    }
    if (ext === 'hwp') {
      return {
        kind: 'error',
        message:
          '구버전 HWP(바이너리)는 브라우저에서 안정적으로 읽기 어렵습니다. 한글에서 HWPX 또는 PDF·엑셀로 저장해 올리거나, 표를 복사해 아래에 붙여넣기 하세요.',
      }
    }
    return { kind: 'error', message: `지원하지 않는 형식(.${ext})입니다. 엑셀·CSV·HWPX·PDF를 사용하세요.` }
  } catch (e) {
    return {
      kind: 'error',
      message: `파일을 읽지 못했습니다(${(e as Error)?.message ?? '알 수 없는 오류'}). 표를 복사해 아래에 붙여넣기 하세요.`,
    }
  }
}

/** HWPX(zip+XML) 의 표 셀을 행×열로 추출. 네임스페이스 무관하게 localName 으로 순회. */
async function hwpxToAoa(buf: ArrayBuffer): Promise<string[][]> {
  const { unzipSync, strFromU8 } = await import('fflate')
  const files = unzipSync(new Uint8Array(buf))
  const out: string[][] = []
  const parser = new DOMParser()
  for (const path of Object.keys(files)) {
    if (!/Contents\/section\d+\.xml$/i.test(path)) continue
    const doc = parser.parseFromString(strFromU8(files[path]), 'application/xml')
    const tbls = doc.getElementsByTagNameNS('*', 'tbl')
    for (let ti = 0; ti < tbls.length; ti++) {
      const trs = tbls[ti].getElementsByTagNameNS('*', 'tr')
      for (let ri = 0; ri < trs.length; ri++) {
        const tcs = trs[ri].getElementsByTagNameNS('*', 'tc')
        const row: string[] = []
        for (let ci = 0; ci < tcs.length; ci++) {
          const ts = tcs[ci].getElementsByTagNameNS('*', 't')
          let s = ''
          for (let k = 0; k < ts.length; k++) s += ts[k].textContent ?? ''
          row.push(s.trim())
        }
        if (row.some((c) => c)) out.push(row)
      }
    }
  }
  return out
}

/** PDF → 페이지별 텍스트 추출(pdfjs). 워커 로드 실패 등은 상위 try/catch 에서 degrade. */
async function pdfToText(buf: ArrayBuffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  try {
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl as string
  } catch {
    // 워커 URL 확보 실패 시에도 getDocument 는 fake worker 로 시도(느리지만 동작).
  }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise
  let text = ''
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    const line = content.items
      .map((it) => ('str' in it ? (it as { str: string }).str : ''))
      .join(' ')
    text += `${line}\n`
  }
  return text
}

export function BoqImportDialog({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project)
  const readOnly = useEditor((s) => s.readOnly)
  const a = useEditor.getState

  const [busy, setBusy] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [parse, setParse] = useState<BoqParseResult | null>(null)
  const [mappings, setMappings] = useState<BoqTaskMapping[]>([])
  const [include, setInclude] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState<string | null>(null)
  const [manual, setManual] = useState<string | null>(null)
  const [result, setResult] = useState<number | null>(null)

  function ingest(res: BoqParseResult): void {
    setParse(res)
    setMessage(res.warnings.join(' ') || null)
    const { mappings: ms } = matchRowsToTasks(res.rows, project.tasks)
    setMappings(ms)
    setInclude(new Set(ms.filter((m) => m.row && m.quantity != null).map((m) => m.taskId)))
    setResult(null)
  }

  async function onPick(): Promise<void> {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.xlsx,.xls,.csv,.txt,.pdf,.hwpx,.hwp'
    input.onchange = async () => {
      const f = input.files?.[0]
      if (!f) return
      setBusy(true)
      setFileName(f.name)
      setManual(null)
      const loaded = await readFileToLoaded(f)
      setBusy(false)
      if (loaded.kind === 'aoa') ingest(parseBoqAoa(loaded.aoa))
      else if (loaded.kind === 'text') {
        setManual(loaded.text)
        setMessage(loaded.note ?? '텍스트를 추출했습니다 — 아래에서 정리 후 [텍스트 인식].')
        setParse(null)
        setMappings([])
      } else {
        setManual('')
        setMessage(loaded.message)
        setParse(null)
        setMappings([])
      }
    }
    input.click()
  }

  function onManualParse(): void {
    if (manual == null) return
    ingest(parseBoqAoa(parseCsv(manual)))
  }

  function setColumns(cols: BoqColumns): void {
    if (!parse) return
    const headerRowIndex = parse.headerRowIndex >= 0 ? parse.headerRowIndex : 0
    const rows = extractRows(parse.aoa, headerRowIndex, cols)
    const next: BoqParseResult = { ...parse, headerRowIndex, columns: cols, rows, warnings: parse.warnings }
    ingest(next)
  }

  /** 뷰어에서 한 열에 지정된 역할(항목/단위/수량/규격) — 없으면 'none'. */
  function roleOfColumn(c: number): ColRole {
    if (!parse) return 'none'
    for (const k of ['name', 'unit', 'qty', 'spec'] as const) if (parse.columns[k] === c) return k
    return 'none'
  }
  /** 열 c 에 역할을 지정 — 같은 열이 갖던 다른 역할은 해제(역할당 1열 유지). */
  function assignRole(c: number, role: ColRole): void {
    if (!parse) return
    const cols: BoqColumns = { ...parse.columns }
    for (const k of ['name', 'unit', 'qty', 'spec'] as const) if (cols[k] === c) cols[k] = -1
    if (role !== 'none') cols[role] = c
    setColumns(cols)
  }
  /** 머리글 행 변경(뷰어 행 번호 클릭/선택) → 재추출·재매핑. */
  function setHeaderRow(idx: number): void {
    if (!parse) return
    ingest({
      ...parse,
      headerRowIndex: idx,
      rows: extractRows(parse.aoa, idx, parse.columns),
      warnings: parse.warnings,
    })
  }

  function patchMapping(taskId: string, patch: Partial<BoqTaskMapping>): void {
    setMappings((prev) => prev.map((m) => (m.taskId === taskId ? { ...m, ...patch } : m)))
  }
  function toggle(taskId: string): void {
    setInclude((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  function onApply(): void {
    const items = mappings
      .filter((m) => include.has(m.taskId) && m.quantity != null && m.quantity > 0)
      .map((m) => ({ taskId: m.taskId, quantity: m.quantity, unit: m.unit, workCode: m.workCode }))
    if (items.length === 0) return
    const r = a().importBoqQuantities(items)
    setResult(r.applied)
    setInclude(new Set())
  }

  const includedCount = mappings.filter(
    (m) => include.has(m.taskId) && m.quantity != null && m.quantity > 0,
  ).length
  const colCount = parse ? Math.max(0, ...parse.aoa.map((r) => r.length)) : 0

  return (
    <Modal
      title="📥 내역서·수량산출서 취입 (BoQ)"
      sub="엑셀·CSV·HWPX·PDF에서 물량을 읽어 공정에 연결합니다 — 확인한 항목만 반영됩니다"
      width={760}
      onClose={onClose}
      footer={(close) => (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%' }}>
          {result != null && (
            <span style={{ fontSize: 13, color: '#1f9d63', fontWeight: 600 }}>
              ✓ {result}개 공정에 물량 반영
            </span>
          )}
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={close}>
            닫기
          </button>
          <button
            className="btn btn--primary"
            disabled={readOnly || includedCount === 0}
            title={readOnly ? '조회 전용 — 반영 불가' : undefined}
            onClick={onApply}
          >
            선택 반영{includedCount > 0 ? ` (${includedCount})` : ''}
          </button>
        </div>
      )}
    >
      {/* ① 불러오기 */}
      <section style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn--sm" disabled={busy} onClick={() => void onPick()}>
            {busy ? '읽는 중…' : '📄 파일 선택 (엑셀·CSV·HWPX·PDF)'}
          </button>
          <button className="btn btn--sm btn--ghost" onClick={() => setManual(manual == null ? '' : null)}>
            ✎ 붙여넣기
          </button>
          {fileName && <span style={{ fontSize: 12.5, color: '#5b6b7a' }}>{fileName}</span>}
        </div>
        {message && (
          <div
            style={{
              marginTop: 8,
              background: '#fbf1dc',
              border: '1px solid #f0d9a8',
              borderRadius: 8,
              padding: '8px 10px',
              fontSize: 12.5,
              color: '#8a5a12',
            }}
          >
            {message}
          </div>
        )}
        {manual != null && (
          <div style={{ marginTop: 8 }}>
            <textarea
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder={'항목,단위,수량\n토사 굴착,㎥,1040\n옹벽,span(15m),2'}
              style={{
                width: '100%',
                minHeight: 90,
                fontFamily: 'monospace',
                fontSize: 12,
                padding: 8,
                borderRadius: 8,
                border: '1px solid #e2e8ee',
                resize: 'vertical',
              }}
            />
            <button className="btn btn--sm" style={{ marginTop: 6 }} onClick={onManualParse}>
              텍스트 인식
            </button>
          </div>
        )}
      </section>

      {/* ② 시트 뷰어 — 열 위 드롭다운으로 역할 지정 + 행 번호 클릭으로 머리글 지정 */}
      {parse && colCount > 0 && (
        <section style={{ marginBottom: 12 }}>
          <div
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'center',
              flexWrap: 'wrap',
              fontSize: 12.5,
              marginBottom: 6,
            }}
          >
            <b>시트 미리보기 — 열 선택</b>
            <span style={{ color: '#5b6b7a' }}>
              각 열 위 칸에서 <b>항목·단위·수량·규격</b>을 고르세요. 행 번호를 누르면 그 행이 머리글이
              됩니다.
            </span>
            <span style={{ flex: 1 }} />
            <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              머리글 행
              <select
                value={parse.headerRowIndex}
                onChange={(e) => setHeaderRow(Number(e.target.value))}
              >
                <option value={-1}>없음</option>
                {parse.aoa.slice(0, BOQ_PREVIEW_ROWS).map((_, r) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: 미리보기 행 인덱스 고정
                  <option key={r} value={r}>
                    {r + 1}행
                  </option>
                ))}
              </select>
            </label>
            <span
              style={{
                fontWeight: 600,
                color: parse.columns.name >= 0 && parse.columns.qty >= 0 ? '#1f9d63' : '#b0392e',
              }}
            >
              인식 {parse.rows.length}행
              {parse.columns.name < 0 || parse.columns.qty < 0 ? ' · 항목·수량 열 지정 필요' : ''}
            </span>
          </div>
          <div
            style={{
              overflow: 'auto',
              maxHeight: 300,
              border: '1px solid #e2e8ee',
              borderRadius: 8,
            }}
          >
            <table style={{ borderCollapse: 'collapse', fontSize: 12, whiteSpace: 'nowrap' }}>
              <thead>
                <tr>
                  <th style={boqCorner}>#</th>
                  {Array.from({ length: colCount }, (_, c) => {
                    const role = roleOfColumn(c)
                    return (
                      // biome-ignore lint/suspicious/noArrayIndexKey: 고정 열 인덱스
                      <th
                        key={c}
                        style={{
                          ...boqColHead,
                          background: role !== 'none' ? BOQ_ROLE_COLOR[role] : '#f6f9fb',
                        }}
                      >
                        <select
                          value={role}
                          style={{ width: '100%', fontSize: 11 }}
                          onChange={(e) => assignRole(c, e.target.value as ColRole)}
                        >
                          <option value="none">— {c + 1}열</option>
                          <option value="name">항목</option>
                          <option value="unit">단위</option>
                          <option value="qty">수량</option>
                          <option value="spec">규격</option>
                        </select>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {parse.aoa.slice(0, BOQ_PREVIEW_ROWS).map((row, r) => {
                  const isHeader = r === parse.headerRowIndex
                  const isData = parse.headerRowIndex >= 0 && r > parse.headerRowIndex
                  const dim = parse.headerRowIndex >= 0 && !isHeader && !isData
                  return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: 고정 행 인덱스
                    <tr key={r} style={{ background: isHeader ? '#eaf2f8' : undefined, opacity: dim ? 0.5 : 1 }}>
                      <td
                        style={{
                          ...boqRowHead,
                          cursor: 'pointer',
                          fontWeight: isHeader ? 800 : 400,
                          color: isHeader ? '#0e5aa6' : '#8794a1',
                        }}
                        title="이 행을 머리글로 지정"
                        onClick={() => setHeaderRow(r)}
                      >
                        {r + 1}
                        {isHeader ? ' ▸' : ''}
                      </td>
                      {Array.from({ length: colCount }, (_, c) => {
                        const role = roleOfColumn(c)
                        return (
                          // biome-ignore lint/suspicious/noArrayIndexKey: 고정 셀 인덱스
                          <td
                            key={c}
                            style={{
                              ...boqCell,
                              background: role !== 'none' && isData ? BOQ_ROLE_COLOR[role] : undefined,
                            }}
                          >
                            {String(row[c] ?? '')}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {parse.aoa.length > BOQ_PREVIEW_ROWS && (
            <div style={{ fontSize: 11, color: '#8794a1', marginTop: 4 }}>
              · 표는 앞 {BOQ_PREVIEW_ROWS}행 미리보기(반영은 전체 {parse.aoa.length}행 대상)
            </div>
          )}
        </section>
      )}

      {/* ③ 매핑 표 */}
      {mappings.length > 0 && (
        <section>
          <div style={{ fontSize: 12.5, color: '#5b6b7a', marginBottom: 6 }}>
            공정에 연결된 물량을 확인·수정한 뒤 체크한 항목만 반영합니다. 공종코드는 표준 일작업량
            DB와 매칭돼 이론 작업일수·적정성 판정에 쓰입니다.
          </div>
          <div
            style={{
              maxHeight: 320,
              overflowY: 'auto',
              border: '1px solid #e2e8ee',
              borderRadius: 8,
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ position: 'sticky', top: 0, background: '#f6f9fb' }}>
                  <th style={thStyle}></th>
                  <th style={thStyle}>공정</th>
                  <th style={thStyle}>BoQ 항목</th>
                  <th style={{ ...thStyle, textAlign: 'right', width: 90 }}>물량</th>
                  <th style={{ ...thStyle, width: 80 }}>단위</th>
                  <th style={{ ...thStyle, width: 220 }}>공종코드(표준 일작업량)</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((m) => {
                  const on = include.has(m.taskId)
                  const applicable = m.quantity != null && m.quantity > 0
                  return (
                    <tr key={m.taskId} style={{ borderTop: '1px solid #eef2f6', opacity: applicable ? 1 : 0.6 }}>
                      <td style={tdStyle}>
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={!applicable || readOnly}
                          onChange={() => toggle(m.taskId)}
                        />
                      </td>
                      <td style={tdStyle}>{m.taskName}</td>
                      <td style={{ ...tdStyle, color: m.row ? '#16222e' : '#b0392e' }}>
                        {m.row ? m.row.name : '미매칭 — 물량 직접 입력'}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <input
                          type="number"
                          value={m.quantity ?? ''}
                          min={0}
                          step="any"
                          style={numInput}
                          onChange={(e) => {
                            const v = e.target.value
                            patchMapping(m.taskId, {
                              quantity: v === '' ? undefined : Math.max(0, Number(v)),
                            })
                          }}
                        />
                      </td>
                      <td style={tdStyle}>
                        <input
                          type="text"
                          value={m.unit ?? ''}
                          style={{ ...numInput, width: 64, textAlign: 'left' }}
                          onChange={(e) => patchMapping(m.taskId, { unit: e.target.value })}
                        />
                      </td>
                      <td style={tdStyle}>
                        <select
                          value={m.workCode ?? ''}
                          style={{ width: '100%', fontSize: 12 }}
                          onChange={(e) =>
                            patchMapping(m.taskId, { workCode: e.target.value || undefined })
                          }
                        >
                          <option value="">(없음)</option>
                          {STANDARD_RATE_OPTIONS.map((o) => (
                            <option key={o.code} value={o.code}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </Modal>
  )
}

const BOQ_PREVIEW_ROWS = 60
const BOQ_ROLE_COLOR: Record<Exclude<ColRole, 'none'>, string> = {
  name: '#e8f3fb',
  unit: '#eef8f0',
  qty: '#fbf1dc',
  spec: '#f0eef7',
}
const boqCorner: CSSProperties = {
  position: 'sticky',
  left: 0,
  top: 0,
  zIndex: 2,
  background: '#eef2f6',
  padding: '3px 6px',
  border: '1px solid #e2e8ee',
  fontSize: 11,
  color: '#8794a1',
}
const boqColHead: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 1,
  padding: 2,
  border: '1px solid #e2e8ee',
  minWidth: 72,
}
const boqRowHead: CSSProperties = {
  position: 'sticky',
  left: 0,
  background: '#f6f9fb',
  padding: '3px 6px',
  border: '1px solid #e2e8ee',
  textAlign: 'right',
  fontSize: 11,
}
const boqCell: CSSProperties = {
  padding: '3px 6px',
  border: '1px solid #eef2f6',
  maxWidth: 220,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}
const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '7px 8px',
  fontSize: 11.5,
  fontWeight: 700,
  color: '#5b6b7a',
  borderBottom: '1px solid #e2e8ee',
}
const tdStyle: CSSProperties = { padding: '5px 8px', verticalAlign: 'middle' }
const numInput: CSSProperties = {
  width: 80,
  textAlign: 'right',
  fontSize: 12,
  padding: '3px 5px',
  border: '1px solid #e2e8ee',
  borderRadius: 5,
}
