// 비밀번호·접속코드 해시(Node 내장 scrypt, 네이티브 의존 0) + 세션/프로젝트 JWT(jose HS256).
import { scrypt as _scrypt, randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { jwtVerify, SignJWT } from 'jose'

const scrypt = promisify(_scrypt)
const KEYLEN = 32

/** scrypt 해시 → "scrypt$<saltHex>$<hashHex>". 비밀번호·접속코드 공용. */
export async function hashSecret(plain) {
  const salt = randomBytes(16)
  const dk = await scrypt(String(plain), salt, KEYLEN)
  return `scrypt$${salt.toString('hex')}$${dk.toString('hex')}`
}

/** 타이밍 안전 비교. stored가 없으면(미설정) 항상 false. */
export async function verifySecret(plain, stored) {
  if (!stored || typeof stored !== 'string') return false
  const [scheme, saltHex, hashHex] = stored.split('$')
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false
  const dk = await scrypt(String(plain), Buffer.from(saltHex, 'hex'), KEYLEN)
  const a = Buffer.from(hashHex, 'hex')
  return a.length === dk.length && timingSafeEqual(a, dk)
}

// ── JWT (jose HS256, 단일 발급/검증 서버) ──────────────────────────────────────
// 비밀키는 AUTH_JWT_SECRET(운영 필수). 없으면 기동마다 랜덤(=재시작 시 세션 무효 — dev 편의).
let _secret = null
function secret() {
  if (_secret) return _secret
  const env = process.env.AUTH_JWT_SECRET
  const raw = env && env.length >= 16 ? env : randomBytes(48).toString('hex')
  _secret = new TextEncoder().encode(raw)
  return _secret
}
const ISS = 'sequence-auth'

/** AUTH_JWT_SECRET(16자 이상)이 실제로 설정됐는지. 미설정이면 재시작마다 랜덤 키(세션 무효). */
export function jwtSecretConfigured() {
  const env = process.env.AUTH_JWT_SECRET
  return typeof env === 'string' && env.length >= 16
}

/**
 * 운영 모드에서 AUTH_JWT_SECRET 미설정이면 기동을 거부(throw)한다.
 * secure=true(NODE_ENV=production 또는 AUTH_SECURE_COOKIE=1)인데 시크릿이 없으면
 * 재기동 한 번으로 전 세션·프로젝트·collab 티켓이 무경고 무효가 되므로 조기 중단이 옳다.
 */
export function assertJwtSecret({ secure = false } = {}) {
  if (!jwtSecretConfigured() && secure) {
    throw new Error(
      'AUTH_JWT_SECRET(16자 이상)이 설정되지 않았습니다. 운영 모드(NODE_ENV=production 또는 AUTH_SECURE_COOKIE=1)에서는 필수입니다. server/.env에 AUTH_JWT_SECRET을 설정하세요.',
    )
  }
  return jwtSecretConfigured()
}

/** 세션 토큰(신원). payload = {sub, role, name}. */
export function signSession(user, ttl = '12h') {
  return new SignJWT({ role: user.role, name: user.name ?? '' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuer(ISS)
    .setAudience('session')
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(secret())
}

/** 프로젝트 토큰(접속코드 통과 후 발급). payload = {sub, projectId, projRole, canEdit}. */
export function signProjectToken(userId, projectId, projRole, canEdit, ttl = '12h') {
  return new SignJWT({ projectId, projRole, canEdit: !!canEdit })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISS)
    .setAudience('project')
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(secret())
}

/**
 * 협업 WebSocket 연결에만 쓰는 단수명 티켓.
 * 장기 project grant를 소켓에 직접 전달하지 않고, aud/typ가 분리된 5분 토큰으로 교환한다.
 */
export function signCollabToken(userId, projectId, projRole, canEdit, ttl = '5m') {
  return new SignJWT({ projectId, projRole, canEdit: !!canEdit, typ: 'collab' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISS)
    .setAudience('collab')
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(secret())
}

/** aud 지정 검증. 실패 시 throw. */
export async function verifyToken(token, audience) {
  const { payload } = await jwtVerify(token, secret(), {
    issuer: ISS,
    audience,
    algorithms: ['HS256'],
  })
  return payload
}
