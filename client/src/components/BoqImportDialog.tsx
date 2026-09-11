// 내역서·수량산출서(BoQ) 취입 다이얼로그 — 검토서 B3.
//  ① 파일(엑셀/CSV/HWPX/PDF) 또는 붙여넣기 → 표 인식(항목·단위·수량)
//  ② 공정과 자동 매핑(이름 유사도) + 공종코드 추천
//  ③ 사용자가 매핑 표에서 **확인·수정한 것만** [반영] → store.importBoqQuantities(단일 커밋)
//
// 안전 원칙: 모든 파싱은 try/catch 로 감싸 실패 시 붙여넣기(수동)로 degrade 한다 —
// 절대 크래시하거나 미확인 값을 자동 반영하지 않는다. 구버전 .hwp(바이너리)는 파싱이
// 불안정하므로 HWPX/PDF/엑셀 저장을 안내한다(대충 파서로 오류를 만들지 않는다).

import { type CSSProperties, useEffect, useState } from 'react'
import { findStandardRate, STANDARD_RATE_OPTIONS } from '../data/standardRates'
import { compareUnits } from '../engine/units'
import {
  type BoqColumns,
  type BoqParseResult,
  type BoqRow,
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
  | { kind: 'sheets'; sheets: Array<{ name: string; aoa: string[][] }> }
  | { kind: 'text'; text: string; note?: string }
  | { kind: 'error'; message: string }

/** 시트 뷰어에서 한 열에 지정하는 역할. */
type ColRole = 'name' | 'unit' | 'qty' | 'spec' | 'category' | 'price' | 'note' | 'none'

async function readFileToLoaded(file: File): Promise<Loaded> {
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()
  try {
    if (ext === 'csv' || ext === 'txt') {
      return { kind: 'aoa', aoa: parseCsv(await file.text()) }
    }
    if (ext === 'xlsx' || ext === 'xls') {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' })
      // 내역서·수량산출서는 보통 한 파일에 여러 시트 → 전 시트를 읽어 사용자가 고르게 한다.
      const sheets = wb.SheetNames.map((name) => ({
        name,
        aoa: XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], {
          header: 1,
          raw: false,
          defval: '',
        }) as string[][],
      }))
      if (sheets.length === 0) return { kind: 'error', message: '엑셀에 시트가 없습니다.' }
      return { kind: 'sheets', sheets }
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
    return {
      kind: 'error',
      message: `지원하지 않는 형식(.${ext})입니다. 엑셀·CSV·HWPX·PDF를 사용하세요.`,
    }
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

export function BoqImportDialog({ onClose, initialFile }: { onClose: () => void; initialFile?: File }) {
  const project = useEditor((s) => s.project)
  const readOnly = useEditor((s) => s.readOnly)
  const a = useEditor.getState

  const [busy, setBusy] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [parse, setParse] = useState<BoqParseResult | null>(null)
  const [mappings, setMappings] = useState<BoqTaskMapping[]>([])
  // 어떤 공정에도 붙지 않은 BoQ 행 — 조용히 버리지 않고 반영 전에 사용자에게 보여준다.
  const [unmatched, setUnmatched] = useState<BoqRow[]>([])
  const [include, setInclude] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState<string | null>(null)
  const [manual, setManual] = useState<string | null>(null)
  const [result, setResult] = useState<{ applied: number; anchored: number } | null>(null)
  // 다중 시트 엑셀 — 전 시트를 읽어두고 사용자가 선택(rowCount=자동 인식 행 수, 추천용).
  const [sheets, setSheets] = useState<Array<{
    name: string
    aoa: string[][]
    rowCount: number
  }> | null>(null)
  const [activeSheet, setActiveSheet] = useState(0)

  function ingest(res: BoqParseResult): void {
    setParse(res)
    setMessage(res.warnings.join(' ') || null)
    const { mappings: ms, unmatchedRows } = matchRowsToTasks(res.rows, project.tasks)
    setMappings(ms)
    setUnmatched(unmatchedRows)
    // 자동 선택은 '단위가 맞는' 매칭만 — 단위 불일치 행은 사용자가 확인 후 직접 체크한다.
    setInclude(
      new Set(
        ms
          .filter((m) => m.row && m.quantity != null && m.unitCheck?.status !== 'mismatch')
          .map((m) => m.taskId),
      ),
    )
    setResult(null)
  }

  async function loadFile(f: File): Promise<void> {
    setBusy(true)
    setFileName(f.name)
    setManual(null)
    setSheets(null)
    setActiveSheet(0)
    const loaded = await readFileToLoaded(f)
    setBusy(false)
    if (loaded.kind === 'sheets') {
      const withCounts = loaded.sheets.map((s) => ({ ...s, rowCount: parseBoqAoa(s.aoa).rows.length }))
      let idx = 0
      for (let i = 1; i < withCounts.length; i++) if (withCounts[i].rowCount > withCounts[idx].rowCount) idx = i
      setSheets(withCounts)
      setActiveSheet(idx)
      ingest(parseBoqAoa(withCounts[idx].aoa))
    } else if (loaded.kind === 'aoa') ingest(parseBoqAoa(loaded.aoa))
    else if (loaded.kind === 'text') {
      setManual(loaded.text); setMessage(loaded.note ?? '텍스트를 추출했습니다 — 아래에서 정리 후 [텍스트 인식].'); setParse(null); setMappings([]); setUnmatched([])
    } else {
      setManual(''); setMessage(loaded.message); setParse(null); setMappings([]); setUnmatched([])
    }
  }

  useEffect(() => { if (initialFile) void loadFile(initialFile) }, [initialFile])

  async function onPick(): Promise<void> {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.xlsx,.xls,.csv,.txt,.pdf,.hwpx,.hwp'
    input.onchange = async () => {
      const f = input.files?.[0]
      if (!f) return
      await loadFile(f)
    }
    input.click()
  }

  function selectSheet(idx: number): void {
    if (!sheets || !sheets[idx]) return
    setActiveSheet(idx)
    ingest(parseBoqAoa(sheets[idx].aoa))
  }

  function onManualParse(): void {
    if (manual == null) return
    setSheets(null)
    ingest(parseBoqAoa(parseCsv(manual)))
  }

  function setColumns(cols: BoqColumns): void {
    if (!parse) return
    const headerRowIndex = parse.headerRowIndex >= 0 ? parse.headerRowIndex : 0
    const rows = extractRows(parse.aoa, headerRowIndex, cols)
    const next: BoqParseResult = {
      ...parse,
      headerRowIndex,
      columns: cols,
      rows,
      warnings: parse.warnings,
    }
    ingest(next)
  }

  /** 뷰어에서 한 열에 지정된 역할(항목/단위/수량/규격) — 없으면 'none'. */
  function roleOfColumn(c: number): ColRole {
    if (!parse) return 'none'
    for (const k of ['name', 'unit', 'qty', 'spec', 'category', 'price', 'note'] as const) if (parse.columns[k] === c) return k
    return 'none'
  }
  /** 열 c 에 역할을 지정 — 같은 열이 갖던 다른 역할은 해제(역할당 1열 유지). */
  function assignRole(c: number, role: ColRole): void {
    if (!parse) return
    const cols: BoqColumns = { ...parse.columns }
    for (const k of ['name', 'unit', 'qty', 'spec', 'category', 'price', 'note'] as const) if (cols[k] === c) cols[k] = -1
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
    setMappings((prev) =>
      prev.map((m) => {
        if (m.taskId !== taskId) return m
        const next = { ...m, ...patch }
        // 단위·공종코드를 고치면 단위 검사도 즉시 다시 한다(⚠ 표시가 입력을 따라가야 한다).
        if ('unit' in patch || 'workCode' in patch)
          next.unitCheck = compareUnits(next.unit, findStandardRate(next.workCode)?.unit)
        return next
      }),
    )
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
    const included = mappings.filter(
      (m) => include.has(m.taskId) && m.quantity != null && m.quantity > 0,
    )
    const items = included.map((m) => ({
      taskId: m.taskId,
      quantity: m.quantity,
      unit: m.unit,
      workCode: m.workCode,
    }))
    if (items.length === 0 && !parse?.rows.length) return
    // 행↔공정 대응표는 matchRowsToTasks 가 이미 만들어 둔 것이다(m.row 는 parse.rows 의
    // 객체 참조). 지금까지 이 자리에서 버려지고 있었다 — 그대로 넘겨주면 사용자가 아무것도
    // 더 하지 않아도 내역 레코드가 공정에 걸린다. **체크해서 반영한 행만** 앵커를 받고,
    // 미체크·미매칭 행은 종전처럼 앵커 없이 저장된다(저장 건수는 변하지 않는다).
    const taskIdByRow = new Map<object, string>()
    for (const m of included) if (m.row) taskIdByRow.set(m.row, m.taskId)
    const rows = (parse?.rows ?? []).map((row) => {
      const taskId = taskIdByRow.get(row)
      return taskId ? { ...row, taskId } : row
    })
    const r = a().importBoqQuantities(items, rows)
    setResult({ applied: r.applied, anchored: r.anchored })
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
              ✓ {result.applied}개 공정에 물량 반영
              {result.anchored > 0 && ` · 내역 ${result.anchored}건이 공정에 연결됨`}
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
          <button
            className="btn btn--sm btn--ghost"
            onClick={() => setManual(manual == null ? '' : null)}
          >
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

      {/* ①-B 시트 선택 — 내역서/수량산출 엑셀은 보통 여러 시트라 먼저 시트를 고른다 */}
      {sheets && sheets.length > 0 && (
        <section
          style={{
            marginBottom: 10,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            flexWrap: 'wrap',
            fontSize: 12.5,
          }}
        >
          <b>시트</b>
          <select value={activeSheet} onChange={(e) => selectSheet(Number(e.target.value))}>
            {sheets.map((s, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 고정 시트 인덱스
              <option key={i} value={i}>
                {s.name || `시트${i + 1}`}
                {s.aoa.length
                  ? ` (${s.aoa.length}행${s.rowCount ? ` · 인식 ${s.rowCount}` : ''})`
                  : ' · 빈 시트'}
              </option>
            ))}
          </select>
          {sheets.length > 1 && (
            <span style={{ color: '#5b6b7a' }}>
              여러 시트 중 취입할 시트를 고르세요(물량이 있는 시트를 자동 추천).
            </span>
          )}
        </section>
      )}

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
              각 열 위 칸에서 <b>항목·단위·수량·규격</b>을 고르세요. 행 번호를 누르면 그 행이
              머리글이 됩니다.
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
                      <th
                        // biome-ignore lint/suspicious/noArrayIndexKey: 고정 열 인덱스
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
                          <option value="category">공종</option>
                          <option value="price">단가</option>
                          <option value="note">비고</option>
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
                    <tr
                      // biome-ignore lint/suspicious/noArrayIndexKey: 고정 행 인덱스(미리보기 행 번호)
                      key={r}
                      style={{
                        background: isHeader ? '#eaf2f8' : undefined,
                        opacity: dim ? 0.5 : 1,
                      }}
                    >
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
                          <td
                            // biome-ignore lint/suspicious/noArrayIndexKey: 고정 셀 인덱스
                            key={c}
                            style={{
                              ...boqCell,
                              background:
                                role !== 'none' && isData ? BOQ_ROLE_COLOR[role] : undefined,
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

      {/* ②-B 미매칭 행 — 어떤 공정에도 붙지 않은 BoQ 행을 반영 전에 그대로 보여준다 */}
      {unmatched.length > 0 && (
        <section style={{ marginBottom: 12 }}>
          <div
            style={{
              background: '#fdf3f2',
              border: '1px solid #f2cfcb',
              borderRadius: 8,
              padding: '8px 10px',
              fontSize: 12.5,
              color: '#8a3b32',
            }}
          >
            <b>연결되지 않은 BoQ 행 {unmatched.length}건</b> — 이름이 닮은 공정을 찾지 못해 어떤
            공정에도 붙지 않았습니다. 이 물량은 <b>반영되지 않습니다</b>. 아래 매핑 표에서 해당
            공정에 물량을 직접 입력하거나, 공정 이름을 내역서 항목명에 맞춘 뒤 다시 취입하세요.
            <div style={{ maxHeight: 120, overflowY: 'auto', marginTop: 6 }}>
              {unmatched.map((r, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 파싱 순서 고정 목록
                <div key={i} style={{ color: '#5b6b7a' }}>
                  · {r.name}
                  {r.spec ? ` (${r.spec})` : ''} — {r.quantity}
                  {r.unit ?? ''}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ③ 매핑 표 */}
      {mappings.length > 0 && (
        <section>
          <div style={{ fontSize: 12.5, color: '#5b6b7a', marginBottom: 6 }}>
            공정에 연결된 물량을 확인·수정한 뒤 체크한 항목만 반영합니다. 공종코드는 표준 일작업량
            DB와 매칭돼 이론 작업일수·적정성 판정에 쓰입니다. 표준 일작업량과{' '}
            <b>단위가 다른 행은 ⚠</b> 로 표시되며 자동 선택에서 제외됩니다(그대로 반영하면 적정성은
            ‘판정불가’).
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
                  const unitBad = m.unitCheck?.status === 'mismatch'
                  return (
                    <tr
                      key={m.taskId}
                      style={{ borderTop: '1px solid #eef2f6', opacity: applicable ? 1 : 0.6 }}
                    >
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
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                          <input
                            type="text"
                            value={m.unit ?? ''}
                            style={{
                              ...numInput,
                              width: 56,
                              textAlign: 'left',
                              ...(unitBad
                                ? { border: '1px solid #c33b3b', background: '#fdf3f2' }
                                : {}),
                            }}
                            onChange={(e) => patchMapping(m.taskId, { unit: e.target.value })}
                          />
                          {unitBad && (
                            <span
                              title={m.unitCheck?.message}
                              style={{ color: '#c33b3b', fontWeight: 700, cursor: 'help' }}
                            >
                              ⚠
                            </span>
                          )}
                        </span>
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
  category: '#eaf4f4',
  price: '#fff0e6',
  note: '#f5f5f5',
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
