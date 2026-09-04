// ─────────────────────────────────────────────────────────────────────────────
// 실시간 AI 공기 검토 프록시 (검토서 Part A). 서버가 BYO 키로 LLM 을 호출해
// '공기 적정성 검토 요청'(.md) → 검토 회신(sequence-review 펜스 포함)을 돌려준다.
//
// 공급자 3사:
//   · Claude(Anthropic) — 공식 SDK(@anthropic-ai/sdk). 기본 claude-opus-4-8, 적응형 사고.
//   · OpenAI / Gemini    — 안정적인 REST(fetch). SDK 버전 드리프트 회피(공급자별 최소 의존).
//
// 키는 서버 .env 에만 둔다(BYO). 미설정 공급자는 501 로 명확히 안내(조용한 실패 금지).
// 반영은 여전히 앱 내 승인 게이트(ReviewDialog)를 거친다 — 모델은 '제안'만.
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk'

const SYSTEM = [
  '당신은 대한민국 공공 건설공사 공정(공사기간) 검토 전문가입니다.',
  '아래 "공기(공사기간) 적정성 검토 요청" 문서를 읽고 각 공정의 공사기간이 적정한지 검토하세요.',
  '- 문서에 포함된 법정 산정 근거·이론작업일수(물량÷생산성)·표준공기·주공정을 일반 지식보다 우선하세요.',
  '- 문서 맨 끝의 "회신 형식"을 정확히 지켜, 수정 제안을 sequence-review 코드블록(JSONL)으로 파일 끝에 넣으세요.',
  '- 공정 신설·삭제·이동·병합은 금지이며, duration(정수 일)만 제안합니다.',
].join('\n')

const DEFAULT_MODEL = {
  anthropic: process.env.LLM_ANTHROPIC_MODEL || 'claude-opus-4-8',
  openai: process.env.LLM_OPENAI_MODEL || 'gpt-4o',
  gemini: process.env.LLM_GEMINI_MODEL || 'gemini-1.5-pro',
}

const MAX_TOKENS = Number(process.env.LLM_MAX_TOKENS || 8000)

function err(status, message, code) {
  const e = new Error(message)
  e.status = status
  e.code = code
  return e
}

const clip = (s) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > 300 ? `${t.slice(0, 300)}…` : t
}

/** 공급자별 API 키 설정 여부(비밀은 노출하지 않는다). */
export function reviewProviderStatus() {
  return {
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    openai: !!process.env.OPENAI_API_KEY,
    gemini: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
  }
}

/** { provider, model?, prompt } → { text, provider, model }. 실패 시 status 를 가진 Error throw. */
export async function runReview({ provider, model, prompt }) {
  const p = String(provider || 'anthropic').toLowerCase()
  const m = typeof model === 'string' && model.trim() ? model.trim() : DEFAULT_MODEL[p]
  if (!m) throw err(400, `지원하지 않는 공급자입니다: ${provider}`, 'bad_provider')
  if (p === 'anthropic') return callAnthropic(m, prompt)
  if (p === 'openai') return callOpenAI(m, prompt)
  if (p === 'gemini') return callGemini(m, prompt)
  throw err(400, `지원하지 않는 공급자입니다: ${provider}`, 'bad_provider')
}

async function callAnthropic(model, prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw err(501, 'ANTHROPIC_API_KEY 가 설정되지 않았습니다(server/.env).', 'no_key')
  const client = new Anthropic({ apiKey })
  let resp
  try {
    resp = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'adaptive' },
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    })
  } catch (e) {
    const status = Number.isInteger(e?.status) ? e.status : 502
    throw err(status, `Claude 호출 실패: ${clip(e?.message)}`, 'anthropic')
  }
  const text = (resp.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()
  if (!text) throw err(502, '모델이 빈 응답을 반환했습니다.', 'empty')
  return { text, provider: 'anthropic', model }
}

async function callOpenAI(model, prompt) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw err(501, 'OPENAI_API_KEY 가 설정되지 않았습니다(server/.env).', 'no_key')
  let r
  try {
    r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: prompt },
        ],
      }),
    })
  } catch (e) {
    throw err(502, `OpenAI 연결 실패: ${clip(e?.message)}`, 'openai')
  }
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    throw err(r.status, `OpenAI 오류(${r.status}): ${clip(body)}`, 'openai')
  }
  const j = await r.json()
  const text = String(j?.choices?.[0]?.message?.content ?? '').trim()
  if (!text) throw err(502, '모델이 빈 응답을 반환했습니다.', 'empty')
  return { text, provider: 'openai', model }
}

async function callGemini(model, prompt) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
  if (!apiKey) throw err(501, 'GEMINI_API_KEY 가 설정되지 않았습니다(server/.env).', 'no_key')
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`
  let r
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: MAX_TOKENS },
      }),
    })
  } catch (e) {
    throw err(502, `Gemini 연결 실패: ${clip(e?.message)}`, 'gemini')
  }
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    throw err(r.status, `Gemini 오류(${r.status}): ${clip(body)}`, 'gemini')
  }
  const j = await r.json()
  const text = String(
    (j?.candidates?.[0]?.content?.parts ?? []).map((part) => part?.text ?? '').join(''),
  ).trim()
  if (!text) throw err(502, '모델이 빈 응답을 반환했습니다(안전 필터 또는 토큰 초과일 수 있음).', 'empty')
  return { text, provider: 'gemini', model }
}
