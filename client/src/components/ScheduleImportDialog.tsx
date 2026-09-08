// 사내 일정표(엑셀·CSV) 취입 다이얼로그 — F12.
//  ① 양식 내려받기 / 파일 선택(엑셀·CSV) 또는 붙여넣기 → 표 인식(번호·공종·공정명·담당자·시작·종료·기간·선행)
//  ② 열 위 드롭다운으로 역할 지정 + 행 번호 클릭으로 머리글 지정(BoqImportDialog 와 동일 조작)
//  ③ **행별 반영 계획**을 신규/갱신/오류 뱃지로 미리 보여주고, 체크한 행만 [선택 반영]
//     → store.importScheduleRows 단일 커밋(= 되돌리기 한 번으로 취입 전체 취소)
//
// 안전 원칙(BoqImportDialog 와 동일): 읽지 못한 행은 **버리지 않고** 붉게 사유와 함께 남기고
// 체크를 막는다. 자동 추측이 곧바로 공정 데이터를 바꾸지 않는다.

import { type CSSProperties, useState } from 'react'
import { downloadScheduleTemplate, exportScheduleXlsx } from '../export/scheduleTemplate'
import { parseCsv } from '../state/boqImport'
import {
  buildSchedulePlan,
  extractScheduleRows,
  parseScheduleAoa,
  type ScheduleColumns,
  type ScheduleParseResult,
  type SchedulePlan,
} from '../state/scheduleImport'
import { useEditor } from '../state/store'
import { Modal } from './Modal'

/** 시트 뷰어에서 한 열에 지정하는 역할. */
type ColRole = keyof ScheduleColumns | 'none'

const ROLE_LABEL: Record<Exclude<ColRole, 'none'>, string> = {
  key: '번호',
  category: '공종',
  name: '공정명',
  owner: '담당자',
  start: '시작일',
  finish: '종료일',
  duration: '기간(일)',
  pred: '선행',
}
const ROLE_KEYS = Object.keys(ROLE_LABEL) as Array<Exclude<ColRole, 'none'>>
const PREVIEW_ROWS = 40

