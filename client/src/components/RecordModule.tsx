// Generic record-table module — drives the 기록형(log-style) 모듈 8종
// (원가·자원·품질·안전·문서·인허가·시운전·리스크) from their ModuleField schema.
// Each module is one table: rows are ModuleRecord, columns are its fields. Data
// lives on Project.modules[id] (project-level, survives 시트 전환). See PACKAGE_PLAN.md.
import { useMemo } from 'react'
import { MODULE_MAP, type ModuleField, type ModuleId } from '../data/modules'
import { useEditor } from '../state/store'
import { useShell } from '../state/shell'

export function RecordModule({ id }: { id: ModuleId }) {
  const m = MODULE_MAP[id]
  const fields = m.fields ?? []
  const records = useEditor((s) => s.project.modules?.[id])
  const add = useEditor((s) => s.addModuleRecord)
  const update = useEditor((s) => s.updateModuleRecord)
  const remove = useEditor((s) => s.deleteModuleRecord)
  const setModule = useShell((s) => s.setModule)
  const rows = records ?? []

  // Sum every numeric column for a footer 합계 row (generic across modules).
  const numKeys = fields.filter((f) => f.type === 'num').map((f) => f.key)
  const totals = useMemo(() => {
    const t: Record<string, number> = {}
    for (const k of numKeys) t[k] = rows.reduce((s, r) => s + (Number(r.values[k]) || 0), 0)
    return t
  }, [rows, numKeys.join(',')])

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
                {fields.map((f) => <th key={f.key} className={f.wide ? 'rec__wide' : ''}>{f.label}</th>)}
                <th className="rec__act" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td className="rec__num">{i + 1}</td>
                  {fields.map((f) => (
                    <td key={f.key} className={f.wide ? 'rec__wide' : ''}>
                      <Cell field={f} value={r.values[f.key] ?? ''}
                        onChange={(v) => update(id, r.id, { [f.key]: v })} />
                    </td>
                  ))}
                  <td className="rec__act">
                    <button className="rec__del" title="삭제" onClick={() => remove(id, r.id)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
            {numKeys.length > 0 && (
              <tfoot>
                <tr>
                  <td className="rec__num" />
                  {fields.map((f) => (
                    <td key={f.key} className={f.type === 'num' ? 'rec__total' : ''}>
                      {f.type === 'num' ? totals[f.key].toLocaleString() : (f === fields[0] ? '합계' : '')}
                    </td>
                  ))}
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
