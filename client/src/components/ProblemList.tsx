// 미해결 일정 문제 목록 — 상태바의 '⚠ 미해결 문제 N건' 버튼으로 여는 팝오버.
//
// 예전에는 경고가 문자열 하나뿐이라 상태바에 **마지막 한 줄**만 떴고, 순환이 여러 개면
// 어느 것을 먼저 풀어야 하는지도, 어느 공정·연결이 범인인지도 알 수 없었다. 이제 문제
// 하나 = 항목 하나이고, 각 항목의 공정 칩을 누르면 그 막대로 이동(선택+스크롤), 연결 칩을
// 누르면 연결 속성 탭으로 이동해 그 자리에서 지우거나 방향을 바꿀 수 있다.

import { useEditor } from '../state/store'

export function ProblemList() {
  const problems = useEditor((s) => s.problems)
  const open = useEditor((s) => s.problemsOpen)
  const project = useEditor((s) => s.project)
  const a = useEditor.getState
  if (!open) return null

  const nameOf = (id: string): string => project.tasks.find((t) => t.id === id)?.name ?? id
  const linkLabel = (id: string): string => {
    const l = project.links.find((x) => x.id === id)
    return l ? `${nameOf(l.from)} → ${nameOf(l.to)} (${l.type})` : id
  }

  return (
    <div className="problems" data-export-hide="1">
      <div className="problems__head">
        <strong>미해결 일정 문제 {problems.length}건</strong>
        <button type="button" className="btn btn--sm" onClick={() => a().toggleProblems(false)}>
          닫기
        </button>
      </div>
      {problems.length === 0 ? (
        <div className="problem-row">미해결 문제가 없습니다 — 계산 결과는 확정입니다.</div>
      ) : (
        problems.map((p) => (
          <div className="problem-row" key={p.id}>
            <div className="problem-row__msg">⛔ {p.message}</div>
            <div className="problem-row__chips">
              {p.taskIds.map((id) => (
                <button
                  type="button"
                  key={`t-${id}`}
                  className="chip problem-chip"
                  title="이 공정으로 이동"
                  onClick={() => a().focusTask(id)}
                >
                  ▤ {nameOf(id)}
                </button>
              ))}
              {p.linkIds.map((id) => (
                <button
                  type="button"
                  key={`l-${id}`}
                  className="chip problem-chip"
                  title="이 연결의 속성으로 이동"
                  onClick={() => {
                    a().selectLink(id)
                    a().setInspectorTab('link')
                  }}
                >
                  ↳ {linkLabel(id)}
                </button>
              ))}
            </div>
            <div className="problem-row__hint">
              연결 하나를 지우거나 방향을 바꾸면 이 순환이 풀립니다(연결 칩 → 오른쪽 [연결] 탭).
            </div>
          </div>
        ))
      )}
      <div className="problem-row__hint">
        미해결 문제가 남아 있는 동안 준공일·주공정은 <b>잠정</b> 산정이며, 출력 대화상자에도 그
        사실이 표시됩니다.
      </div>
    </div>
  )
}
