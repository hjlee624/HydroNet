// ─────────────────────────────────────────────────────────────────────────────
// 예정공정표 ↔ 마일스톤 연동 (요구사항 4)
//
// 설계 사업은 '예정공정표'(role 'plan' — 공종/공정을 편집하는 원본)와 '시공 마일스톤'
// (role 'milestone' — 최종 출력) 두 시트를 가진다. 사용자가 마일스톤 시트에서
// view.mirrorPlan을 켜면, 예정공정표의 공종/공정을 마일스톤 차트에 **라이브로 함께 표시**한다.
//
//  • 표시 전용(드래그/선택/편집 불가) — 원본은 예정공정표에서만 편집.
//  • 마일스톤에서만 개별 공정을 숨길 수 있다(view.mirrorHidden) — 예정공정표 원본은 불변.
//  • 같은 이름의 공종은 마일스톤 자체 공종으로 흡수, 없는 공종은 뒤에 새 레인으로 추가.
//
// 모든 함수는 순수(부수효과 없음). augmentForMirror가 반환하는 새 Project는 컴포넌트
// 본문(useMemo)에서만 만들고 zustand 셀렉터로 반환하지 말 것(스냅샷 불안정 → 빈 화면).
// ─────────────────────────────────────────────────────────────────────────────

import type { Category, ID, Link, Project, Sheet, Task } from '../types/model'

function planSheet(project: Project): Sheet | null {
  return project.sheets?.find((s) => s.role === 'plan') ?? null
}

/** 미러 모드가 실제로 작동하는 상태인지(토글 ON + 활성 시트가 마일스톤 + plan 시트 존재). */
export function mirrorActive(project: Project): boolean {
  return (
    !!project.view.mirrorPlan && project.activeSheet?.role === 'milestone' && !!planSheet(project)
  )
}

/** 예정 공종 → 표시(병합) 공종 id 매핑 + 예정 전용으로 새로 추가할 공종들.
 *  이름(trim) 일치는 마일스톤 자체 공종으로 흡수하고, 없으면 새 id(`mir-cat-…`)로 뒤에 붙인다.
 *  숨김(hidden) 처리된 예정 공종은 제외한다. */
function mergePlanCategories(
  project: Project,
  plan: Sheet,
): { remap: Map<ID, ID>; extraCats: Category[] } {
  const byName = new Map<string, ID>()
  for (const c of project.categories) byName.set(c.name.trim(), c.id)
  const remap = new Map<ID, ID>()
  const extraCats: Category[] = []
  let order = project.categories.reduce((m, c) => Math.max(m, c.order), -1) + 1
  for (const pc of [...plan.categories]
    .filter((c) => !c.hidden)
    .sort((a, b) => a.order - b.order)) {
    const key = pc.name.trim()
    const hit = byName.get(key)
    if (hit) {
      remap.set(pc.id, hit)
      continue
    }
    const nid = `mir-cat-${pc.id}`
    remap.set(pc.id, nid)
    byName.set(key, nid) // 같은 이름의 예정 공종 둘은 한 레인으로 합친다
    extraCats.push({ ...pc, id: nid, order: order++ })
  }
  return { remap, extraCats }
}

/** 마일스톤 차트용 — 예정공정표의 공종/공정을 병합한 새 Project를 반환(미러 비활성 시 그대로).
 *  마일스톤에서 숨긴(view.mirrorHidden) 공정과 예정에서 숨긴(t.hidden) 공정은 제외한다. */
export function augmentForMirror(project: Project): Project {
  if (!mirrorActive(project)) return project
  const plan = planSheet(project)!
  const hidden = new Set(project.view.mirrorHidden ?? [])
  const { remap, extraCats } = mergePlanCategories(project, plan)

  const mirrorTasks: Task[] = []
  for (const t of plan.tasks) {
    if (t.hidden || hidden.has(t.id)) continue
    const cat = remap.get(t.categoryId)
    if (!cat) continue
    mirrorTasks.push({ ...t, categoryId: cat, __mirror: true })
  }
  const visible = new Set(mirrorTasks.map((t) => t.id))
  const mirrorLinks: Link[] = plan.links.filter((l) => visible.has(l.from) && visible.has(l.to))

  return {
    ...project,
    categories: [...project.categories, ...extraCats],
    tasks: [...project.tasks, ...mirrorTasks],
    links: [...project.links, ...mirrorLinks],
  }
}

/** 사이드바(공종 구성)에 미러 공정을 표시·토글하기 위한 뷰. tasksByCat은 **숨긴 공정도 포함**
 *  해(토글로 되살릴 수 있도록) hidden 플래그와 함께 제공한다. */
export interface MirrorRow {
  id: ID
  name: string
  isMilestone: boolean
  duration: number
  hidden: boolean
}
export interface MirrorView {
  /** 표시 순서대로의 공종 — 마일스톤 자체 공종(planOnly:false) + 예정 전용 공종(planOnly:true). */
  cats: Array<{ id: ID; name: string; color: string; planOnly: boolean }>
  /** 표시 공종 id → 그 아래 미러(예정) 공정들(숨김 포함). */
  tasksByCat: Map<ID, MirrorRow[]>
}
export function planMirrorView(project: Project): MirrorView | null {
  if (!mirrorActive(project)) return null
  const plan = planSheet(project)!
  const hidden = new Set(project.view.mirrorHidden ?? [])
  const { remap, extraCats } = mergePlanCategories(project, plan)
  const cats: MirrorView['cats'] = [
    ...[...project.categories]
      .sort((a, b) => a.order - b.order)
      .map((c) => ({ id: c.id, name: c.name, color: c.color, planOnly: false })),
    ...extraCats.map((c) => ({ id: c.id, name: c.name, color: c.color, planOnly: true })),
  ]
  const tasksByCat = new Map<ID, MirrorRow[]>()
  for (const t of plan.tasks) {
    if (t.hidden) continue
    const cat = remap.get(t.categoryId)
    if (!cat) continue
    const arr = tasksByCat.get(cat) ?? []
    arr.push({
      id: t.id,
      name: t.name,
      isMilestone: t.isMilestone,
      duration: t.duration,
      hidden: hidden.has(t.id),
    })
    tasksByCat.set(cat, arr)
  }
  return { cats, tasksByCat }
}
