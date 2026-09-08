// 문의 · 진단(F18) — 막혔을 때 무엇을 먼저 확인하고, 누구에게, 무엇을 붙여넣어 물어볼지.
//
// **어떤 메시지도 발송하지 않는다.** 진단 정보는 클립보드로 복사만 하고, 사용자가 사내
// 연락 수단으로 직접 전달한다. 진단 문자열에는 전화번호(=아이디)·비밀번호·세션이
// 들어가지 않는다(state/logger.ts buildDiagnostics 주석 참고).

import { useState } from 'react'
import { divisionLabel } from '../data/divisions'
import { orUnset, SUPPORT_CHECKS, SUPPORT_CONTACTS, SUPPORT_DOCS } from '../data/support'
import { buildDiagnostics } from '../state/logger'
import { useEditor } from '../state/store'
import { useView } from '../state/viewStore'
import { Modal } from './Modal'

/** 클립보드가 막힌 환경(비보안 컨텍스트·구형 웹뷰)을 위한 폴백 복사. */
function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined') return false
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  try {
    document.body.appendChild(ta)
    ta.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    // 실패해도 임시 요소는 반드시 걷어낸다(화면에 남으면 포커스·탭 순서를 어지럽힌다).
    ta.remove()
  }
}

export function SupportDialog({ onClose }: { onClose: () => void }) {
  const view = useView((s) => s.view)
  const projectName = useEditor((s) => s.project.name)
  const taskCount = useEditor((s) => s.project.tasks.length)
  const linkCount = useEditor((s) => s.project.links.length)
  const readOnly = useEditor((s) => s.readOnly)

  // 복사 결과: null=아직, 'ok'=복사됨, 'manual'=복사 실패 → 전문을 화면에 펼쳐 직접 복사.
  const [copied, setCopied] = useState<null | 'ok' | 'manual'>(null)
  const [diag, setDiag] = useState('')

  function makeDiag(): string {
    return buildDiagnostics({
      모듈: view,
      프로젝트: projectName,
      공정수: taskCount,
      연결수: linkCount,
      조회전용: readOnly ? '예' : '아니오',
    })
  }

  function copyDiag() {
    const text = makeDiag()
    setDiag(text)
    const done = (ok: boolean) => setCopied(ok ? 'ok' : 'manual')
    try {
      const clip = typeof navigator === 'undefined' ? undefined : navigator.clipboard
      if (clip?.writeText) {
        void clip.writeText(text).then(
          () => done(true),
          () => done(legacyCopy(text)),
        )
        return
      }
    } catch {
      /* 아래 폴백으로 */
    }
    done(legacyCopy(text))
  }

  return (
    <Modal
      title="문의 · 진단 정보"
      sub="막히면 여기부터 — 스스로 확인 → 담당자에게 진단 정보 붙여넣기"
      width={620}
      onClose={onClose}
    >
      <div className="help">
        <section className="help-sec">
          <h3>1. 먼저 확인하세요</h3>
          <ul>
            {SUPPORT_CHECKS.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </section>

        <section className="help-sec">
          <h3>2. 본부 담당자</h3>
          <table className="support__table">
            <thead>
              <tr>
                <th>본부</th>
                <th>대표 사용자</th>
                <th>연락 방법</th>
              </tr>
            </thead>
            <tbody>
              {SUPPORT_CONTACTS.map((c) => (
                <tr key={c.division}>
                  <td>{divisionLabel(c.division)}</td>
                  <td>{orUnset(c.champion)}</td>
                  <td>{orUnset(c.note)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note">
            이름·연락 방법은 배포 시 <b>client/src/data/support.ts</b> 와{' '}
            <b>docs/Sequence_지원체계_및_도입효과_측정.md</b> 에 같은 순서로 채웁니다.
          </p>
        </section>

        <section className="help-sec">
          <h3>3. 진단 정보</h3>
          <p>
            아래 버튼을 누르면{' '}
            <b>앱 버전 · 배포 형태 · 화면 크기 · 현재 모듈 · 공정/연결 수 · 최근 오류</b>가
            클립보드로 복사됩니다. 담당자에게 <b>그대로 붙여넣어</b> 전달하세요.
            전화번호(아이디)·비밀번호는 포함되지 않으며, <b>자동으로 전송되지 않습니다.</b>
          </p>
          <p>
            <button type="button" className="btn btn--primary" onClick={copyDiag}>
              📋 진단 정보 복사
            </button>
            {copied === 'ok' && (
              <span className="support__ok">복사되었습니다 — 담당자에게 붙여넣어 전달하세요</span>
            )}
            {copied === 'manual' && (
              <span className="support__ok">
                자동 복사가 막혔습니다 — 아래 내용을 직접 선택해 복사하세요
              </span>
            )}
          </p>
          {copied === 'manual' && <pre className="support__diag">{diag}</pre>}
        </section>

        <section className="help-sec">
          <h3>4. 문서</h3>
          <ul>
            {SUPPORT_DOCS.map((d) => (
              <li key={d.path}>
                <b>{d.path}</b> — {d.what}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Modal>
  )
}
