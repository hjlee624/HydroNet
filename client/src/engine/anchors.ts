// 관리 레코드(예산·공사비·자원·품질·안전·문서·인허가·시운전·리스크) ↔ 공정 백본 연결의
// **유일한 해석기**. 순수 함수만 두고 store·React 에 의존하지 않는다 — 대시보드·기록 표·
// 보고서가 각자 조회하면 같은 앵커를 서로 다르게 판정하기 때문이다(단일 셀렉터 원칙).
//
// ⚠️ 입력 계약 두 가지:
//  1. `augmentForMirror`(engine/mirror.ts) 결과 Project 를 넘기지 말 것. 미러 공정은 예정
//     시트의 id 를 그대로 달고 마일스톤 시트 렌더에 끼어들기 때문에 어느 시트 소속인지가
//     갈린다. 앵커 판정은 언제나 store 의 원본 project 로 한다.
//  2. 공정 조회는 **반드시 시트 스코프 안에서만** 한다(아래 sheetScopes). 문서 전체를 훑어
//     taskId 를 찾으면 안 된다 — 서버 시드는 activeSheet 유무와 무관하게 root/tasks 를 쓰고
//     시트에도 같은 내용을 기록해서, 살아 있는 방이 같은 공정 id 를 두 곳에 중복 보유한다.
//     전체 검색은 이미 화면에 없는 죽은 사본을 '정상 연결'로 판정한다.
import type { Category, ID, ModuleRecord, Project, RecordAnchor, Task } from '../types/model'

/**
 * 앵커 판정 4종. 고아(orphan)만이 '연결이 깨졌다'는 뜻이고, 나머지는 전부 살아 있는 연결이다.
 * - `linked`      정상 — 활성 시트의 공정/공종을 가리킨다.
 * - `otherSheet`  다른 시트의 공정을 가리킨다. 깨진 게 아니라 **지금 화면 밖**일 뿐이다.
 * - `needsCheck`  id 는 맞는데 생성 시점 이름(stamp)과 지금 이름이 다르다. 오연결 의심.
 * - `orphan`      가리키는 공정/공종이 없다. 재지정이 필요하다.
 */
export type AnchorState = 'linked' | 'otherSheet' | 'needsCheck' | 'orphan'

/** 공정 조회가 허용된 범위 — 활성 시트 1개 + 비활성 시트들. 그 밖은 보지 않는다. */
export interface AnchorScope {
  /** 구버전 단일 공정표에는 시트 id 자체가 없다(activeSheet optional). */
  id?: ID
  name: string
  tasks: Task[]
  categories: Category[]
  isActive: boolean
}

export interface AnchorResolution {
  state: AnchorState
  sheetId?: ID
  sheetName?: string
  taskId?: ID
  /** 해석된 현재 이름. orphan 이어도 stamp 가 있으면 '마지막으로 알던 이름'으로 채운다. */
  taskName?: string
  categoryId?: ID
  categoryName?: string
}

/** byTask 인덱스의 한 항목 — 어느 모듈의 어느 레코드가 이 공정에 걸려 있는가. */
export interface AnchorRef {
  moduleId: string
  recordId: ID
  state: AnchorState
}

/**
 * 공정 조회 범위. **활성 시트는 `project.sheets` 에 없다** — projectFromYDoc 이 활성 시트를
 * 최상위(categories/tasks/links)로 펼치고 sheets 에서는 걸러내기 때문이다. 이걸 모르고
 * `project.sheets` 만 순회하면 지금 보고 있는 시트가 통째로 누락된다.
 */
export function sheetScopes(project: Project): AnchorScope[] {
  const active: AnchorScope = {
    ...(project.activeSheet?.id ? { id: project.activeSheet.id } : {}),
    name: project.activeSheet?.name ?? '공정표',
    tasks: project.tasks ?? [],
    categories: project.categories ?? [],
    isActive: true,
  }
  const resident = (project.sheets ?? []).map((sheet) => ({
    id: sheet.id,
    name: sheet.name,
    tasks: sheet.tasks ?? [],
    categories: sheet.categories ?? [],
    isActive: false,
  }))
  return [active, ...resident]
}

/**
 * 이름 대조용 정규화. 마일스톤 머리의 ◆ 표식과 공백 차이만으로 '확인 필요'가 뜨면 경고가
 * 소음이 되므로 둘 다 걷어낸다(projectKpis 의 마일스톤 이름 처리와 같은 규칙).
 */
