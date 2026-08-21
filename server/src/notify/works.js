// 네이버웍스(NAVER WORKS) Bot 알림 — 계정 사용 신청 시 개발자(운영자)에게 개별 DM 발송.
// 흐름: 서비스 계정 JWT(RS256) → OAuth 액세스 토큰(모듈 캐시·자동 갱신) → Bot 메시지 발송.
// 외부 의존 0 — jose(이미 설치됨) + Node20+ 내장 fetch 만 사용.
// 미설정(크리덴셜 없음)이면 조용히 no-op — 등록 흐름을 절대 막지 않는다(fire-and-forget).
//   필요한 환경변수(server/.env.example 참고):
//   WORKS_CLIENT_ID / WORKS_CLIENT_SECRET / WORKS_SERVICE_ACCOUNT / WORKS_PRIVATE_KEY(PKCS8 PEM)
//   / WORKS_BOT_ID / WORKS_NOTIFY_USER_ID(수신자=운영자 본인). 선택: WORKS_SCOPE, WORKS_APP_URL.
import { importPKCS8, SignJWT } from 'jose'

const TOKEN_URL = 'https://auth.worksmobile.com/oauth2/v2.0/token'
const API_BASE = 'https://www.worksapis.com/v1.0'
const FETCH_TIMEOUT_MS = 8000

/** AbortController 기반 타임아웃 fetch — 네이버웍스 무응답 시 매달리지 않도록. */
async function timedFetch(url, init, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

// 본부 키 → 라벨. client/src/data/divisions.ts · server roles.js DIVISION_KEYS 와 동일하게 유지.
const DIVISION_LABELS = {
  strategy: '경영전략본부',
  'water-env': '물환경본부',
  'water-res': '수자원본부',
  land: '국토개발본부',
  railway: '철도본부',
  road: '도로본부',
  plant: '플랜트본부',
  cm: 'CM',
  overseas: '해외사업본부',
  bizdev: '사업개발실',
  safety: '안전품질관리실',
}
const divisionLabel = (key) => DIVISION_LABELS[key] || key || '미지정'
const ROLE_LABELS = { pm: '관리자(PM)', user: '사용자', developer: '개발자' }
const roleLabel = (role) => ROLE_LABELS[role] || role || ''

/** 01012345678 → 010-1234-5678. 형식이 다르면 원본 그대로. */
function formatPhone(id) {
  const d = String(id || '').replace(/\D/g, '')
  return /^010\d{8}$/.test(d) ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : String(id || '')
}

/** env → 설정 객체. 프라이빗 키의 리터럴 "\n" 은 실제 개행으로 복원(한 줄 env 대응). */
export function worksConfig(env = process.env) {
  const privateKey = String(env.WORKS_PRIVATE_KEY || '')
    .replace(/\\n/g, '\n')
    .trim()
  return {
    clientId: String(env.WORKS_CLIENT_ID || '').trim(),
    clientSecret: String(env.WORKS_CLIENT_SECRET || '').trim(),
    serviceAccount: String(env.WORKS_SERVICE_ACCOUNT || '').trim(),
    privateKey,
    botId: String(env.WORKS_BOT_ID || '').trim(),
    userId: String(env.WORKS_NOTIFY_USER_ID || '').trim(),
    scope: String(env.WORKS_SCOPE || 'bot').trim(),
    appUrl: String(env.WORKS_APP_URL || '').trim(),
  }
}

/** 발송에 필요한 값이 모두 설정됐는가. */
export function isConfigured(cfg = worksConfig()) {
  return !!(
    cfg.clientId &&
    cfg.clientSecret &&
    cfg.serviceAccount &&
    cfg.privateKey &&
    cfg.botId &&
    cfg.userId
  )
}

// ── 액세스 토큰(모듈 캐시) ────────────────────────────────────────────────────
let _token = null // { value, expiresAt(ms) }
let _issuing = null // 진행 중인 토큰 발급 Promise — 동시 요청이 합류해 중복 발급을 막는다.

async function issueAccessToken(cfg) {
  const now = Math.floor(Date.now() / 1000)
  let key
  try {
    key = await importPKCS8(cfg.privateKey, 'RS256')
  } catch {
    throw new Error('프라이빗 키 형식 오류 — PKCS8 PEM(-----BEGIN PRIVATE KEY-----)인지 확인하세요.')
  }
  const assertion = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(cfg.clientId) // iss = Client ID
    .setSubject(cfg.serviceAccount) // sub = Service Account(이메일)
    .setIssuedAt(now)
    .setExpirationTime(now + 1800) // 최대 3600초, 여유 있게 30분
    .sign(key)
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: cfg.scope,
  })
  const res = await timedFetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.access_token) {
    const why = data?.error_description || data?.error || `HTTP ${res.status}`
    throw new Error(`토큰 발급 실패: ${why}`)
  }
  const ttl = Number(data.expires_in) || 3600
  return { value: data.access_token, expiresAt: Date.now() + (ttl - 60) * 1000 }
}

