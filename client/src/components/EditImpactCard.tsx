// 변경 영향 카드 — 막대를 옮기거나 기간을 바꿀 때 "이 편집이 실제로 무엇을 바꾸는가"를
// 커밋 전(드래그 중·인스펙터 확인창)과 커밋 직후(되돌리기 버튼) 같은 화면으로 보여준다.
// 계산은 engine/scheduling.previewEdit 하나만 쓰므로 사전 표시와 실제 결과가 어긋나지 않는다.

import { dayToDate, toISO } from '../engine/dates'
import type { EditImpact } from '../engine/scheduling'

const MODE_LABEL: Record<EditImpact['mode'], string> = {
  free: '위치 자유 편집',
  keepLinks: '선후행 제약 유지',
}

/** 최대 5줄까지만 나열하고 나머지는 "외 N건"으로 접는다(드래그 중에도 읽히도록). */
const MAX_ROWS = 5

export function EditImpactCard({
  impact,
  startDate,
  note,
  onUndo,
}: {
  impact: EditImpact
  /** 프로젝트 착수일(ISO) — day 오프셋을 절대 날짜로 바꾸는 기준. */
  startDate: string
  /** 카드 아래 덧붙일 한 줄 안내(예: 다중 선택은 잡은 막대만 미리보기). */
  note?: string
  /** 주어지면 [되돌리기] 버튼을 표시한다. */
  onUndo?: () => void
}) {
  const d = (day: number): string => toISO(dayToDate(startDate, day))
  const t = impact.target
  const endDelta = impact.endAfter - impact.endBefore
  const durationChanged = t.durationBefore !== t.durationAfter
  const startChanged = t.startBefore !== t.startAfter

  return (
    <div className="edit-impact__body">
      <div className="edit-impact__head">
        <strong>변경 영향</strong>
        <span className="edit-impact__mode">{MODE_LABEL[impact.mode]}</span>
      </div>
      <div className="edit-impact__row">
        <b>{t.name}</b> 시작 {d(t.startBefore)}
        {startChanged ? ` → ${d(t.startAfter)}` : ' (변동 없음)'}
      </div>
      {durationChanged && (
        <div className="edit-impact__row">
          기간 {t.durationBefore}일 → <b>{t.durationAfter}일</b>
        </div>
      )}
      {impact.clamped && (
        <div className="edit-impact__row edit-impact__clamp">
          ⛔ 선행 제약에 막혀 {impact.clampedTo != null ? d(impact.clampedTo) : '허용 위치'}로
          조정됨 — 더 당기려면 연결의 지연(lag)을 줄이거나 [위치 자유 편집]으로 바꾸세요.
        </div>
      )}
      {impact.mode === 'keepLinks' ? (
        <div className="edit-impact__row edit-impact__ok">지연(lag) 변경 없음 — 제약 유지</div>
      ) : impact.lagChanges.length === 0 ? (
        <div className="edit-impact__row edit-impact__ok">지연(lag) 변경 없음</div>
      ) : (
        <div className="edit-impact__row">
          지연(lag) 변경 <b>{impact.lagChanges.length}건</b>
          <ul className="edit-impact__list">
            {impact.lagChanges.slice(0, MAX_ROWS).map((c) => (
              <li key={c.linkId}>
                {c.fromName} → {c.toName} ({c.type}) {c.before}일 → <b>{c.after}일</b>
              </li>
            ))}
            {impact.lagChanges.length > MAX_ROWS && (
              <li>외 {impact.lagChanges.length - MAX_ROWS}건</li>
            )}
          </ul>
        </div>
      )}
      <div className="edit-impact__row">
        후행 이동 <b>{impact.successorMoves.length}개 공정</b> · 준공{' '}
        <b className={`edit-impact__delta ${endDelta > 0 ? 'neg' : 'pos'}`}>
          {endDelta > 0 ? `+${endDelta}` : endDelta}일
        </b>{' '}
        ({d(impact.endAfter)})
      </div>
      {note && <div className="edit-impact__note">{note}</div>}
      {onUndo && (
        <button type="button" className="btn btn--sm edit-impact__undo" onClick={onUndo}>
          ↩ 되돌리기
        </button>
      )}
    </div>
  )
}
