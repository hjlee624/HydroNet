import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../state/authStore'
import { useEditor } from '../state/store'
import {
  deleteDocument,
  getDocumentBlob,
  listDocuments,
  type ProjectDocument,
  uploadDocument,
} from '../state/documentStore'
import { BoqImportDialog } from './BoqImportDialog'

const MODULE_CATEGORIES: Record<string, string[]> = {
  cost: ['예산서', '집행증빙', '세금계산서', '원가보고'],
  boq: ['내역서', '수량산출서', '견적서', '단가근거'],
  resource: ['인력명부', '장비검사', '투입계획', '자격증'],
  quality: ['검측서', '시험성적서', 'NCR', '점검사진'],
  safety: ['위험성평가', '안전점검', '교육일지', '사고기록'],
  document: ['도면', '제출물', '계약서', '변경문서'],
  permit: ['신청서', '승인서', '기관공문', '보완자료'],
  commissioning: ['시운전기록', '시험성적', '준공도서', '인계서'],
  risk: ['리스크근거', '회의록', '대응계획', '보고서'],
  history: ['변경근거', '회의록', '승인문서'],
  report: ['보고서', '회의자료', '대외제출본'],
}

export function DocumentPanel({ moduleId, readOnly }: { moduleId: string; readOnly: boolean }) {
  const projectId = useEditor((s) => s.project.id)
  const enteredId = useAuth((s) => s.entered?.id)
  return (
    <DocumentPanelContent
      key={`${enteredId ?? 'local'}:${projectId}:${moduleId}`}
      moduleId={moduleId}
      readOnly={readOnly}
    />
  )
}

