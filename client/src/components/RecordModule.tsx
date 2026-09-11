// 기록형 모듈 공용 표 — 프로젝트 예산·공사 사업비·인력장비·품질·안전·문서·인허가·시운전·
// 리스크를 각자의 ModuleField 스키마로 렌더한다. 행=ModuleRecord, 열=필드. 계산 컬럼(compute)은
// 다른 필드에서 자동 산출(금액=수량×단가, 잔액=예산−집행). 데이터는 Project.modules[id](사업
// 단위, CRDT root/modules로 동기화). 조회 전용 사용자는 편집 비활성.
import { useMemo, useState } from 'react'
import { MODULE_MAP, type ModuleField, type ModuleId } from '../data/modules'
import { type AnchorResolution, resolveAnchor } from '../engine/anchors'
import { useEditor } from '../state/store'
import { useView } from '../state/viewStore'
import { BoqImportDialog } from './BoqImportDialog'
import { DocumentPanel } from './DocumentPanel'
import { SaveStatusChip } from './SaveStatusChip'

type ComputeSpec = NonNullable<ModuleField['compute']>

/** 너그러운 숫자 파싱 — 천단위 구분기호·공백 제거, NaN→0. */
const toNum = (s: unknown): number => {
  const n = Number(String(s ?? '').replace(/[,\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** 계산 컬럼 값 — mul(금액)은 두 칸 모두, sub(잔액)은 피감수(예산)가 채워져야 계산. */
function computeField(
  compute: ComputeSpec,
  values: Record<string, string>,
): { n: number; empty: boolean } {
  const [a, b] = compute.keys
  const ra = values[a] ?? ''
  const rb = values[b] ?? ''
  const aBlank = ra.trim() === ''
  const bBlank = rb.trim() === ''
  const empty = compute.op === 'mul' ? aBlank || bBlank : aBlank
  const n = compute.op === 'mul' ? toNum(ra) * toNum(rb) : toNum(ra) - toNum(rb)
  return { n, empty }
}

/**
 * 앵커 칩의 표시 규약. **앵커 없음은 경고가 아니다** — 지금까지의 모든 기록이 그 상태이고
 * 합계·보고서 집계는 앵커와 무관하게 돈다. 그래서 중립 회색이고, 주의가 필요한 두 상태
 * (확인 필요·연결 끊김)만 노랑을 쓴다. 빨강은 '반영되지 않음' 전용이라 여기선 쓰지 않는다.
 */
const ANCHOR_CHIP: Record<string, { icon: string; tone: string; label: string; hint: string }> = {
  linked: { icon: '🔗', tone: 'ok', label: '연결됨', hint: '이 공정에 걸려 있습니다' },
  otherSheet: { icon: '🔗', tone: 'muted', label: '다른 시트', hint: '다른 공정표의 공정입니다' },
  needsCheck: {
    icon: '🔎',
    tone: 'warn',
    label: '확인 필요',
    hint: '연결된 공정의 이름이 처음과 다릅니다 — 맞는 공정인지 확인하세요',
  },
  orphan: {
    icon: '⛓️‍💥',
    tone: 'warn',
    label: '연결 끊김',
    hint: '가리키던 공정이 없습니다 — 다시 연결해야 합니다',
  },
  none: {
    icon: '·',
    tone: 'muted',
    label: '사업 단위',
    hint: '공정에 걸지 않은 기록입니다. 지금과 똑같이 사업 전체에 집계됩니다',
  },
}

function AnchorChip({ resolution }: { resolution: AnchorResolution | undefined }) {
  const state = resolution?.state ?? 'none'
  const chip = ANCHOR_CHIP[state]
  const target = resolution?.taskName ?? resolution?.categoryName
  const sheet = state === 'otherSheet' && resolution?.sheetName ? ` (${resolution.sheetName})` : ''
  return (
    <span
      className={`seq-rec__anchor seq-rec__anchor--${chip.tone}`}
      title={`${chip.label}${target ? ` — ${target}${sheet}` : ''}\n${chip.hint}`}
    >
      <span aria-hidden="true">{chip.icon}</span>
      <span className="seq-rec__anchor-sr">
        {chip.label}
        {target ? ` ${target}` : ''}
      </span>
    </span>
  )
}

export function RecordModule({ id }: { id: ModuleId }) {
  const m = MODULE_MAP[id]
  const fields = m.fields ?? []
  const records = useEditor((s) => s.project.modules?.[id])
  const readOnly = useEditor((s) => s.readOnly)
  const add = useEditor((s) => s.addModuleRecord)
  const update = useEditor((s) => s.updateModuleRecord)
  const remove = useEditor((s) => s.deleteModuleRecord)
  const unlink = useEditor((s) => s.clearRecordAnchor)
  // 앵커 해석에는 store 의 원본 project 를 쓴다(미러 보강본이 아니다 — engine/anchors.ts 계약).
  const project = useEditor((s) => s.project)
  const setView = useView((s) => s.setView)
  const [boqOpen, setBoqOpen] = useState(false)
  const [unlinkedOnly, setUnlinkedOnly] = useState(false)
  const allRows = records ?? []

  const resolutions = useMemo(() => {
    const map = new Map<string, AnchorResolution | undefined>()
    for (const r of allRows) map.set(r.id, resolveAnchor(project, r.anchor))
    return map
  }, [allRows, project])

  const anchoredCount = allRows.filter((r) => resolutions.get(r.id)).length
  const rows = unlinkedOnly ? allRows.filter((r) => !resolutions.get(r.id)) : allRows

  // 합계 행: 숫자/계산 컬럼 중 noTotal이 아닌 것(단가·수량 등 합산 무의미 컬럼 제외).
  // 행 수가 적어 매 렌더 인라인 계산으로 충분(memo 불필요).
  const totalFields = fields.filter((f) => (f.type === 'num' || f.compute) && !f.noTotal)
  const totals: Record<string, number> = {}
  for (const f of totalFields) {
    totals[f.key] = rows.reduce((s, r) => {
      if (f.compute) {
        const c = computeField(f.compute, r.values)
        return s + (c.empty ? 0 : c.n)
      }
      return s + toNum(r.values[f.key])
    }, 0)
  }

  return (
    <div className="seq-rec">
      <header className="seq-rec__head">
        <div className="seq-rec__title">
          <span className="seq-rec__icon" aria-hidden="true">
            {m.icon}
          </span>
          <div>
            <h1 className="seq-rec__h1">
              {m.label} <span className="seq-rec__count">{allRows.length}건</span>
              {anchoredCount > 0 && (
                <span className="seq-rec__count" title="공정에 연결된 기록 수">
                  🔗 {anchoredCount}
                </span>
              )}
            </h1>
            <p className="seq-rec__blurb">{m.blurb}</p>
          </div>
        </div>
        <div className="seq-rec__actions">
          <button type="button" className="btn" onClick={() => setView('dashboard')}>
            ← 총괄
          </button>
          {anchoredCount > 0 && (
            <button
              type="button"
              className={`btn btn--sm${unlinkedOnly ? ' btn--primary' : ''}`}
              onClick={() => setUnlinkedOnly((v) => !v)}
              title="아직 공정에 걸지 않은 기록만 추립니다"
            >
              연결 안 됨만 보기
            </button>
          )}
          {!readOnly && (
            id === 'boq' && <button type="button" className="btn" onClick={() => setBoqOpen(true)}>📥 내역서 취입</button>
          )}
          {!readOnly && (
            <button type="button" className="btn btn--primary" onClick={() => add(id)}>
              ＋ 추가
            </button>
          )}
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="seq-rec__empty">
          <p>아직 기록이 없습니다.</p>
          {readOnly ? (
            <p className="seq-rec__note">조회 전용 — 편집 권한이 없습니다.</p>
          ) : (
            <button type="button" className="btn btn--primary" onClick={() => add(id)}>
              ＋ 첫 항목 추가
            </button>
          )}
        </div>
      ) : (
        <div className="seq-rec__tablewrap">
          <table className="seq-rec__table">
            <thead>
              <tr>
                <th className="seq-rec__num">#</th>
                {fields.map((f) => (
                  <th
                    key={f.key}
                    className={f.wide ? 'seq-rec__wide' : f.compute ? 'seq-rec__total' : ''}
                  >
                    {f.label}
                  </th>
                ))}
                {!readOnly && <th className="seq-rec__act" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td className="seq-rec__num">
                    {i + 1}
                    <AnchorChip resolution={resolutions.get(r.id)} />
                  </td>
                  {fields.map((f) => {
                    if (f.compute) {
                      const c = computeField(f.compute, r.values)
                      return (
                        <td key={f.key} className="seq-rec__calc-td">
                          <span className="seq-rec__calc">
                            {c.empty ? '' : c.n.toLocaleString()}
                          </span>
                        </td>
                      )
                    }
                    return (
                      <td key={f.key} className={f.wide ? 'seq-rec__wide' : ''}>
                        <Cell
                          row={i + 1}
                          field={f}
                          value={r.values[f.key] ?? ''}
                          readOnly={readOnly}
                          onChange={(v) => update(id, r.id, { [f.key]: v })}
                        />
                      </td>
                    )
                  })}
                  {!readOnly && (
                    <td className="seq-rec__act">
                      {resolutions.get(r.id) && (
                        <button
                          type="button"
                          className="seq-rec__unlink"
                          title="공정 연결 해제 — 기록은 남고 사업 단위로 되돌아갑니다"
                          aria-label={`${m.label} ${i + 1}행 공정 연결 해제`}
                          onClick={() => unlink(id, r.id)}
                        >
                          🔗
                        </button>
                      )}
                      <button
                        type="button"
                        className="seq-rec__del"
                        title="삭제"
                        aria-label={`${m.label} ${i + 1}행 삭제`}
                        onClick={() => remove(id, r.id)}
                      >
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            {totalFields.length > 0 && (
              <tfoot>
                <tr>
                  <td className="seq-rec__num" />
                  {fields.map((f) => {
                    const isTotal = totalFields.includes(f)
                    return (
                      <td key={f.key} className={isTotal ? 'seq-rec__total' : ''}>
                        {isTotal
                          ? totals[f.key].toLocaleString()
                          : f === fields[0]
                            ? unlinkedOnly
                              ? '합계(연결 안 됨만)'
                              : '합계'
                            : ''}
                      </td>
                    )
                  })}
                  {!readOnly && <td className="seq-rec__act" />}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      <div className="seq-rec__foot">
        <div className="seq-rec__save"><SaveStatusChip /></div>
        <p>기록은 현재 프로젝트에 반영됩니다. 서버 저장 여부는 위 상태에서 확인하세요. 첨부 문서는 별도로 저장됩니다. 공정 연결(🔗)은 선택 사항이며, 합계·보고서 집계는 연결 여부와 무관합니다.</p>
        <button type="button" className="btn btn--sm" onClick={() => setView('report')}>보고서에서 집계 확인 →</button>
      </div>
      <DocumentPanel moduleId={id} readOnly={readOnly} />
      {boqOpen && <BoqImportDialog onClose={() => setBoqOpen(false)} />}
    </div>
  )
}

function Cell({
  row,
  field,
  value,
  readOnly,
  onChange,
}: {
  row: number
  field: ModuleField
  value: string
  readOnly: boolean
  onChange: (v: string) => void
}) {
  if (field.type === 'select') {
    return (
      <select
        aria-label={`${row}행 ${field.label}`}
        className="seq-rec__in"
        value={value}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">—</option>
        {(field.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    )
  }
  const type = field.type === 'date' ? 'date' : field.type === 'num' ? 'number' : 'text'
  return (
    <input
      aria-label={`${row}행 ${field.label}`}
      className="seq-rec__in"
      type={type}
      value={value}
      readOnly={readOnly}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
