// DB/ID.xlsx → 인증 저장소 계정/RBAC 시드.
// 기본은 dry-run. 실제 반영은 --apply, 기존 초기비밀번호 재설정은 --apply --reset-passwords.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifySecret } from '../src/auth/crypto.js'
import {
  importParsedUsers,
  parseRosterFile,
  summarizeUsers,
  UserImportValidationError,
} from '../src/auth/importUsers.js'
import { createPgRepo } from '../src/auth/pgRepo.js'
import { createMemoryRepo } from '../src/auth/repo.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const DEFAULT_FILE = path.join(ROOT, 'DB', 'ID.xlsx')
const AUTH_FILE = path.join(ROOT, 'server', 'data', 'auth.json')

function parseArgs(argv) {
  const options = { apply: false, resetPasswords: false, file: DEFAULT_FILE, projectId: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--apply') options.apply = true
    else if (arg === '--reset-passwords') options.resetPasswords = true
    else if (arg === '--file') {
      const next = argv[++i]
      if (!next) throw new Error('missing-file-argument')
      options.file = path.resolve(next)
    } else if (arg === '--project') {
      const next = argv[++i]
      if (!next) throw new Error('missing-project-argument')
      options.projectId = next
    } else throw new Error('unknown-argument')
  }
  if (options.resetPasswords && !options.apply) throw new Error('reset-requires-apply')
  return options
}

function openRepo() {
  const backend = process.env.AUTH_BACKEND || 'memory'
  if (backend === 'pg') {
    if (!process.env.DATABASE_URL) throw new Error('database-url-required')
    return createPgRepo(process.env.DATABASE_URL)
  }
  if (backend !== 'memory') throw new Error('unsupported-auth-backend')
  return createMemoryRepo(AUTH_FILE)
}

const countRoles = (users) => {
  const roles = { developer: 0, pm: 0, user: 0 }
  for (const user of users) if (roles[user.role] != null) roles[user.role]++
  return roles
}

export async function runRosterSeed(options) {
  const parsed = parseRosterFile(fs.readFileSync(options.file))
  const roster = summarizeUsers(parsed)
  const repo = openRepo()
  try {
    const projects = await repo.listProjects()
    const selectedProjects = options.projectId
      ? projects.filter((project) => project.id === options.projectId)
      : projects.length === 1
        ? projects
        : []
    if (options.projectId && selectedProjects.length !== 1) throw new Error('project-not-found')
    if (options.apply && projects.length > 1 && !options.projectId) {
      throw new Error('project-selection-required')
    }
    const membershipPlan =
      selectedProjects.length === 1
        ? {
            action: options.apply ? 'apply' : 'planned',
            projects: 1,
            pm: roster.roles.pm,
            user: roster.roles.user,
          }
        : {
            action: 'skipped',
            reason: projects.length === 0 ? 'no-project' : 'project-selection-required',
          }

    if (!options.apply) {
      return {
        ok: true,
        mode: 'dry-run',
        backend: repo.backend,
        roster,
        projectCount: projects.length,
        membership: membershipPlan,
      }
    }

    const imported = await importParsedUsers(repo, parsed, {
      resetPasswords: options.resetPasswords,
    })
    if (selectedProjects.length === 1) {
      const developer = parsed.find((user) => user.role === 'developer')
      const addedBy = developer?.username ?? null
      for (const user of parsed) {
        if (user.role === 'developer') continue
        await repo.addMember(selectedProjects[0].id, user.username, user.role, addedBy)
      }
    }

    // memory adapter의 best-effort save가 실패해도 같은 인스턴스 메모리 조회는 성공할 수 있다.
    // 디스크 파일을 새 repo로 다시 열어 실제 영속 반영을 증명한다.
    const verificationRepo = repo.backend === 'memory' ? createMemoryRepo(AUTH_FILE) : repo
    const stored = await Promise.all(parsed.map((user) => verificationRepo.getUser(user.username)))
    const missing = stored.filter((user) => !user).length
    const withoutPasswordHash = stored.filter((user) => !user?.passwordHash).length
    const roleMismatch = stored.filter((user, i) => user?.role !== parsed[i].role).length
    let initialPasswordVerified = 0
    for (let i = 0; i < parsed.length; i++) {
      if (
        stored[i]?.passwordHash &&
        (await verifySecret(parsed[i].password, stored[i].passwordHash))
      )
        initialPasswordVerified++
    }

    let memberships = { pm: 0, user: 0 }
    if (selectedProjects.length === 1) {
      const rosterIds = new Set(parsed.map((user) => user.username))
      const rows = (await verificationRepo.listMembers(selectedProjects[0].id)).filter((member) =>
        rosterIds.has(member.userId),
      )
      memberships = countRoles(rows)
    }

    const expectedMemberships =
      selectedProjects.length === 1
        ? memberships.pm === roster.roles.pm && memberships.user === roster.roles.user
        : true
    const reconciled =
      missing === 0 && withoutPasswordHash === 0 && roleMismatch === 0 && expectedMemberships
    if (!reconciled) throw new Error('reconciliation-failed')

    return {
      ok: true,
      mode: 'apply',
      backend: repo.backend,
      roster,
      imported,
      reconciliation: {
        persistenceProof: repo.backend === 'memory' ? 'disk-reopen' : 'database-readback',
        matchedAccounts: parsed.length - missing,
        roleMismatch,
        withPasswordHash: parsed.length - withoutPasswordHash,
        initialPasswordVerified,
        roles: countRoles(stored.filter(Boolean)),
      },
      projectCount: projects.length,
      membership:
        selectedProjects.length === 1
          ? { action: 'applied', projects: 1, pm: memberships.pm, user: memberships.user }
          : membershipPlan,
    }
  } finally {
    await repo.pool?.end()
  }
}

async function main() {
  try {
    const result = await runRosterSeed(parseArgs(process.argv.slice(2)))
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    const output =
      error instanceof UserImportValidationError
        ? { ok: false, error: 'validation-failed', summary: error.summary }
        : { ok: false, error: error instanceof Error ? error.message : 'seed-failed' }
    console.error(JSON.stringify(output, null, 2))
    process.exitCode = 1
  }
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) await main()
