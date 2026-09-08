// ─────────────────────────────────────────────────────────────────────────────
// 단축키 단일 정의(Single source of truth).
//
// 실제 키 처리(components/ScheduleModule.tsx)·도움말 표(components/HelpDialog.tsx)
// ·보기 막대 힌트(components/ViewBar.tsx)가 모두 이 파일 하나만 읽는다 —
// 문서와 동작이 어긋날 수 없다(도움말에 'Z 줌'이 남아 있던 드리프트 재발 방지).
//
// 범위(scope) 규칙 — 관문이 **둘**이다(입력 칸 / 대화상자). 바인딩마다 각각을 통과하는지가 다르다:
//   • 'global' … 입력 칸 안에서도, 대화상자가 떠 있어도 동작. 지금은 Ctrl+S(저장) 하나뿐.
//   • 'canvas' … 입력 칸 안에서도 동작하지만 대화상자가 떠 있으면 비활성.
//                Esc(연결 드래그 취소)가 여기 — 인스펙터 이름 칸에 커서를 둔 채 Esc 를 눌러도
//                걸려 있던 연결이 풀려야 하지만, 대화상자 위의 Esc 는 그 대화상자가 가져간다.
//   • 'editor' … 도면 편집기 전용. 입력 칸(INPUT/TEXTAREA/SELECT/contenteditable)에
//                커서가 있거나 대화상자(모달)가 열려 있으면 동작하지 않는다.
//                → 이름·공기를 입력하다 Ctrl+Z 를 눌러도 도면이 되돌아가지 않는다.
// 판정은 **바인딩별**로 한다 — 예전처럼 모달이 열렸다고 전체를 먼저 잘라내면
// scope 'global' 인 Ctrl+S 까지 같이 죽어 브라우저의 '다른 이름으로 페이지 저장'이 뜬다.
// DOM 에 의존하지 않는 순수 판정 함수라 헤드리스 스모크에서 그대로 실행할 수 있다.
// ─────────────────────────────────────────────────────────────────────────────

/** 어디까지 살아남는 키인가 — 위 주석의 세 단계(넓은 순: global > canvas > editor). */
export type KeyScope = 'global' | 'canvas' | 'editor'

/** 단축키가 지시하는 동작 식별자. 실제 구현은 ScheduleModule 의 switch 한 곳뿐. */
export type KeyActionId =
  | 'save'
  | 'undo'
  | 'redo'
  | 'copyCategories'
  | 'pasteCategories'
  | 'deleteSelection'
  | 'panMode'
  | 'editMode'
  | 'escape'

/** 도움말·힌트에 그대로 렌더되는 문서 항목(키가 아닌 마우스 제스처도 포함). */
export interface ShortcutDoc {
  /** 예: ['Ctrl','Z'] — 각 원소가 <kbd> 한 칸. */
  keys: string[]
  /** 같은 동작의 대체 조합. 예: ['Ctrl','Shift','Z'] */
  altKeys?: string[]
  /** 도움말 표에 쓰는 한국어 설명(빈 문자열 금지). */
  label: string
  /** true 면 보기 막대 오른쪽 단축키 힌트에도 노출. */
  hint?: boolean
  /** 보기 막대처럼 폭이 좁은 곳에서 쓸 짧은 문구(없으면 label). */
  short?: string
}

/** 실제로 키보드 이벤트에 매칭되는 바인딩. */
export interface KeyBinding extends ShortcutDoc {
  id: KeyActionId
  scope: KeyScope
  match: (e: KeyLike) => boolean
}

/** KeyboardEvent 중 판정에 쓰는 최소 형태(스모크에서 평범한 객체로 만들 수 있게). */
export interface KeyLike {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
}

const mod = (e: KeyLike) => !!(e.ctrlKey || e.metaKey)
const bare = (e: KeyLike) => !e.ctrlKey && !e.metaKey && !e.altKey
const k = (e: KeyLike) => (e.key || '').toLowerCase()

