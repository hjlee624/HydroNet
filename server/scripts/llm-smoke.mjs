// LLM 프록시 모듈 스모크 — 키 없이도 검증 가능한 부분(공급자 상태·에러 매핑).
// `node scripts/llm-smoke.mjs`. 실패 시 throw → 비정상 종료.
// 네트워크 호출은 하지 않는다(키 미설정 경로만 확인).

import { reviewProviderStatus, runReview } from '../src/llm/review.js'

// 이 프로세스에 LLM 키가 없음을 보장(로컬 .env 로딩 안 함).
delete process.env.ANTHROPIC_API_KEY
delete process.env.OPENAI_API_KEY
delete process.env.GEMINI_API_KEY
delete process.env.GOOGLE_API_KEY

let checks = 0
function assert(cond, msg) {
  checks++
  if (!cond) throw new Error(`FAIL: ${msg}`)
}

const st = reviewProviderStatus()
assert(st.anthropic === false, '키 없음 → anthropic false')
assert(st.openai === false, '키 없음 → openai false')
assert(st.gemini === false, '키 없음 → gemini false')

async function expectErr(fn, status, label) {
  try {
    await fn()
    throw new Error(`FAIL: ${label} — 에러가 발생하지 않음`)
  } catch (e) {
    assert(e.status === status, `${label} — status ${status} 기대, got ${e.status} (${e.message})`)
  }
}

await expectErr(
  () => runReview({ provider: 'anthropic', prompt: 'x' }),
  501,
  'anthropic 키 미설정 → 501',
)
await expectErr(() => runReview({ provider: 'openai', prompt: 'x' }), 501, 'openai 키 미설정 → 501')
await expectErr(() => runReview({ provider: 'gemini', prompt: 'x' }), 501, 'gemini 키 미설정 → 501')
await expectErr(
  () => runReview({ provider: 'nope', prompt: 'x' }),
  400,
  '알 수 없는 공급자 → 400',
)

console.log(`✓ llm-smoke: ${checks} checks passed`)
