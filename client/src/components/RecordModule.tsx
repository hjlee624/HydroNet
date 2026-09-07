// 기록형 모듈 공용 표 — 프로젝트 예산·공사 사업비·인력장비·품질·안전·문서·인허가·시운전·
// 리스크를 각자의 ModuleField 스키마로 렌더한다. 행=ModuleRecord, 열=필드. 계산 컬럼(compute)은
// 다른 필드에서 자동 산출(금액=수량×단가, 잔액=예산−집행). 데이터는 Project.modules[id](사업
// 단위, CRDT root/modules로 동기화). 조회 전용 사용자는 편집 비활성.
import { MODULE_MAP, type ModuleField, type ModuleId } from '../data/modules'
import { useEditor } from '../state/store'
import { useView } from '../state/viewStore'

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

export function RecordModule({ id }: { id: ModuleId }) {
  const m = MODULE_MAP[id]
  const fields = m.fields ?? []
  const records = useEditor((s) => s.project.modules?.[id])
  const readOnly = useEditor((s) => s.readOnly)
  const add = useEditor((s) => s.addModuleRecord)
  const update = useEditor((s) => s.updateModuleRecord)
  const remove = useEditor((s) => s.deleteModuleRecord)
  const setView = useView((s) => s.setView)
  const rows = records ?? []

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
              {m.label} <span className="seq-rec__count">{rows.length}건</span>
            </h1>
            <p className="seq-rec__blurb">{m.blurb}</p>
          </div>
        </div>
        <div className="seq-rec__actions">
          <button type="button" className="btn" onClick={() => setView('dashboard')}>
            ← 총괄
          </button>
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
                  <td className="seq-rec__num">{i + 1}</td>
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
                      <button
                        type="button"
                        className="seq-rec__del"
                        title="삭제"
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
                        {isTotal ? totals[f.key].toLocaleString() : f === fields[0] ? '합계' : ''}
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
      <p className="seq-rec__foot">
        기록은 사업에 자동 저장·팀원 간 동기화됩니다. 공정(마일스톤)과 연계한 집계·EVM은 순차
        고도화됩니다.
      </p>
    </div>
  )
}

function Cell({
  field,
  value,
  readOnly,
  onChange,
}: {
  field: ModuleField
  value: string
  readOnly: boolean
  onChange: (v: string) => void
}) {
  if (field.type === 'select') {
    return (
      <select
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
      className="seq-rec__in"
      type={type}
      value={value}
      readOnly={readOnly}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
