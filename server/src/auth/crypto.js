// 비밀번호·접속코드 해시(Node 내장 scrypt, 네이티브 의존 0) + 세션/프로젝트 JWT(jose HS256).
import { scrypt as _scrypt, randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { SignJWT, jwtVerify } from 'jose'

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
const ISS = 'hydronet-auth'

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

/** 프로젝트 토큰(접속코드 통과 후 발급). payload = {sub, projectId, projRole}. */
export function signProjectToken(userId, projectId, projRole, ttl = '12h') {
  return new SignJWT({ projectId, projRole })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISS)
    .setAudience('project')
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