export function normalizeStamp(name: string | undefined): string {
  return (name ?? '').replace(/^◆\s*/, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** 앵커에 아무 대상도 없으면 '사업 단위 레코드' — 판정 자체를 하지 않는다. */
function isEmptyAnchor(anchor: RecordAnchor | undefined): boolean {
  return !anchor || (!anchor.taskId && !anchor.categoryId)
}

/**
 * 앵커 한 건을 지금 프로젝트 상태에 비춰 해석한다. 앵커가 없으면 `undefined`(사업 단위).
 *
 * `sheetId` 미지정은 **활성 시트**를 뜻한다 — 정규화는 여기 한 곳에서만 하고 호출부에
 * 흩뿌리지 않는다. 기본 샘플·구버전 파일에는 activeSheet 자체가 없어 sheetId 를 채울 값이
 * 없기 때문에, 필수로 두면 위조값을 넣게 되고 그 위조값이 전부 고아로 떨어진다.
 *
 * **자동 해제는 어떤 경우에도 하지 않는다.** 판정은 표시를 위한 것이고, 데이터를 지우는 것은
 * 언제나 사람의 결정이다.
 */
export function resolveAnchor(
  project: Project,
  anchor: RecordAnchor | undefined,
): AnchorResolution | undefined {
  if (isEmptyAnchor(anchor) || !anchor) return undefined
  const scopes = sheetScopes(project)
  const scope = anchor.sheetId
    ? scopes.find((candidate) => candidate.id === anchor.sheetId)
    : scopes.find((candidate) => candidate.isActive)

  // 가리키던 시트가 삭제됐다 → 공정을 찾을 자리가 없다.
  if (!scope) {
    return {
      state: 'orphan',
      ...(anchor.sheetId ? { sheetId: anchor.sheetId } : {}),
      ...(anchor.taskId ? { taskId: anchor.taskId } : {}),
      ...(anchor.stamp ? { taskName: anchor.stamp } : {}),
      ...(anchor.categoryId ? { categoryId: anchor.categoryId } : {}),
    }
  }

  const base = {
    ...(scope.id ? { sheetId: scope.id } : {}),
    sheetName: scope.name,
  }

  const task = anchor.taskId ? scope.tasks.find((t) => t.id === anchor.taskId) : undefined
  const category = task
    ? scope.categories.find((c) => c.id === task.categoryId)
    : anchor.categoryId
      ? scope.categories.find((c) => c.id === anchor.categoryId)
      : undefined

  // 공정을 지정했는데 없거나, 공종만 지정했는데 그 공종이 없으면 고아.
  if ((anchor.taskId && !task) || (!anchor.taskId && anchor.categoryId && !category)) {
    return {
      ...base,
      state: 'orphan',
      ...(anchor.taskId ? { taskId: anchor.taskId } : {}),
      ...(anchor.stamp ? { taskName: anchor.stamp } : {}),
      ...(anchor.categoryId ? { categoryId: anchor.categoryId } : {}),
    }
  }

  const resolvedName = task?.name ?? category?.name
  const resolved = {
    ...base,
    ...(task ? { taskId: task.id, taskName: task.name } : {}),
    ...(category ? { categoryId: category.id, categoryName: category.name } : {}),
  }

  // stamp 불일치 — id 는 맞지만 내용이 바뀌었다. 프리셋 공정 id 가 위치 인덱스라 다른 시설물
  // 템플릿으로 바꿔도 id 가 그대로 맞아떨어지므로, 이 대조가 '조용한 오연결'을 잡는 유일한 신호다.
  if (anchor.stamp && normalizeStamp(anchor.stamp) !== normalizeStamp(resolvedName)) {
    return { ...resolved, state: 'needsCheck' }
  }

  return { ...resolved, state: scope.isActive ? 'linked' : 'otherSheet' }
}

/**
 * 공정 → 걸려 있는 관리 레코드 역인덱스. 공정 하나를 선택했을 때 "이 공정의 예산·NCR·
 * 인허가"를 한 번에 묻기 위한 것이다. 고아는 가리킬 공정이 없으므로 담지 않는다.
 *
 * 키는 공정 id 우선, 공정 없이 공종만 가리킨 앵커는 공종 id 로 담는다(두 네임스페이스가
 * 섞이지만 id 생성 규칙상 충돌하지 않는다 — `ft-*` vs `fc-*`, 그 외는 nanoid).
 */
export function buildByTaskIndex(project: Project): Map<ID, AnchorRef[]> {
  const index = new Map<ID, AnchorRef[]>()
  for (const [moduleId, records] of Object.entries(project.modules ?? {})) {
    for (const record of records ?? []) {
      const resolution = resolveAnchor(project, record.anchor)
      if (!resolution || resolution.state === 'orphan') continue
      const key = resolution.taskId ?? resolution.categoryId
      if (!key) continue
      const bucket = index.get(key)
      const ref: AnchorRef = { moduleId, recordId: record.id, state: resolution.state }
      if (bucket) bucket.push(ref)
      else index.set(key, [ref])
    }
  }
  return index
}

/** 한 모듈의 앵커 상태 집계 — 표 머리말의 '연결 안 됨 N건' 같은 요약에 쓴다. */
export function countAnchorStates(
  project: Project,
  records: ModuleRecord[] | undefined,
): Record<AnchorState | 'none', number> {
  const counts: Record<AnchorState | 'none', number> = {
    linked: 0,
    otherSheet: 0,
    needsCheck: 0,
    orphan: 0,
    none: 0,
  }
  for (const record of records ?? []) {
    const resolution = resolveAnchor(project, record.anchor)
    counts[resolution?.state ?? 'none'] += 1
  }
  return counts
}
