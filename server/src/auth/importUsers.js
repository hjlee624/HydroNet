// 엑셀(.xlsx)/CSV 업로드 → 사용자 upsert. developer 전용(routes에서 게이트).
// 컬럼(대소문자·한글 헤더 허용): username|id|사번 · name|이름 · role|역할|그룹 · password|비밀번호(선택).
import * as XLSX from 'xlsx'
import { hashSecret } from './crypto.js'
import { isRole } from './roles.js'

const pick = (row, keys) => {
  const map = {}
  for (const k of Object.keys(row)) map[String(k).trim().toLowerCase()] = row[k]
  for (const k of keys) if (map[k] != null && String(map[k]).trim() !== '') return String(map[k]).trim()
  return ''
}
const ROLE_ALIAS = {
  developer: 'developer', dev: 'developer', 개발자: 'developer',
  pm: 'pm', manager: 'pm', 관리자: 'pm', 프로젝트관리자: 'pm', 'project manager': 'pm',
  user: 'user', 사용자: 'user', member: 'user',
}
const normRole = (v) => ROLE_ALIAS[String(v).trim().toLowerCase()] ?? (isRole(v) ? v : 'user')

/** buffer(업로드된 파일) → [{username,name,role,password?}] 파싱. */
export function parseUsersFile(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
  const out = []
  for (const row of rows) {
    const username = pick(row, ['username', 'id', '사번', '아이디', 'userid'])
    if (!username) continue
    out.push({
      username,
      name: pick(row, ['name', '이름', '성명']),
      role: normRole(pick(row, ['role', '역할', '그룹', 'group'])),
      password: pick(row, ['password', '비밀번호', 'pw', 'passwd']),
    })
  }
  return out
}

/** repo에 upsert. password 있으면 해시 설정. 반환 = {imported, withPassword}. */
export async function importUsers(repo, buffer) {
  const parsed = parseUsersFile(buffer)
  let withPassword = 0
  for (const u of parsed) {
    const passwordHash = u.password ? await hashSecret(u.password) : undefined
    if (passwordHash) withPassword++
    await repo.upsertUser({ id: u.username, name: u.name, role: u.role, ...(passwordHash ? { passwordHash } : {}) })
  }
  return { imported: parsed.length, withPassword }
}
