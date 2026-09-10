import { lanePalette } from '../styles/theme'
import type { ID, Task } from '../types/model'

/** The top-level process that owns a task. Broken legacy references fall back to the task. */
function rootFromMap(task: Task, byId: Map<ID, Task>): Task {
  let current = task
  const visited = new Set<ID>([task.id])
  while (current.parentId) {
    const parent = byId.get(current.parentId)
    if (!parent || visited.has(parent.id)) break
    visited.add(parent.id)
    current = parent
  }
  return current
}

export function processRoot(task: Task, tasks: Task[]): Task {
  return rootFromMap(task, new Map(tasks.map((item) => [item.id, item])))
}

/** Every task belonging to the same top-level process, including nested descendants. */
export function processTaskIds(task: Task, tasks: Task[]): ID[] {
  const byId = new Map(tasks.map((item) => [item.id, item]))
  const rootId = rootFromMap(task, byId).id
  return tasks.filter((item) => rootFromMap(item, byId).id === rootId).map((item) => item.id)
}

/** A stable colour shared by a process and all of its child/detail processes. */
export function createProcessColorMap(tasks: Task[]): Map<ID, string> {
  const byId = new Map(tasks.map((item) => [item.id, item]))
  const roots = tasks.filter((item) => !item.parentId)
  const groups = new Map<ID, Task[]>()
  for (const task of tasks) {
    const rootId = rootFromMap(task, byId).id
    const group = groups.get(rootId)
    if (group) group.push(task)
    else groups.set(rootId, [task])
  }
  const colors = new Map<ID, string>()
  for (const [rootId, group] of groups) {
    const root = byId.get(rootId) ?? group[0]
    const rootIndex = Math.max(0, roots.findIndex((item) => item.id === rootId))
    const color = root.color ?? group.find((item) => item.color)?.color ?? lanePalette[rootIndex % lanePalette.length]
    for (const task of group) colors.set(task.id, color)
  }
  return colors
}

export function processColor(task: Task, tasks: Task[]): string {
  return createProcessColorMap(tasks).get(task.id) ?? lanePalette[0]
}
