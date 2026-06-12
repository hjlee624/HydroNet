// Generic record-table module — drives the 기록형(log-style) 모듈
// (프로젝트 예산·공사 사업비·자원·품질·안전·문서·인허가·시운전·리스크) from their
// ModuleField schema. Each module is one table: rows are ModuleRecord, columns are
// its fields. Computed columns (compute) auto-derive from other fields (금액=수량×단가,
// 잔액=예산-집행). Data lives on Project.modules[id] (project-level, survives 시트 전환).
import { useMemo } from 'react'
import { MODULE_MAP, type ModuleField, type ModuleId } from '../data/modules'
import { useEditor } from '../state/store'
import { useShell } from '../state/shell'
import { toNum } from '../engine/kpis'

/** 계산 컬럼 값 — 두 숫자 필드를 곱/차로 산출. 미완성 입력이 잘못된 값을 합계에 흘리지
 *  않도록 op별로 empty를 다르게 판정한다: 금액(mul)은 두 칸이 모두 채워져야, 잔액(sub)은
 *  피감수(예산)가 채워져야 계산한다(집행 미입력=0 집행으로 보고 잔액=예산은 타당). */
function computeField(field: ModuleField, values: Record<string, string>): { n: number; empty: boolean } {
  const [a, b] = field.compute!.keys
  const ra = values[a] ?? '', rb = values[b] ?? ''
  const aBlank = ra.trim() === '', bBlank = rb.trim() === ''
  const empty = field.compute!.op === 'mul' ? (aBlank || bBlank) : aBlank
  const n = field.compute!.op === 'mul' ? toNum(ra) * toNum(rb) : toNum(ra) - toNum(rb)
  return { n, empty }
}

export function RecordModule({ id }: { id: ModuleId }) {
  const m = MODULE_MAP[id]
  const fields = m.fields ?? []
  const records = useEditor((s) => s.project.modules?.[id])
  const add = useEditor((s) => s.addModuleRecord)
  const update = useEditor((s) => s.updateModuleRecord)
  const remove = useEditor((s) => s.deleteModuleRecord)
  const setModule = useShell((s) => s.setModule)
  const rows = records ?? []

  // 합계 행: 숫자/계산 컬럼 중 noTotal이 아닌 것만 (단가·수량 등은 합산 무의미 → 제외).
  const totalFields = fields.filter((f) => (f.type === 'num' || f.compute) && !f.noTotal)
  const totalKey = totalFields.map((f) => f.key).join(',')
  // deps는 stable store ref(records)+totalKey만 — rows(=records??[])는 빈 모듈에서 매 렌더
  // 새 [] 라 memo가 헛돈다(빈화면 회귀는 아님). 미완성(empty) compute 행은 합계에서 제외.
  const totals = useMemo(() => {
    const list = records ?? []
    const t: Record<string, number> = {}
    for (const f of totalFields) {
      t[f.key] = list.reduce((s, r) => {
        if (f.compute) { const c = computeField(f, r.values); return s + (c.empty ? 0 : c.n) }
        return s + toNum(r.values[f.key])
      }, 0)
    }
    return t
  }, [records, totalKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="rec">
      <header className="rec__head">
        <div className="rec__title">
          <span className="rec__icon">{m.icon}</span>
          <div>
            <h1 className="rec__h1">{m.label} <span className="rec__count">{rows.length}건</span></h1>
            <p className="rec__blurb">{m.blurb}</p>
          </div>
        </div>
        <div className="rec__actions">
          <button className="btn" onClick={() => setModule('dashboard')}>← 대시보드</button>
          <button className="btn btn--primary" onClick={() => add(id)}>＋ 추가</button>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="rec__empty">
          <p>아직 기록이 없습니다.</p>
          <button className="btn btn--primary" onClick={() => add(id)}>＋ 첫 항목 추가</button>
        </div>
      ) : (
        <div className="rec__tablewrap">
          <table className="rec__table">
            <thead>
              <tr>
                <th className="rec__num">#</th>
                {fields.map((f) => <th key={f.key} className={f.wide ? 'rec__wide' : f.compute ? 'rec__total' : ''}>{f.label}</th>)}
                <th className="rec__act" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td className="rec__num">{i + 1}</td>
                  {fields.map((f) => {
                    if (f.compute) {
                      const c = computeField(f, r.values)
                      return <td key={f.key} className="rec__calc-td"><span className="rec__calc">{c.empty ? '' : c.n.toLocaleString()}</span></td>
                    }
                    return (
                      <td key={f.key} className={f.wide ? 'rec__wide' : ''}>
                        <Cell field={f} value={r.values[f.key] ?? ''} onChange={(v) => update(id, r.id, { [f.key]: v })} />
                      </td>
                    )
                  })}
                  <td className="rec__act">
                    <button className="rec__del" title="삭제" onClick={() => remove(id, r.id)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
            {totalFields.length > 0 && (
              <tfoot>
                <tr>
                  <td className="rec__num" />
                  {fields.map((f) => {
                    const isTotal = totalFields.includes(f)
                    return (
                      <td key={f.key} className={isTotal ? 'rec__total' : ''}>
                        {isTotal ? totals[f.key].toLocaleString() : (f === fields[0] ? '합계' : '')}
                      </td>
                    )
                  })}
                  <td className="rec__act" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      <p className="rec__note">기록은 사업에 자동 저장됩니다. 공정(마일스톤)과 연계한 집계·카드는 순차 고도화됩니다.</p>
    </div>
  )
}

function Cell({ field, value, onChange }: { field: ModuleField; value: string; onChange: (v: string) => void }) {
  if (field.type === 'select') {
    return (
      <select className="rec__in" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }
  const type = field.type === 'date' ? 'date' : field.type === 'num' ? 'number' : 'text'
  return (
    <input className="rec__in" type={type} value={value}
      onChange={(e) => onChange(e.target.value)} />
  )
}
