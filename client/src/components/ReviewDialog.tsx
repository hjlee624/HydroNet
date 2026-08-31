// AI 공기 검토 라운드트립 — 단일 진입 다이얼로그. ADR-003.
//   ① 검토 요청(.md) 내보내기 → 사용자가 외부 LLM(GPT/Gemini 등)에 붙여넣어 검토받고
//   ② 회신(.md)을 업로드 → 델타별 diff 프리뷰(기본 전부 미선택) → 선택분만 [반영].
// 반영은 store.applyReviewDeltas 가 단일 커밋으로 처리(undo 1엔트리·from CAS·reschedule 금지).

import { useState } from 'react'
import { downloadReviewRequest } from '../export/reviewRequest'
import { buildReviewPlan, type ReviewItem, type ReviewPlan } from '../state/reviewImport'
import { useEditor } from '../state/store'
import { Modal } from './Modal'

/** .md 텍스트 파일 하나를 고르게 하고 내용을 돌려준다. 취소 시 null. */
function pickMdText(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.md,text/markdown,text/plain'
    input.onchange = async () => {
      const f = input.files?.[0]
      resolve(f ? await f.text() : null)
    }
    input.click()
  })
}

const BADGE: Record<ReviewItem['verdict'], { label: string; bg: string; fg: string }> = {
  ok: { label: '반영 가능', bg: '#e5f5ec', fg: '#1f9d63' },
  stale: { label: '확인 필요', bg: '#fbf1dc', fg: '#b07a12' },
  rejected: { label: '제외', bg: '#eef0f2', fg: '#7a8794' },
}