function DocumentPanelContent({ moduleId, readOnly }: { moduleId: string; readOnly: boolean }) {
  const categories = MODULE_CATEGORIES[moduleId] ?? ['일반 문서']
  const projectId = useEditor((s) => s.project.id)
  const [docs, setDocs] = useState<ProjectDocument[]>([])
  const [category, setCategory] = useState(categories[0] ?? '일반')
  const [revision, setRevision] = useState('')
  const [status, setStatus] = useState('등록')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const alive = useRef(true)
  const request = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<{
    doc: ProjectDocument
    url: string
    text?: string
    file: File
    sheets?: Array<{ name: string; aoa: string[][] }>
    sheet?: number
  } | null>(null)
  const [importFile, setImportFile] = useState<File | null>(null)

  const reload = useCallback(async () => {
    const version = ++request.current
    setLoading(true)
    setError('')
    try {
      const next = await listDocuments(projectId, moduleId)
      if (alive.current && version === request.current) setDocs(next)
    } catch (error) {
      if (alive.current && version === request.current)
        setError(error instanceof Error ? error.message : '문서 목록을 불러오지 못했습니다.')
    } finally {
      if (alive.current && version === request.current) setLoading(false)
    }
  }, [projectId, moduleId])
  useEffect(() => {
    alive.current = true
    void reload()
    return () => {
      alive.current = false
      request.current++
    }
  }, [reload])
  const previewUrl = preview?.url
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    },
    [previewUrl],
  )

  async function onFile(file?: File) {
    if (!file || readOnly || busy) return
    setBusy(true)
    try {
      await uploadDocument(projectId, moduleId, category, file, revision, status)
      if (alive.current) {
        await reload()
        setRevision('')
      }
    } catch (error) {
      if (alive.current) setError(error instanceof Error ? error.message : '업로드에 실패했습니다.')
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  async function open(doc: ProjectDocument) {
    if (busy) return
    setBusy(true)
    setError('')
    let url: string | undefined
    try {
      const blob = await getDocumentBlob(projectId, doc.id)
      if (!alive.current) return
      url = URL.createObjectURL(blob)
      const file = new File([blob], doc.name, { type: doc.mimeType })
      const textual =
        /^(text\/|application\/(json|xml))/.test(doc.mimeType) ||
        /\.(txt|md|csv|json)$/i.test(doc.name)
      if (/\.xlsx?$/i.test(doc.name)) {
        const XLSX = await import('xlsx')
        const workbook = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array' })
        const sheets = workbook.SheetNames.map((name) => ({
          name,
          aoa: XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[name], {
            header: 1,
            raw: false,
            defval: '',
          }) as string[][],
        }))
        if (!alive.current) {
          URL.revokeObjectURL(url)
          return
        }
        setPreview({ doc, url, file, sheets, sheet: 0 })
        return
      }
      const text = textual ? await blob.text() : undefined
      if (!alive.current) {
        URL.revokeObjectURL(url)
        return
      }
      setPreview({ doc, url, file, ...(text !== undefined ? { text } : {}) })
    } catch (error) {
      if (url) URL.revokeObjectURL(url)
      if (alive.current)
        setError(error instanceof Error ? error.message : '문서를 열지 못했습니다.')
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  async function remove(doc: ProjectDocument) {
    if (busy || readOnly || !window.confirm('이 문서를 삭제할까요?')) return
    setBusy(true)
    try {
      await deleteDocument(projectId, doc.id)
      if (alive.current) {
        setPreview(null)
        await reload()
      }
    } catch (error) {
      if (alive.current)
        setError(error instanceof Error ? error.message : '문서를 삭제하지 못했습니다.')
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  return (
    <section className="doc-panel">
      <div className="doc-panel__head">
        <div>
          <h2>첨부 문서</h2>
          <p>이 업무에 필요한 근거 문서와 개정본을 한곳에서 관리합니다.</p>
        </div>
        {!readOnly && (
          <div className="doc-panel__upload">
            <select
              aria-label="문서 분류"
              disabled={busy}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <input
              aria-label="문서 개정"
              disabled={busy}
              value={revision}
              onChange={(e) => setRevision(e.target.value)}
              placeholder="개정 (선택)"
            />
            <select
              aria-label="문서 상태"
              disabled={busy}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option>등록</option>
              <option>검토중</option>
              <option>승인</option>
              <option>반려</option>
            </select>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              {busy ? '처리 중…' : '문서 업로드'}
            </button>
            <input
              ref={fileInput}
              hidden
              type="file"
              disabled={busy}
              onChange={(e) => {
                void onFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </div>
        )}
      </div>
      {error && (
        <div role="alert" className="doc-panel__error">
          {error}{' '}
          <button
            type="button"
            className="btn btn--sm"
            disabled={busy || loading}
            onClick={() => void reload()}
          >
            목록 다시 불러오기
          </button>
        </div>
      )}
      {loading ? (
        <p role="status" className="doc-panel__empty">
          문서 목록을 불러오는 중…
        </p>
      ) : docs.length === 0 ? (
        <p className="doc-panel__empty">
          {error ? '문서 목록을 확인할 수 없습니다.' : '등록된 문서가 없습니다.'}
        </p>
      ) : (
        <div className="doc-panel__list">
          {docs.map((doc) => (
            <article key={doc.id} className="doc-card">
              <button type="button" className="doc-card__name" disabled={busy} onClick={() => void open(doc)}>
                {doc.name}
              </button>
              <span>{doc.category}</span>
              <span>
                {doc.revision || '원본'} · {doc.status || '등록'}
              </span>
              <span>{Math.ceil(doc.size / 1024).toLocaleString()}KB</span>
              {!readOnly && (
                <button
                  type="button"
                  className="seq-rec__del"
                  title="삭제"
                  aria-label={`${doc.name} 삭제`}
                  disabled={busy}
                  onClick={() => void remove(doc)}
                >
                  ✕
                </button>
              )}
            </article>
          ))}
        </div>
      )}
      {preview && (
        <div className="doc-viewer">
          <div className="doc-viewer__bar">
            <strong>{preview.doc.name}</strong>
            {preview.sheets && (
              <>
                <select
                  aria-label="미리보기 시트"
                  value={preview.sheet ?? 0}
                  onChange={(e) => setPreview({ ...preview, sheet: Number(e.target.value) })}
                >
                  {preview.sheets.map((sheet, i) => (
                    <option key={sheet.name} value={i}>
                      {sheet.name}
                    </option>
                  ))}
                </select>
                {moduleId === 'boq' && !readOnly && (
                  <button type="button" className="btn btn--primary" onClick={() => setImportFile(preview.file)}>
                    시트 선택·공정표 반영
                  </button>
                )}
              </>
            )}
            <a className="btn" href={preview.url} download={preview.doc.name}>
              다운로드
            </a>
            <button type="button" className="btn" onClick={() => setPreview(null)}>
              닫기
            </button>
          </div>
          {preview.sheets ? (
            <div className="doc-sheet">
              <table>
                <tbody>
                  {preview.sheets[preview.sheet ?? 0]?.aoa.slice(0, 100).map((row, r) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: Immutable spreadsheet preview uses physical row coordinates.
                    <tr key={r}>
                      {row.slice(0, 30).map((cell, c) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: Immutable spreadsheet preview uses physical column coordinates.
                        <td key={c}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : preview.doc.mimeType.startsWith('image/') ? (
            <img src={preview.url} alt={preview.doc.name} />
          ) : preview.doc.mimeType === 'application/pdf' || /\.pdf$/i.test(preview.doc.name) ? (
            <iframe src={preview.url} title={preview.doc.name} />
          ) : preview.text !== undefined ? (
            <pre>{preview.text}</pre>
          ) : (
            <div className="doc-viewer__fallback">
              <p>이 형식은 브라우저에서 바로 표시할 수 없습니다.</p>
              <p>개정·상태 정보를 확인한 뒤 다운로드하여 원본 프로그램에서 여세요.</p>
            </div>
          )}
        </div>
      )}
      {importFile && (
        <BoqImportDialog initialFile={importFile} onClose={() => setImportFile(null)} />
      )}
    </section>
  )
}
