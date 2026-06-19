// 사용자 지정 경로로 프로젝트를 .json 파일에 저장 / 불러오기. 자동저장이 아니라
// 사용자가 "저장"·"불러오기"를 누를 때만 동작한다.
//
// 우선 File System Access API(showSaveFilePicker/showOpenFilePicker)로 실제 폴더·
// 파일명을 직접 고르게 한다(Chrome/Edge, localhost·https). file:// 단일 HTML이나
// LAN(http, 비보안 컨텍스트)처럼 이 API가 막힌 환경에서는 자동으로
//  · 저장 → 다운로드(브라우저의 "저장 위치 확인" 설정 시 경로 선택 가능)
//  · 불러오기 → 파일 선택창(<input type=file>, 어떤 경로든 열기)
// 으로 폴백한다. AbortError(사용자 취소)는 조용히 무시한다.

import type { Project } from '../types/model'

// File System Access API는 ES2021 DOM 타입에 없을 수 있어 최소한으로 선언한다.
declare global {
  interface Window {
    showSaveFilePicker?: (opts?: unknown) => Promise<FileSystemWritableHandleLike>
    showOpenFilePicker?: (opts?: unknown) => Promise<FileSystemFileHandleLike[]>
  }
}
interface FileSystemWritableHandleLike {
  createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>
}
interface FileSystemFileHandleLike {
  getFile: () => Promise<{ text: () => Promise<string> }>
}

const isAbort = (e: unknown): boolean => (e as { name?: string } | null)?.name === 'AbortError'

/** 파일명에 못 쓰는 문자를 정리한 안전한 기본 파일명. */
function safeFileName(name: string): string {
  const base = (name || 'HydroNet').replace(/[\\/:*?"<>|]+/g, '_').trim()
  return (base || 'HydroNet') + '.json'
}

const PICK_TYPES = [{ description: 'HydroNet 프로젝트(JSON)', accept: { 'application/json': ['.json'] } }]

/** 프로젝트를 사용자가 고른 경로의 .json으로 저장. 저장하면 true, 사용자가 취소하면 false. */
export async function saveProjectToFile(project: Project): Promise<boolean> {
  const json = JSON.stringify(project, null, 2)
  const suggestedName = safeFileName(project.name)

  if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName, types: PICK_TYPES })
      const writable = await handle.createWritable()
      await writable.write(json)
      await writable.close()
      return true
    } catch (e) {
      if (isAbort(e)) return false // 사용자가 취소
      // 그 외(파일:// 보안 제한 등) → 아래 다운로드 폴백
    }
  }
  downloadText(json, suggestedName)
  return true
}

function downloadText(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 사용자가 고른 .json을 읽어 Project로 파싱. 취소 시 null. 형식 오류 시 throw. */
export async function openProjectFromFile(): Promise<Project | null> {
  const text = await pickFileText()
  if (text == null) return null // 취소
  return parseProject(text)
}

async function pickFileText(): Promise<string | null> {
  if (typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function') {
    try {
      const [handle] = await window.showOpenFilePicker({ types: PICK_TYPES, multiple: false })
      const file = await handle.getFile()
      return await file.text()
    } catch (e) {
      if (isAbort(e)) return null // 사용자가 취소
      // 그 외(파일:// 보안 제한 등) → 아래 <input> 폴백
    }
  }
  return pickFileTextViaInput()
}

function pickFileTextViaInput(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = async () => {
      const f = input.files && input.files[0]
      resolve(f ? await f.text() : null)
    }
    input.click()
  })
}

function parseProject(text: string): Project {
  const obj = JSON.parse(text) as unknown
  if (
    !obj || typeof obj !== 'object' ||
    !Array.isArray((obj as Project).tasks) ||
    !Array.isArray((obj as Project).categories)
  ) {
    throw new Error('올바른 HydroNet 프로젝트 파일이 아닙니다.')
  }
  return obj as Project
}