export function ReviewDialog({ onClose }: { onClose: () => void }) {
  const a = useEditor.getState
  const readOnly = useEditor((s) => s.readOnly)

  const [text, setText] = useState<string | null>(null)
  const [plan, setPlan] = useState<ReviewPlan | null>(null)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [result, setResult] = useState<{ applied: number; skipped: number } | null>(null)

  const selectable = (it: ReviewItem): boolean => it.verdict === 'ok' || it.verdict === 'stale'

  async function onLoadReview() {
    const t = await pickMdText()
    if (t == null) return
    setText(t)
    setPlan(buildReviewPlan(a().project, t))
    setChecked(new Set()) // 기본 전부 미선택
    setResult(null)
  }

  function toggle(i: number) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  function selectAllOk() {
    if (!plan) return
    setChecked(
      new Set(plan.items.map((it, i) => (it.verdict === 'ok' ? i : -1)).filter((i) => i >= 0)),
    )
  }

  function onApply() {
    if (!plan || checked.size === 0) return
    const deltas = plan.items.filter((_, i) => checked.has(i)).map((it) => it.delta)
    const r = a().applyReviewDeltas(deltas)
    setResult({ applied: r.applied, skipped: r.skipped.length })
    // 최신 프로젝트로 재검증 — 반영된 항목은 '변경 없음(제외)'으로 빠진다.
    if (text != null) setPlan(buildReviewPlan(a().project, text))
    setChecked(new Set())
  }

  const okCount = plan?.items.filter((it) => it.verdict === 'ok').length ?? 0

  return (
    <Modal
      title="🤖 AI 공기 검토"
      sub="외부 AI(GPT·Gemini 등)로 공사기간 적정성을 검토받고, 제안을 골라 반영합니다"
      width={640}
      onClose={onClose}
      footer={(close) => (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%' }}>
          {result && (
            <span style={{ fontSize: 13, color: '#1f9d63', fontWeight: 600 }}>
              ✓ {result.applied}건 반영{result.skipped > 0 ? ` · ${result.skipped}건 스킵` : ''}
            </span>
          )}
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={close}>
            닫기
          </button>
          <button
            className="btn btn--primary"
            disabled={readOnly || checked.size === 0}
            title={readOnly ? '조회 전용 — 반영 불가' : undefined}
            onClick={onApply}
          >
            선택 반영{checked.size > 0 ? ` (${checked.size})` : ''}
          </button>
        </div>
      )}
    >
      {/* ① 내보내기 */}
      <section style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>① 검토 요청 내보내기</div>
        <p style={{ margin: '0 0 8px', fontSize: 13, color: '#5b6b7a' }}>
          현재 공정표를 <b>.md</b> 로 저장 → GPT·Gemini 등에 붙여넣어 공기 적정성을 검토받으세요.
        </p>
        <button className="btn btn--sm" onClick={() => void downloadReviewRequest(a().project)}>
          📄 검토 요청 .md 내보내기
        </button>
      </section>

      <div style={{ height: 1, background: 'var(--hairline, #e2e8ee)', margin: '4px 0 16px' }} />

      {/* ② 회신 반영 */}
      <section>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>② 검토본 불러와 반영</div>
        <p style={{ margin: '0 0 8px', fontSize: 13, color: '#5b6b7a' }}>
          AI가 회신한 <b>.md</b> 를 불러오면 제안을 아래에서 확인하고 <b>고른 것만</b> 반영합니다.
        </p>
        <button className="btn btn--sm" onClick={() => void onLoadReview()}>
          📥 검토본(.md) 불러오기
        </button>

        {plan && (
          <div style={{ marginTop: 14 }}>
            {plan.degraded ? (
              <div
                style={{
                  background: '#fbe9e9',
                  border: '1px solid #f0c9c9',
                  borderRadius: 8,
                  padding: '10px 12px',
                  fontSize: 13,
                  color: '#a33',
                }}
              >
                ⚠️ {plan.message}
              </div>
            ) : (
              <>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    fontSize: 12.5,
                    color: '#5b6b7a',
                    marginBottom: 8,
                  }}
                >
                  <span>{plan.message}</span>
                  {plan.brokenLines > 0 && (
                    <span style={{ color: '#b07a12' }}>· 해석 실패 {plan.brokenLines}줄</span>
                  )}
                  <span style={{ flex: 1 }} />
                  {okCount > 0 && (
                    <button className="btn btn--sm btn--ghost" onClick={selectAllOk}>
                      반영 가능 전체 선택
                    </button>
                  )}
                </div>

                <div
                  style={{
                    maxHeight: 320,
                    overflowY: 'auto',
                    border: '1px solid var(--hairline, #e2e8ee)',
                    borderRadius: 8,
                  }}
                >
                  {plan.items.map((it, i) => {
                    const b = BADGE[it.verdict]
                    const sel = selectable(it)
                    return (
                      <label
                        key={`${it.delta.taskId}:${it.delta.from}:${it.delta.to}:${it.verdict}`}
                        style={{
                          display: 'flex',
                          gap: 10,
                          alignItems: 'flex-start',
                          padding: '9px 12px',
                          borderTop: i === 0 ? 'none' : '1px solid #eef2f6',
                          opacity: sel ? 1 : 0.62,
                          cursor: sel ? 'pointer' : 'default',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked.has(i)}
                          disabled={!sel || readOnly}
                          onChange={() => toggle(i)}
                          style={{ marginTop: 3 }}
                        />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                            {it.taskName ?? it.delta.taskId}
                          </span>
                          {it.categoryName && (
                            <span style={{ fontSize: 12, color: '#8794a1' }}>
                              {' '}
                              · {it.categoryName}
                            </span>
                          )}
                          <span
                            style={{
                              display: 'block',
                              fontSize: 12.5,
                              color: '#33465a',
                              marginTop: 2,
                            }}
                          >
                            {sel ? (
                              <>
                                <b>{it.delta.from}일</b> →{' '}
                                <b style={{ color: '#0e7490' }}>{it.delta.to}일</b>
                                {it.delta.reason ? ` — ${it.delta.reason}` : ''}
                              </>
                            ) : (
                              it.note
                            )}
                          </span>
                          {sel && it.note && (
                            <span
                              style={{
                                display: 'block',
                                fontSize: 12,
                                color: '#b07a12',
                                marginTop: 2,
                              }}
                            >
                              {it.note}
                            </span>
                          )}
                        </span>
                        <span
                          style={{
                            flexShrink: 0,
                            fontSize: 11,
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: 999,
                            background: b.bg,
                            color: b.fg,
                          }}
                        >
                          {b.label}
                        </span>
                      </label>
                    )
                  })}
                </div>
                <p style={{ fontSize: 11.5, color: '#8794a1', margin: '8px 2px 0' }}>
                  · 날짜·주공정은 반영 후 엔진이 자동 재계산합니다. · "확인 필요"는 내보낸 뒤 값이
                  바뀐 공정이라 기본 미선택입니다.
                </p>
              </>
            )}
          </div>
        )}
      </section>
    </Modal>
  )
}
