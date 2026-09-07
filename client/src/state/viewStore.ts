// 프로젝트 뷰(모듈) 전환 — 총괄 대시보드 · 공정표(편집기) · 건설사업관리 모듈.
// 프로젝트 데이터(useEditor)와 분리된 순수 UI 상태. localStorage로 마지막 선택 기억.

import { create } from 'zustand'
import { MODULE_MAP, type ModuleId } from '../data/modules'

export type ProjectView = ModuleId
const KEY = 'sequence:project-view'

function initialView(): ProjectView {
  try {
    const saved = localStorage.getItem(KEY)
    // 기본 진입 = 총괄 대시보드(예전 HydroNET 동작 준용). 마지막 선택을 기억.
    return saved && saved in MODULE_MAP ? (saved as ProjectView) : 'dashboard'
  } catch {
    return 'dashboard'
  }
}

interface ViewState {
  view: ProjectView
  setView: (view: ProjectView) => void
}

export const useView = create<ViewState>()((set) => ({
  view: initialView(),
  setView: (view) => {
    try {
      localStorage.setItem(KEY, view)
    } catch {
      /* 비브라우저/프라이빗 모드 — 무시 */
    }
    set({ view })
  },
}))
