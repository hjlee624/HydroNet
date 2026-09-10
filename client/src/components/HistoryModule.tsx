// 변경이력·확정본 모듈 — F13.
//  · 표A 확정본(기준선 버전): 이름·작성자·박제일·추적 공정수·준공 표류 + [비교] → 공정별 날짜 차이표.
//  · 표B 변경 이력: 시각·변경자·구분·요약·사유·상태 + [검토요청]·[확정] 버튼.
//
// [🖨 이력 인쇄]가 만드는 것은 **이 화면(확정본 목록 + 대비 차이표)** 이다. 확정본 도면(A1) 자체를
// 다시 그리지는 않는다 — 출력 파이프라인(export/exporter.ts)이 화면에 살아 있는 <svg id="sequence-chart">
// 를 유일한 원본으로 삼아서, 확정본 시점의 일정으로 차트를 먼저 렌더하지 않으면 재출력이 성립하지 않는다.
// 그래서 여기서는 '확정본 재출력'이라 부르지 않고, 인쇄물이 무엇인지 버튼·주석에 그대로 적는다.
//
// 기록 단위는 **제출·주요 변경**이다(키 입력 단위 아님) — 이력은 store.appendChange 를 부르는
// 자리(일정표 취입 · AI 검토 반영 · 확정본 저장 · 인스펙터의 '변경 사유 남기기')에서만 쌓인다.
// changeLog·baselineVersions 는 되돌리기(UndoManager) 추적 대상이 아니라 undo 로 지워지지 않는다.

import { useMemo, useState } from 'react'
import { dayToDate, toISO } from '../engine/dates'
import { baselineDiff } from '../engine/projectKpis'
import { useEditor } from '../state/store'
import { useView } from '../state/viewStore'
import type { ChangeEntry, ChangeState } from '../types/model'
import { DocumentPanel } from './DocumentPanel'

const KIND_LABEL: Record<ChangeEntry['kind'], string> = {
  duration: '공기 변경',
  schedule: '일정 변경',
  baseline: '확정본',
  review: 'AI 검토',
  import: '일정표 취입',
  note: '메모',
}
const STATE_LABEL: Record<ChangeState, string> = {
  draft: '초안',
  review: '검토요청',
  confirmed: '확정',
}
const STATE_CLASS: Record<ChangeState, string> = {
  draft: 'seq-hist__st seq-hist__st--draft',
  review: 'seq-hist__st seq-hist__st--review',
  confirmed: 'seq-hist__st seq-hist__st--ok',
}