export function ScheduleImportDialog({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project)
  const readOnly = useEditor((s) => s.readOnly)
  const a = useEditor.getState

  const [busy, setBusy] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [parse, setParse] = useState<ScheduleParseResult | null>(null)
  const [plan, setPlan] = useState<SchedulePlan | null>(null)
  const [include, setInclude] = useState<Set<number>>(new Set())
  const [ownerBulk, setOwnerBulk] = useState('')
  const [ownerOverride, setOwnerOverride] = useState<Record<number, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [manual, setManual] = useState<string | null>(null)
  const [result, setResult] = useState<{ created: number; updated: number; linked: number } | null>(
    null,
  )
  const [sheets, setSheets] = useState<Array<{ name: string; aoa: string[][] }> | null>(null)
  const [activeSheet, setActiveSheet] = useState(0)

  function ingest(res: ScheduleParseResult): void {
    setParse(res)
    const next = buildSchedulePlan(project, res.rows)
    setPlan(next)
    setMessage([...res.warnings, ...next.warnings].join(' ') || null)
    // 자동 선택은 읽기에 성공한 행만 — 오류 행은 사용자가 원본을 고쳐 다시 올려야 한다.
    setInclude(new Set(next.items.filter((i) => i.mode !== 'error').map((i) => i.rowIndex)))
    setOwnerOverride({})
    setResult(null)
  }

  async function onPick(): Promise<void> {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.xlsx,.xls,.csv,.txt'
    input.onchange = async () => {
      const f = input.files?.[0]
      if (!f) return
      setBusy(true)
      setFileName(f.name)
      setManual(null)
      setSheets(null)
      setActiveSheet(0)
      try {
        const ext = (f.name.split('.').pop() ?? '').toLowerCase()
        if (ext === 'xlsx' || ext === 'xls') {
          const XLSX = await import('xlsx')
          const wb = XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: 'array' })
          const loaded = wb.SheetNames.map((name) => ({
            name,
            aoa: XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], {
              header: 1,
              raw: false,
              defval: '',
            }) as string[][],
          }))
          if (loaded.length === 0) {
            setMessage('엑셀에 시트가 없습니다.')
          } else {
            // 인식 행이 가장 많은 시트를 기본 선택(추천).
            let idx = 0
            for (let i = 1; i < loaded.length; i++) {
              if (
                parseScheduleAoa(loaded[i].aoa).rows.length >
                parseScheduleAoa(loaded[idx].aoa).rows.length
              )
                idx = i
            }
            setSheets(loaded)
            setActiveSheet(idx)
            ingest(parseScheduleAoa(loaded[idx].aoa))
          }
        } else {
          ingest(parseScheduleAoa(parseCsv(await f.text())))
        }
      } catch (e) {
        setParse(null)
        setPlan(null)
        setManual('')
        setMessage(
          `파일을 읽지 못했습니다(${(e as Error)?.message ?? '알 수 없는 오류'}). 표를 복사해 아래에 붙여넣기 하세요.`,
        )
      }
      setBusy(false)
    }
    input.click()
  }

  function setColumns(cols: ScheduleColumns): void {
    if (!parse) return
    const headerRowIndex = parse.headerRowIndex >= 0 ? parse.headerRowIndex : 0
    ingest({
      ...parse,
      headerRowIndex,
      columns: cols,
      rows: extractScheduleRows(parse.aoa, headerRowIndex, cols),
    })
  }
  function roleOfColumn(c: number): ColRole {
    if (!parse) return 'none'
    for (const k of ROLE_KEYS) if (parse.columns[k] === c) return k
    return 'none'
  }
  function assignRole(c: number, role: ColRole): void {
    if (!parse) return
    const cols: ScheduleColumns = { ...parse.columns }
    for (const k of ROLE_KEYS) if (cols[k] === c) cols[k] = -1
    if (role !== 'none') cols[role] = c
    setColumns(cols)
  }
  function setHeaderRow(idx: number): void {
    if (!parse) return
    ingest({
      ...parse,
      headerRowIndex: idx,
      rows: extractScheduleRows(parse.aoa, idx, parse.columns),
    })
  }
  function toggle(rowIndex: number): void {
    setInclude((prev) => {
      const next = new Set(prev)
      if (next.has(rowIndex)) next.delete(rowIndex)
      else next.add(rowIndex)
      return next
    })
  }
  /** 체크된 행의 담당자를 한 번에 채운다(로컬 상태만 — 반영은 여전히 [선택 반영] 1회). */
  function applyOwnerBulk(): void {
    const v = ownerBulk.trim()
    if (!v || !plan) return
    const next = { ...ownerOverride }
    for (const item of plan.items) if (include.has(item.rowIndex)) next[item.rowIndex] = v
    setOwnerOverride(next)
  }

  function onApply(): void {
    if (!plan) return
    const picked = plan.items.filter((i) => i.mode !== 'error' && include.has(i.rowIndex))
    if (picked.length === 0) return
    const pickedKeys = new Set(picked.map((i) => i.row.key).filter((k): k is string => !!k))
    const r = a().importScheduleRows({
      categories: plan.newCategories,
      tasks: picked.map((i) => ({
        ...(i.taskId ? { taskId: i.taskId } : {}),
        ...(i.row.key ? { extId: i.row.key } : {}),
        categoryName: i.categoryName,
        name: i.row.name,
        start: i.startDay as number,
        duration: i.duration as number,
        ...((ownerOverride[i.rowIndex] ?? i.owner)
          ? { owner: ownerOverride[i.rowIndex] ?? i.owner }
          : {}),
      })),
      // 양 끝이 모두 반영 대상인 연결만 — 반쪽 연결로 유령 링크를 만들지 않는다.
      links: plan.links.filter((l) => pickedKeys.has(l.fromKey) && pickedKeys.has(l.toKey)),
      ...(fileName ? { sourceName: fileName } : {}),
    })
    setResult(r)
    setInclude(new Set())
  }

  const items = plan?.items ?? []
  const errorCount = items.filter((i) => i.mode === 'error').length
  const includedCount = items.filter((i) => i.mode !== 'error' && include.has(i.rowIndex)).length
  const colCount = parse ? Math.max(0, ...parse.aoa.map((r) => r.length)) : 0

  return (
    <Modal
      title="📋 사내 일정표 취입 (엑셀·CSV)"
      sub="번호·공종·공정명·담당자·시작일·종료일·기간·선행을 읽어 공정표에 반영합니다 — 되돌리기 한 번으로 취입 전체를 취소할 수 있습니다"
      width={860}
      onClose={onClose}
      footer={(close) => (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%' }}>
          {result && (
            <span style={{ fontSize: 13, color: '#1f9d63', fontWeight: 600 }}>
              ✓ 신규 {result.created} · 갱신 {result.updated} · 연결 {result.linked}
            </span>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={close}>
            닫기
          </button>
          <button
            type="button"
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
      {/* ① 양식·불러오기 */}
      <section style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn--sm"
            disabled={busy}
            onClick={() => void onPick()}
          >
            {busy ? '읽는 중…' : '📄 파일 선택 (엑셀·CSV)'}
          </button>
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            title="빈 사내 표준 일정표 양식(.xlsx)을 내려받아 채운 뒤 그대로 다시 올리세요"
            onClick={() => void downloadScheduleTemplate()}
          >
            ⬇ 양식 내려받기
          </button>
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            title="현재 공정표를 같은 양식으로 내보내기(엑셀에서 고친 뒤 다시 취입하면 같은 공정이 갱신됩니다)"
            onClick={() => void exportScheduleXlsx(project)}
          >
            ⬆ 현재 공정표 내보내기
          </button>
          <button
            type="button"
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
              placeholder={
                '번호,공종,공정명,담당자,시작일,종료일,기간(일),선행\n1,토공,터파기,김공정,2026-03-02,2026-04-30,60,\n2,토공,되메우기,김공정,2026-05-01,2026-05-20,20,1FS+0'
              }
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
            <button
              type="button"
              className="btn btn--sm"
              style={{ marginTop: 6 }}
              onClick={() => {
                if (manual == null) return
                setSheets(null)
                ingest(parseScheduleAoa(parseCsv(manual)))
              }}
            >
              텍스트 인식
            </button>
          </div>
        )}
      </section>

      {/* ①-B 시트 선택 */}
      {sheets && sheets.length > 1 && (
        <section
          style={{
            marginBottom: 10,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            fontSize: 12.5,
          }}
        >
          <b>시트</b>
          <select
            value={activeSheet}
            onChange={(e) => {
              const idx = Number(e.target.value)
              setActiveSheet(idx)
              ingest(parseScheduleAoa(sheets[idx].aoa))
            }}
          >
            {sheets.map((s, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 고정 시트 인덱스
              <option key={i} value={i}>
                {s.name || `시트${i + 1}`} ({s.aoa.length}행)
              </option>
            ))}
          </select>
        </section>
      )}

      {/* ② 시트 미리보기 — 열 역할 지정 + 머리글 행 지정 */}
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
              각 열 위 칸에서 역할을 고르세요. 행 번호를 누르면 그 행이 머리글이 됩니다.
            </span>
            <span style={{ flex: 1 }} />
            <span
              style={{
                fontWeight: 600,
                color: parse.columns.name >= 0 ? '#1f9d63' : '#b0392e',
              }}
            >
              인식 {parse.rows.length}행{parse.columns.name < 0 ? ' · 공정명 열 지정 필요' : ''}
            </span>
          </div>
          <div
            style={{
              overflow: 'auto',
              maxHeight: 240,
              border: '1px solid #e2e8ee',
              borderRadius: 8,
            }}
          >
            <table style={{ borderCollapse: 'collapse', fontSize: 12, whiteSpace: 'nowrap' }}>
              <thead>
                <tr>
                  <th style={corner}>#</th>
                  {Array.from({ length: colCount }, (_, c) => (
                    <th
                      // biome-ignore lint/suspicious/noArrayIndexKey: 고정 열 인덱스
                      key={c}
                      style={{
                        ...colHead,
                        background: roleOfColumn(c) !== 'none' ? '#e8f3fb' : '#f6f9fb',
                      }}
                    >
                      <select
                        value={roleOfColumn(c)}
                        style={{ width: '100%', fontSize: 11 }}
                        onChange={(e) => assignRole(c, e.target.value as ColRole)}
                      >
                        <option value="none">— {c + 1}열</option>
                        {ROLE_KEYS.map((k) => (
                          <option key={k} value={k}>
                            {ROLE_LABEL[k]}
                          </option>
                        ))}
                      </select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parse.aoa.slice(0, PREVIEW_ROWS).map((row, r) => {
                  const isHeader = r === parse.headerRowIndex
                  return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: 고정 행 인덱스
                    <tr key={r} style={{ background: isHeader ? '#eaf2f8' : undefined }}>
                      <td style={rowHead}>
                        <button
                          type="button"
                          className="btn btn--sm btn--ghost"
                          style={{
                            padding: '0 4px',
                            minWidth: 0,
                            fontWeight: isHeader ? 800 : 400,
                          }}
                          title="이 행을 머리글로 지정"
                          onClick={() => setHeaderRow(r)}
                        >
                          {r + 1}
                          {isHeader ? ' ▸' : ''}
                        </button>
                      </td>
                      {Array.from({ length: colCount }, (_, c) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: 고정 셀 인덱스
                        <td key={c} style={dataCell}>
                          {String(row[c] ?? '')}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ③ 행별 반영 계획 */}
      {items.length > 0 && (
        <section>
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              flexWrap: 'wrap',
              fontSize: 12.5,
              marginBottom: 6,
            }}
          >
            <span style={{ color: '#5b6b7a' }}>
              체크한 행만 반영합니다. <b style={{ color: '#b0392e' }}>오류 {errorCount}행</b>은
              사유를 보고 원본을 고친 뒤 다시 올리세요.
            </span>
            <span style={{ flex: 1 }} />
            <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              선택행 담당자 일괄
              <input
                type="text"
                value={ownerBulk}
                style={{ ...numInput, width: 90, textAlign: 'left' }}
                onChange={(e) => setOwnerBulk(e.target.value)}
              />
              <button type="button" className="btn btn--sm btn--ghost" onClick={applyOwnerBulk}>
                채우기
              </button>
            </label>
          </div>
          <div
            style={{
              maxHeight: 300,
              overflowY: 'auto',
              border: '1px solid #e2e8ee',
              borderRadius: 8,
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ position: 'sticky', top: 0, background: '#f6f9fb' }}>
                  <th style={th}></th>
                  <th style={th}>행</th>
                  <th style={th}>상태</th>
                  <th style={th}>공정명</th>
                  <th style={th}>공종</th>
                  <th style={th}>담당자</th>
                  <th style={th}>시작일</th>
                  <th style={{ ...th, textAlign: 'right' }}>기간</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const bad = item.mode === 'error'
                  return (
                    <tr
                      key={item.rowIndex}
                      style={{
                        borderTop: '1px solid #eef2f6',
                        background: bad ? '#fdecea' : undefined,
                      }}
                    >
                      <td style={td}>
                        <input
                          type="checkbox"
                          checked={!bad && include.has(item.rowIndex)}
                          disabled={bad || readOnly}
                          onChange={() => toggle(item.rowIndex)}
                        />
                      </td>
                      <td style={{ ...td, color: '#8794a1' }}>{item.rowIndex + 1}</td>
                      <td style={td}>
                        <span style={{ ...badge, ...BADGE_STYLE[item.mode] }}>
                          {item.mode === 'create'
                            ? '신규'
                            : item.mode === 'update'
                              ? '갱신'
                              : '오류'}
                        </span>
                        {item.mode === 'update' && item.changed.length > 0 && (
                          <span style={{ marginLeft: 4, color: '#5b6b7a', fontSize: 11 }}>
                            {item.changed.join('·')}
                          </span>
                        )}
                      </td>
                      <td style={td}>{item.row.name}</td>
                      <td style={td}>{item.categoryName}</td>
                      <td style={td}>{ownerOverride[item.rowIndex] ?? item.owner ?? ''}</td>
                      <td style={{ ...td, color: bad ? '#b0392e' : undefined }}>
                        {bad ? item.error : (item.row.startISO ?? '')}
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>{bad ? '' : item.duration}</td>
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

const BADGE_STYLE: Record<'create' | 'update' | 'error', CSSProperties> = {
  create: { background: '#e6f6ec', color: '#1f7a4a' },
  update: { background: '#e8f3fb', color: '#0e5aa6' },
  error: { background: '#fbe3e0', color: '#b0392e' },
}
const badge: CSSProperties = {
  display: 'inline-block',
  padding: '1px 6px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 700,
}
const corner: CSSProperties = {
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
const colHead: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 1,
  padding: 2,
  border: '1px solid #e2e8ee',
  minWidth: 80,
}
const rowHead: CSSProperties = {
  position: 'sticky',
  left: 0,
  background: '#f6f9fb',
  padding: '3px 6px',
  border: '1px solid #e2e8ee',
  textAlign: 'right',
  fontSize: 11,
  color: '#8794a1',
}
const dataCell: CSSProperties = {
  padding: '3px 6px',
  border: '1px solid #eef2f6',
  maxWidth: 200,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}
const th: CSSProperties = {
  textAlign: 'left',
  padding: '7px 8px',
  fontSize: 11.5,
  fontWeight: 700,
  color: '#5b6b7a',
  borderBottom: '1px solid #e2e8ee',
}
const td: CSSProperties = { padding: '5px 8px', verticalAlign: 'middle' }
const numInput: CSSProperties = {
  width: 80,
  fontSize: 12,
  padding: '3px 5px',
  border: '1px solid #e2e8ee',
  borderRadius: 5,
}
