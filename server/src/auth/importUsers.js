// 엑셀(.xlsx)/CSV 업로드 → 사용자 upsert. developer 전용(routes에서 게이트).
// 컬럼(대소문자·한글 헤더 허용): username|id|사번 · name|이름 · role|역할|그룹 · password|비밀번호(선택).
import * as XLSX from 'xlsx'
import { hashSecret } from './crypto.js'
import { canonicalPhoneId, normalizeLoginId } from './phone.js'
import { isRole } from './roles.js'

const pick = (row, keys) => {
  const map = {}
  for (const k of Object.keys(row)) map[String(k).trim().toLowerCase()] = row[k]
  for (const k of keys)
    if (map[k] != null && String(map[k]).trim() !== '') return String(map[k]).trim()
  return ''
}
const ROLE_ALIAS = {
  developer: 'developer',
  dev: 'developer',
  개발자: 'developer',
  pm: 'pm',
  manager: 'pm',
  관리자: 'pm',
  프로젝트관리자: 'pm',
  'project manager': 'pm',
  user: 'user',
  사용자: 'user',
  member: 'user',
}
const normRole = (v) => ROLE_ALIAS[String(v).trim().toLowerCase()] ?? (isRole(v) ? v : 'user')

const ROSTER_PHONE_HEADERS = ['전화번호', '휴대전화', '휴대폰']
const ROSTER_NAME_HEADERS = ['이름', '성명', 'name']
const ROSTER_GROUP_HEADERS = ['그룹', '역할', 'role', 'group']

const normalizedHeaders = (sheet) =>
  (XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })[0] ?? []).map((v) =>
    String(v).trim().toLowerCase(),
  )

const hasAnyHeader = (headers, candidates) => candidates.some((h) => headers.includes(h))

export class UserImportValidationError extends Error {
  constructor(summary) {
    const parts = Object.entries(summary)
      .filter(([, count]) => count > 0)
      .map(([key, count]) => `${key}=${count}`)
    super(`사용자 파일 검증 실패: ${parts.join(', ') || 'unknown=1'}`)
    this.name = 'UserImportValidationError'
    this.summary = summary
    this.status = 400
    this.expose = true
  }
}

function workbookRows(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) throw new UserImportValidationError({ missingSheet: 1 })
  return {
    headers: normalizedHeaders(sheet),
    rows: XLSX.utils.sheet_to_json(sheet, { defval: '' }),
  }
}

function parseRosterRows(headers, rows) {
  const summary = {
    missingPhoneHeader: hasAnyHeader(headers, ROSTER_PHONE_HEADERS) ? 0 : 1,
    missingNameHeader: hasAnyHeader(headers, ROSTER_NAME_HEADERS) ? 0 : 1,
    missingGroupHeader: hasAnyHeader(headers, ROSTER_GROUP_HEADERS) ? 0 : 1,
    emptyRoster: rows.length === 0 ? 1 : 0,
    invalidPhone: 0,
    missingName: 0,
    missingGroup: 0,
    unknownGroup: 0,
    duplicatePhone: 0,
  }
  if (summary.missingPhoneHeader || summary.missingNameHeader || summary.missingGroupHeader)
    throw new UserImportValidationError(summary)

  const seen = new Set()
  const out = []
  for (const row of rows) {
    const username = canonicalPhoneId(pick(row, ROSTER_PHONE_HEADERS))
    const name = pick(row, ROSTER_NAME_HEADERS)
    const rawGroup = pick(row, ROSTER_GROUP_HEADERS)
    const role = ROLE_ALIAS[String(rawGroup).trim().toLowerCase()] ?? null

    if (!username) summary.invalidPhone++
    if (!name) summary.missingName++
    if (!rawGroup) summary.missingGroup++
    else if (!role) summary.unknownGroup++
    if (username && seen.has(username)) summary.duplicatePhone++
    if (username) seen.add(username)

    if (username && name && role) {
      out.push({
        username,
        name,
        role,
        password: username.slice(-4),
        passwordKind: 'initial-phone-last4',
      })
    }
  }
  if (Object.values(summary).some((count) => count > 0))
    throw new UserImportValidationError(summary)
  return out
}

function parseGenericRows(rows) {
  const out = []
  for (const row of rows) {
    const rawUsername = pick(row, ['username', 'id', '사번', '아이디', 'userid'])
    if (!rawUsername) continue
    out.push({
      username: normalizeLoginId(rawUsername),
      name: pick(row, ['name', '이름', '성명']),
      role: normRole(pick(row, ['role', '역할', '그룹', 'group'])),
      password: pick(row, ['password', '비밀번호', 'pw', 'passwd']),
      passwordKind: 'explicit',
    })
  }
  return out
}

/** buffer(업로드된 파일) → [{username,name,role,password?}] 파싱. */
export function parseUsersFile(buffer) {
  const { headers, rows } = workbookRows(buffer)
  return hasAnyHeader(headers, ROSTER_PHONE_HEADERS)
    ? parseRosterRows(headers, rows)
    : parseGenericRows(rows)
}

/** 전화번호 roster 전용 엄격 파서. 적용 전에 전체 행을 검증한다. */
export function parseRosterFile(buffer) {
  const { headers, rows } = workbookRows(buffer)
  return parseRosterRows(headers, rows)
}

export function summarizeUsers(parsed) {
  const roles = { developer: 0, pm: 0, user: 0 }
  for (const user of parsed) roles[user.role]++
  return { users: parsed.length, roles }
}

/**
 * 검증 완료된 사용자들을 repo에 upsert한다.
 * 전화번호 기반 초기 비밀번호는 신규/미설정 계정에만 적용하고, 명시 reset에서만 재설정한다.
 */
export async function importParsedUsers(repo, parsed, { resetPasswords = false } = {}) {
  let withPassword = 0
  let created = 0
  let preservedPasswords = 0
  for (const u of parsed) {
    const existing = await repo.getUser(u.username)
    if (!existing) created++
    const isInitialPassword = u.passwordKind === 'initial-phone-last4'
    const shouldSetPassword =
      !!u.password && (!isInitialPassword || resetPasswords || !existing?.passwordHash)
    const passwordHash = shouldSetPassword ? await hashSecret(u.password) : undefined
    if (passwordHash) withPassword++
    else if (u.password && existing?.passwordHash) preservedPasswords++
    await repo.upsertUser({
      id: u.username,
      name: u.name,
      role: u.role,
      active: existing?.active ?? true,
      ...(passwordHash ? { passwordHash } : {}),
    })
  }
  return { imported: parsed.length, created, withPassword, preservedPasswords }
}

/** repo에 upsert. 입력 전체 파싱/검증 성공 후에만 쓰기를 시작한다. */
export async function importUsers(repo, buffer, options) {
  return importParsedUsers(repo, parseUsersFile(buffer), options)
}
