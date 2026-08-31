// AI 검토 라운드트립 전용 지문(fingerprint) — ADR-003 §9-②.
//
// crdt.ts 의 canonicalProjectSnapshot 과는 **완전히 별개**다(이름·용도 재사용 금지).
// canonicalProjectSnapshot 은 CRDT 쓰기/저장 경로라 view/branding/meta 까지 포함하므로,
// 그것을 지문에 재사용하면 색·로고·줌만 바꿔도 검토본이 stale 로 오판된다.
//
// 여기서는 '공기 검토에 의미있는' 필드(id·duration·durationLabel·note·마일스톤·상위공정 +
// startDate)만 해시에 넣어, 표시 설정 변경으로는 지문이 바뀌지 않게 한다(stale 오탐 제거).
// 암호강도는 불필요(변경 감지·감사 표식 용도)하므로 의존성 없는 FNV-1a 로 16 hex 를 만든다.

import type { Project } from '../types/model'

export function reviewFingerprint(project: Project): string {
  const tasks = [...project.tasks]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((t) => [
      t.id,
      t.duration,
      t.durationLabel ?? '',
      t.note ?? '',
      t.isMilestone ? 1 : 0,
      t.parentId ?? '',
    ])
  return hash16(JSON.stringify({ startDate: project.startDate, tasks }))
}

// 서로 다른 basis 의 FNV-1a 32-bit 해시 둘을 이어붙여 16 hex. (비암호·결정론)
function hash16(s: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0xcbf29ce4 >>> 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x01000193) >>> 0
    h2 = ((h2 << 5) | (h2 >>> 27)) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}