/** 키보드 단축키 전체. 순서 = 매칭 우선순위이자 도움말 표의 표시 순서. */
export const KEYMAP: KeyBinding[] = [
  {
    id: 'save',
    scope: 'global',
    keys: ['Ctrl', 'S'],
    label: '저장(파일로 — 경로 선택)',
    match: (e) => mod(e) && k(e) === 's',
  },
  {
    id: 'undo',
    scope: 'editor',
    keys: ['Ctrl', 'Z'],
    label: '실행 취소(도면)',
    match: (e) => mod(e) && k(e) === 'z' && !e.shiftKey,
  },
  {
    id: 'redo',
    scope: 'editor',
    keys: ['Ctrl', 'Y'],
    altKeys: ['Ctrl', 'Shift', 'Z'],
    label: '다시 실행(도면)',
    match: (e) => mod(e) && (k(e) === 'y' || (k(e) === 'z' && !!e.shiftKey)),
  },
  {
    id: 'copyCategories',
    scope: 'editor',
    keys: ['Ctrl', 'C'],
    label: '선택한 공종 복사',
    match: (e) => mod(e) && k(e) === 'c',
  },
  {
    id: 'pasteCategories',
    scope: 'editor',
    keys: ['Ctrl', 'V'],
    label: '복사한 공종 붙여넣기',
    match: (e) => mod(e) && k(e) === 'v',
  },
  {
    id: 'deleteSelection',
    scope: 'editor',
    keys: ['Delete'],
    altKeys: ['Backspace'],
    label: '선택한 공정·연결 삭제',
    match: (e) => bare(e) && (e.key === 'Delete' || e.key === 'Backspace'),
  },
  {
    id: 'panMode',
    scope: 'editor',
    keys: ['H'],
    label: '화면 이동 모드(드래그로 스크롤)',
    hint: true,
    short: '화면 이동',
    match: (e) => bare(e) && k(e) === 'h',
  },
  {
    id: 'editMode',
    scope: 'editor',
    keys: ['V'],
    label: '편집 모드 복귀',
    match: (e) => bare(e) && k(e) === 'v',
  },
  {
    // 입력 칸 안에서도 살아 있어야 한다 — 연결 드래그를 걸어둔 채 인스펙터 이름 칸을
    // 클릭하고 Esc 를 누르는 흐름에서 예약된 연결이 남아 다음 클릭에 엉뚱한 연결이 생겼다.
    id: 'escape',
    scope: 'canvas',
    keys: ['Esc'],
    label: '연결 드래그 취소 · 편집 모드 복귀',
    match: (e) => e.key === 'Escape',
  },
]

/** 키가 아닌 마우스 제스처 — 문서 전용(도움말·힌트에 함께 표시). */
export const GESTURES: ShortcutDoc[] = [
  { keys: ['Ctrl', '휠'], label: '차트 확대·축소(커서 기준)', hint: true, short: '확대·축소' },
  { keys: ['빈 곳 드래그'], label: '막대 다중 선택(고무줄)' },
  { keys: ['막대 우클릭'], label: 'DUMMY(가상·연결) 공정 토글' },
]

/** 도움말 표에 렌더할 전체 목록(키 + 제스처). */
export const ALL_SHORTCUTS: ShortcutDoc[] = [...KEYMAP, ...GESTURES]

/** 입력 중인가 — INPUT/TEXTAREA/SELECT 또는 contenteditable 안이면 true. */
export function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el !== 'object') return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return el.isContentEditable === true
}

/**
 * 대화상자(공용 Modal)가 화면에 남아 있는가 — **닫히는 중(.is-closing)도 열린 것으로 센다**.
 * Modal.requestClose 는 .is-closing 을 즉시 붙이고 170ms 뒤에야 언마운트하는데, 그 사이에도
 * 대화상자는 눈에 보이고 포커스도 갖고 있다. 예전엔 :not(.is-closing) 으로 걸러 그 170ms 동안
 * 편집기 단축키가 되살아났고, '도면 출력을 Esc 로 닫자마자 Delete' 같은 흔한 연타에서
 * 선택한 공정이 지워졌다.
 */
export function isModalOpen(): boolean {
  if (typeof document === 'undefined') return false
  return !!document.querySelector('.modal-backdrop')
}

/**
 * 이 키 입력이 지금 이 자리에서 어떤 동작을 뜻하는지 판정한다. 관문은 **바인딩마다** 건다:
 *  (a) 대화상자가 떠 있으면 scope 'global' 이 아닌 바인딩을 건너뛴다
 *      — Ctrl+S(저장)는 살아남고, Esc 는 Modal 자신이 처리한다.
 *  (b) 입력 중이면 scope 'editor' 바인딩을 건너뛴다 — Ctrl+Z 는 그 칸의 글자만 되돌린다.
 *  (c) 남은 바인딩을 KEYMAP 순서대로 match().
 */
export function resolveAction(
  e: KeyLike,
  ctx: { typing: boolean; modal: boolean },
): KeyActionId | null {
  for (const b of KEYMAP) {
    if (ctx.modal && b.scope !== 'global') continue
    if (ctx.typing && b.scope === 'editor') continue
    if (b.match(e)) return b.id
  }
  return null
}
