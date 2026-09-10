import { useAuth } from './authStore'

export interface ProjectDocument {
  id: string
  moduleId: string
  category: string
  name: string
  mimeType: string
  size: number
  createdAt: string
  revision?: string
  status?: string
}

interface LocalDocument extends ProjectDocument {
  projectId: string
  blob: Blob
}

const DB_NAME = 'sequence-documents'
const STORE = 'documents'
const memoryDocuments = new Map<string, LocalDocument>()

function authContext() {
  const { mode, entered } = useAuth.getState()
  return { mode, entered }
}

function headers(json = false): HeadersInit {
  const token = authContext().entered?.token
  return { ...(json ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function localAll(): Promise<LocalDocument[]> {
  if (typeof indexedDB === 'undefined') return [...memoryDocuments.values()]
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).getAll()
    request.onsuccess = () => resolve(request.result as LocalDocument[])
    request.onerror = () => reject(request.error)
  })
}

async function localPut(doc: LocalDocument) {
  if (typeof indexedDB === 'undefined') { memoryDocuments.set(doc.id, doc); return }
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(doc)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

export async function listDocuments(projectId: string, moduleId: string): Promise<ProjectDocument[]> {
  const { mode, entered } = authContext()
  if (mode === 'server' && entered) {
    const response = await fetch(`/api/projects/${entered.id}/documents?moduleId=${encodeURIComponent(moduleId)}`, { credentials: 'include', headers: headers() })
    if (!response.ok) throw new Error('문서 목록을 불러오지 못했습니다.')
    return response.json()
  }
  return (await localAll()).filter((doc) => doc.projectId === projectId && doc.moduleId === moduleId)
}

export async function uploadDocument(projectId: string, moduleId: string, category: string, file: File, revision: string, status: string): Promise<void> {
  const { mode, entered } = authContext()
  if (file.size > 8 * 1024 * 1024) throw new Error('파일은 8MB까지 업로드할 수 있습니다.')
  if (mode === 'server' && entered) {
    const data = await file.arrayBuffer()
    const bytes = new Uint8Array(data)
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    const response = await fetch(`/api/projects/${entered.id}/documents`, { method: 'POST', credentials: 'include', headers: headers(true), body: JSON.stringify({ moduleId, category, name: file.name, mimeType: file.type || 'application/octet-stream', revision, status, base64: btoa(binary) }) })
    if (!response.ok) throw new Error('문서 업로드에 실패했습니다.')
    return
  }
  await localPut({ id: crypto.randomUUID(), projectId, moduleId, category, name: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, createdAt: new Date().toISOString(), revision, status, blob: file })
}

export async function getDocumentBlob(projectId: string, documentId: string): Promise<Blob> {
  const { mode, entered } = authContext()
  if (mode === 'server' && entered) {
    const response = await fetch(`/api/projects/${entered.id}/documents/${documentId}/content`, { credentials: 'include', headers: headers() })
    if (!response.ok) throw new Error('문서를 열지 못했습니다.')
    return response.blob()
  }
  const doc = (await localAll()).find((item) => item.projectId === projectId && item.id === documentId)
  if (!doc) throw new Error('문서를 찾지 못했습니다.')
  return doc.blob
}

export async function deleteDocument(_projectId: string, documentId: string): Promise<void> {
  const { mode, entered } = authContext()
  if (mode === 'server' && entered) {
    const response = await fetch(`/api/projects/${entered.id}/documents/${documentId}`, { method: 'DELETE', credentials: 'include', headers: headers() })
    if (!response.ok) throw new Error('문서를 삭제하지 못했습니다.')
    return
  }
  if (typeof indexedDB === 'undefined') { memoryDocuments.delete(documentId); return }
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(documentId)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}
