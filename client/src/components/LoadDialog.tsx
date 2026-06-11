// 불러오기 — recover a previously auto-saved project (filename = milestone name).
// Lists the server's named temp snapshots (falls back to the by-id store on a
// server without autosave) and loads the selected one into the editor.

import { useEffect, useState } from 'react'
import type { MouseEvent as RMouseEvent } from 'react'
import { useEditor } from '../state/store'
import { Modal } from './Modal'
import { listAutosaves, loadAutosave, deleteAutosave, type AutosaveItem } from '../state/api'

export function LoadDialog({ onClose }: { onClose: () => void }) {
  const a = useEditor.getState
  const [items, setItems] = useState<AutosaveItem[] | null>(null)
  const [dir, setDir] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const r = await listAutosaves()
      if (alive) { setItems(r.items); setDir(r.dir) }
    })()
    return () => { alive = false }
  }, [])

  async function load(file: string) {
    setBusy(true); setMsg(null)
    try {
      const p = await loadAutosave(file)
      if (p) { a().setProject(p); onClose(); return }
      setMsg('파일을 불러오지 못했습니다.')
    } catch {
      setMsg('파일을 불러오지 못했습니다. (형식 오류일 수 있습니다)')
    } finally {
      setBusy(false)
    }
  }

  async function remove(file: string, e: RMouseEvent) {
    e.stopPropagation()
    await deleteAutosave(file)
    setItems((prev) => (prev ?? []).filter((i) => i.file !== file))
  }

  const fmtDate = (iso: string) => (iso || '').replace('T', ' ').slice(0, 16)
  const fmtSize = (n: number) => (n > 0 ? `${Math.max(1, Math.round(n / 1024))} KB` : '')

  return (
    <Modal title="불러오기 · 임시저장 복구" sub={`저장 위치: ${dir || '…'}`} width={560} onClose={onClose}>
      {items === null ? (
        <p className="note" style={{ padding: '8px 0' }}>목록을 불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="note" style={{ padding: '8px 0' }}>저장된 임시 파일이 없습니다. 작업을 진행하면 자동으로 임시저장됩니다.</p>
      ) : (
        <div className="load-list">
          {items.map((it) => (
            <div className="load-row" key={it.file} onClick={() => { if (!busy) void load(it.file) }} title="클릭해서 불러오기">
              <span className="load-name">{it.name}</span>
              <span className="load-meta">{fmtDate(it.updatedAt)}{it.size ? ` · ${fmtSize(it.size)}` : ''}</span>
              <button className="icon-btn" title="삭제" onClick={(e) => void remove(it.file, e)}>×</button>
            </div>
          ))}
        </div>
      )}
      {msg && <p className="note" style={{ color: 'var(--primary-deep)' }}>{msg}</p>}
      <p className="note" style={{ marginTop: 8 }}>
        작업 내용은 파일명 = 마일스톤(프로젝트) 이름으로 자동 임시저장됩니다. 항목을 클릭하면 그 시점 내용을 불러옵니다.
      </p>
    </Modal>
  )
}