/** ISO timestamp → 'YY-MM-DD HH:MM'(로컬). 값이 이상하면 원문을 그대로 보여준다. */
function fmtAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${String(d.getFullYear()).slice(2)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function HistoryModule() {
  const project = useEditor((s) => s.project)
  const readOnly = useEditor((s) => s.readOnly)
  const a = useEditor.getState
  const setView = useView((s) => s.setView)
  const [openVersion, setOpenVersion] = useState<string | null>(null)

  const versions = project.baselineVersions ?? []
  const log = project.changeLog ?? []
  // 최신 이력이 위로. 원본 배열(시각 오름차순)은 CRDT 정규화 결과라 건드리지 않는다.
  const rows = useMemo(() => [...log].reverse(), [log])
  const diff = useMemo(() => {
    const v = versions.find((x) => x.id === openVersion)
    return v ? baselineDiff(project, v) : []
  }, [openVersion, versions, project])

  const dateOf = (day: number) => toISO(dayToDate(project.startDate, day))

  function onSaveVersion(): void {
    if (typeof window === 'undefined') return
    const name = window.prompt('확정본 이름 (예: 착공 기준선, 1차 변경)')
    if (name == null) return
    const note = window.prompt('확정 사유 / 비고 (선택)') ?? ''
    a().saveBaselineVersion(name, note)
  }

  function onLeaveNote(): void {
    if (typeof window === 'undefined') return
    const reason = window.prompt('변경 사유를 적어주세요 (사업 단위 메모)')
    if (!reason?.trim()) return
    a().appendChange({ kind: 'note', summary: '사업 메모', reason: reason.trim() })
  }

  return (
    <div className="seq-rec seq-hist">
      <header className="seq-rec__head">
        <div className="seq-rec__title">
          <span className="seq-rec__icon" aria-hidden="true">
            🗂
          </span>
          <div>
            <h1 className="seq-rec__h1">
              변경이력·확정본 <span className="seq-rec__count">{log.length}건</span>
            </h1>
            <p className="seq-rec__blurb">누가·언제·왜 바꿨는지 + 확정본 대비 날짜 차이</p>
          </div>
        </div>
        <div className="seq-rec__actions">
          <button type="button" className="btn" onClick={() => setView('dashboard')}>
            ← 총괄
          </button>
          {!readOnly && (
            <>
              <button type="button" className="btn" onClick={onLeaveNote}>
                ✎ 사유 남기기
              </button>
              <button type="button" className="btn btn--primary" onClick={onSaveVersion}>
                ＋ 확정본 저장
              </button>
            </>
          )}
          <button
            type="button"
            className="btn"
            title="이 화면(확정본 목록 + 대비 차이표)을 인쇄합니다 — 확정본 도면 자체를 다시 그리지는 않습니다"
            onClick={() => window.print()}
          >
            🖨 이력 인쇄
          </button>
        </div>
      </header>

      <section className="seq-rep__sec">
        <h2 className="seq-rep__h2">1. 확정본(기준선 버전)</h2>
        <p className="seq-rec__foot" style={{ marginTop: 0 }}>
          [🖨 이력 인쇄]는 <b>이 목록과 대비 차이표</b>를 인쇄합니다. 확정본 도면(A1 시트) 자체의
          재출력은 아직 제공하지 않습니다 — 현재 출력은 화면에 그려진 공정표를 그대로 내보내는
          방식이라, 확정본 시점의 일정으로 도면을 다시 그리는 경로가 필요합니다.
        </p>
        {versions.length === 0 ? (
          <p className="seq-rec__foot" style={{ margin: 0 }}>
            아직 확정본이 없습니다. [＋ 확정본 저장]을 누르면 지금 일정이 이름·작성자와 함께
            박제되고, 이후 변경은 이 확정본 대비 며칠 차이인지로 비교됩니다.
          </p>
        ) : (
          <div className="seq-rec__tablewrap">
            <table className="seq-rec__table">
              <thead>
                <tr>
                  <th className="seq-rec__wide">이름</th>
                  <th>작성자</th>
                  <th>박제일</th>
                  <th>추적 공정</th>
                  <th>준공(계획)</th>
                  <th>비고</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...versions].reverse().map((v) => (
                  <tr key={v.id}>
                    <td className="seq-rec__wide">{v.name}</td>
                    <td>{v.authorName}</td>
                    <td>{v.asOf}</td>
                    <td>{v.tasks.length}</td>
                    <td>{dateOf(v.endDay)}</td>
                    <td>{v.note ?? ''}</td>
                    <td className="seq-rec__act">
                      <button
                        type="button"
                        className="btn btn--sm"
                        onClick={() => setOpenVersion(openVersion === v.id ? null : v.id)}
                      >
                        {openVersion === v.id ? '닫기' : '비교'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {openVersion && (
          <div className="seq-hist__diff">
            <h3 className="seq-hist__h3">
              확정본 대비 날짜 차이 <span className="seq-rec__count">{diff.length}건</span>
            </h3>
            {diff.length === 0 ? (
              <p className="seq-rec__foot" style={{ margin: 0 }}>
                이 확정본 이후 시작일·기간이 달라진 공정이 없습니다.
              </p>
            ) : (
              <div className="seq-rec__tablewrap">
                <table className="seq-rec__table">
                  <thead>
                    <tr>
                      <th className="seq-rec__wide">공정</th>
                      <th>기준 시작</th>
                      <th>현재 시작</th>
                      <th>시작 차이</th>
                      <th>기준 기간</th>
                      <th>현재 기간</th>
                      <th>종료 차이</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diff.map((d) => (
                      <tr key={d.id}>
                        <td className="seq-rec__wide">{d.name}</td>
                        <td>{dateOf(d.baseStart)}</td>
                        <td>{dateOf(d.curStart)}</td>
                        <td className={d.startDeltaDays > 0 ? 'seq-hist__late' : ''}>
                          {d.startDeltaDays > 0 ? '+' : ''}
                          {d.startDeltaDays}일
                        </td>
                        <td>{d.baseDuration}</td>
                        <td>{d.curDuration}</td>
                        <td className={d.finishDeltaDays > 0 ? 'seq-hist__late' : ''}>
                          {d.finishDeltaDays > 0 ? '+' : ''}
                          {d.finishDeltaDays}일
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="seq-rep__sec">
        <h2 className="seq-rep__h2">2. 변경 이력</h2>
        {rows.length === 0 ? (
          <div className="seq-rec__empty">
            <p>
              아직 기록된 변경이 없습니다. 일정표 취입·AI 검토 반영·확정본 저장은 자동으로 남고,
              공정 속성의 [✎ 변경 사유 남기기]로 직접 남길 수도 있습니다.
            </p>
          </div>
        ) : (
          <div className="seq-rec__tablewrap">
            <table className="seq-rec__table">
              <thead>
                <tr>
                  <th>시각</th>
                  <th>변경자</th>
                  <th>구분</th>
                  <th className="seq-rec__wide">요약</th>
                  <th className="seq-rec__wide">사유</th>
                  <th>상태</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const state = e.state ?? 'draft'
                  return (
                    <tr key={e.id}>
                      <td>{fmtAt(e.at)}</td>
                      <td>{e.actorName}</td>
                      <td>{KIND_LABEL[e.kind] ?? e.kind}</td>
                      <td className="seq-rec__wide">
                        {e.summary}
                        {e.taskIds.length > 0 && (
                          <span className="seq-rec__count">공정 {e.taskIds.length}</span>
                        )}
                      </td>
                      <td className="seq-rec__wide">{e.reason || '—'}</td>
                      <td>
                        <span className={STATE_CLASS[state]}>{STATE_LABEL[state]}</span>
                        {e.decidedBy && state !== 'draft' && (
                          <span className="seq-hist__by">
                            {e.decidedBy}
                            {e.decidedAt ? ` · ${fmtAt(e.decidedAt)}` : ''}
                          </span>
                        )}
                      </td>
                      <td className="seq-rec__act">
                        <button
                          type="button"
                          className="btn btn--sm"
                          disabled={readOnly || state === 'review'}
                          onClick={() => a().setChangeState(e.id, 'review')}
                        >
                          검토요청
                        </button>
                        <button
                          type="button"
                          className="btn btn--sm"
                          disabled={readOnly || state === 'confirmed'}
                          onClick={() => a().setChangeState(e.id, 'confirmed')}
                        >
                          확정
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <DocumentPanel moduleId="history" readOnly={readOnly} />
      <p className="seq-rec__foot">
        이력은 사업 데이터와 함께 저장·동기화되며 <b>되돌리기(Ctrl+Z)로 지워지지 않습니다</b> — 감사
        기록이기 때문입니다. 동시 편집 중에도 각자의 이력은 서로 덮어쓰지 않고 모두 남습니다.
      </p>
    </div>
  )
}