async function getAccessToken(cfg, force = false) {
  if (!force && _token && _token.expiresAt > Date.now()) return _token.value
  if (!_issuing) {
    _issuing = issueAccessToken(cfg)
      .then((t) => {
        _token = t
        return t.value
      })
      .finally(() => {
        _issuing = null
      })
  }
  return _issuing
}

// ── 메시지 발송 ───────────────────────────────────────────────────────────────
/** Bot → 수신자(운영자) 텍스트 메시지. 401(토큰 만료)이면 1회 강제 갱신 후 재시도. */
async function sendText(cfg, text) {
  const url = `${API_BASE}/bots/${encodeURIComponent(cfg.botId)}/users/${encodeURIComponent(
    cfg.userId,
  )}/messages`
  const payload = JSON.stringify({ content: { type: 'text', text } })
  const doSend = (token) =>
    timedFetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: payload,
    })
  let res = await doSend(await getAccessToken(cfg))
  if (res.status === 401) res = await doSend(await getAccessToken(cfg, true))
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    const why = data?.description || data?.message || `HTTP ${res.status}`
    throw new Error(`메시지 발송 실패: ${why}`)
  }
}

/** 계정 사용 신청 알림 본문(순수 함수 — 테스트 가능). */
export function buildRegistrationText({ name, id, role, division } = {}, appUrl = '') {
  const lines = [
    '🔔 계정 사용 신청 (승인 대기)',
    `이름: ${name || '(미입력)'}`,
    `전화: ${formatPhone(id)}`,
    `본부: ${divisionLabel(division)}`,
    `역할: ${roleLabel(role)}`,
    '',
    '개발자 승인이 필요합니다. 관리자 도구 › 승인 대기에서 처리하세요.',
  ]
  if (appUrl) lines.push(appUrl)
  return lines.join('\n')
}

/**
 * 계정 사용 신청 알림 발송(설정 시). 절대 throw 하지 않는다 — 알림 실패가
 * 회원 등록 응답을 막지 않도록 register 라우트에서 await 없이(fire-and-forget) 호출.
 */
export async function notifyRegistrationSafe(applicant) {
  try {
    const cfg = worksConfig()
    if (!isConfigured(cfg)) return { ok: false, skipped: true }
    await sendText(cfg, buildRegistrationText(applicant, cfg.appUrl))
    return { ok: true }
  } catch (e) {
    console.warn('[works] 신청 알림 발송 실패:', e?.message || e)
    return { ok: false, error: e?.message || String(e) }
  }
}

/** 관리자 도구 '알림 테스트' — 결과를 구조화해 반환(에러/미설정을 UI에 노출). */
export async function sendTestNotification() {
  const cfg = worksConfig()
  if (!isConfigured(cfg)) {
    return { ok: false, configured: false, error: '네이버웍스 알림 미설정 — WORKS_* 환경변수를 설정하세요.' }
  }
  try {
    await sendText(cfg, '✅ Sequence 알림 테스트 — 네이버웍스 연동이 정상 동작합니다.')
    return { ok: true, configured: true }
  } catch (e) {
    return { ok: false, configured: true, error: e?.message || String(e) }
  }
}

/** 테스트 편의: 캐시된 토큰 폐기. */
export function _resetTokenCache() {
  _token = null
}
