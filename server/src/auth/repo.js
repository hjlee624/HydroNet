// 인증 저장소 인터페이스 + 메모리(JSON 파일) 어댑터.
// 운영은 pgRepo.js(Postgres)가 같은 인터페이스를 구현 → 라우트/로직은 어댑터 무관.
//
// 인터페이스(모두 async):
//   users:    getUser(id) · listUsers() · upsertUser(u) · setUserPassword(id, hash) · deleteUser(id)
//   projects: listProjects() · getProject(id) · upsertProject(p) · setProjectAccessCode(id, hash)
//             · setProjectActive(id, active) · deleteProject(id)
//   members:  getMembership(projectId, userId) · listMembershipsForUser(userId)
//             · listMembers(projectId) · addMember(projectId, userId, role, by) · removeMember(projectId, userId)
//   u  = { id, name, role, passwordHash?, active }
//   p  = { id, name, accessCodeHash?, createdBy }
//   m  = { projectId, userId, role('pm'|'user'), addedBy }
import fs from 'node:fs'
import path from 'node:path'

/** 메모리 어댑터 — file(JSON)로 로드/영속(재시작 보존). 운영엔 pgRepo 사용. */
export function createMemoryRepo(file) {
  const state = { users: {}, projects: {}, members: [] }
  if (file && fs.existsSync(file)) {
    try {
      Object.assign(state, JSON.parse(fs.readFileSync(file, 'utf8')))
      state.users ??= {}
      state.projects ??= {}
      state.members ??= []
    } catch {
      /* 손상 시 빈 상태로 시작 */
    }
  }
  const save = () => {
    if (!file) return
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2))
      fs.renameSync(tmp, file)
    } catch {
      /* best-effort */
    }
  }
  const clone = (o) => (o ? JSON.parse(JSON.stringify(o)) : o)

  return {
    backend: 'memory',
    async getUser(id) {
      return clone(state.users[id]) ?? null
    },
    async listUsers() {
      return Object.values(state.users).map(clone)
    },
    async upsertUser(u) {
      const prev = state.users[u.id] ?? {}
      state.users[u.id] = {
        id: u.id,
        name: u.name ?? prev.name ?? '',
        role: u.role ?? prev.role ?? 'user',
        division: u.division ?? prev.division ?? null,
        passwordHash: u.passwordHash ?? prev.passwordHash ?? null,
        active: u.active ?? prev.active ?? true,
        pending: u.pending ?? prev.pending ?? false,
        resetRequested: u.resetRequested ?? prev.resetRequested ?? false,
        mustChangePassword: u.mustChangePassword ?? prev.mustChangePassword ?? false,
        pendingAt: u.pendingAt ?? prev.pendingAt ?? null,
        resetRequestedAt: u.resetRequestedAt ?? prev.resetRequestedAt ?? null,
      }
      save()
      return clone(state.users[u.id])
    },
    async insertUser(u) {
      // #38: create-if-absent 원자 삽입. 단일 스레드라 검사→삽입 사이 await가 없어
      // 동시 등록이 서로를 조용히 덮어쓰는 TOCTOU를 차단(존재 시 conflict throw).
      if (state.users[u.id]) throw Object.assign(new Error('user-exists'), { code: 'conflict' })
      return this.upsertUser(u)
    },
    async setUserPassword(id, hash) {
      if (state.users[id]) {
        state.users[id].passwordHash = hash
        save()
      }
    },
    async deleteUser(id) {
      delete state.users[id]
      // 해당 사용자의 프로젝트 멤버십도 함께 제거(고아 멤버십 방지).
      state.members = state.members.filter((m) => m.userId !== id)
      save()
    },
    async listProjects() {
      return Object.values(state.projects).map(clone)
    },
    async getProject(id) {
      return clone(state.projects[id]) ?? null
    },
    async upsertProject(p) {
      const prev = state.projects[p.id] ?? {}
      state.projects[p.id] = {
        id: p.id,
        name: p.name ?? prev.name ?? '',
        accessCodeHash: p.accessCodeHash ?? prev.accessCodeHash ?? null,
        createdBy: p.createdBy ?? prev.createdBy ?? null,
        active: p.active ?? prev.active ?? true,
        division: p.division ?? prev.division ?? null,
        sample: p.sample ?? prev.sample ?? false,
      }
      save()
      return clone(state.projects[p.id])
    },
    async createProjectWithMember(p, member) {
      // #38: 프로젝트 생성 + PM 멤버십을 한 단위로 처리(부분 실패 시 프로젝트 롤백)해
      // 'PM 멤버십 누락' 비원자성 문제를 없앤다.
      const hadProject = state.projects[p.id] !== undefined
      await this.upsertProject(p)
      try {
        await this.addMember(p.id, member.userId, member.role, member.by)
      } catch (error) {
        if (!hadProject) {
          delete state.projects[p.id]
          save()
        }
        throw error
      }
      return clone(state.projects[p.id])
    },
    async setProjectAccessCode(id, hash) {
      if (state.projects[id]) {
        state.projects[id].accessCodeHash = hash
        save()
      }
    },
    async setProjectActive(id, active) {
      if (state.projects[id]) {
        state.projects[id].active = !!active
        save()
      }
    },
    async deleteProject(id) {
      delete state.projects[id]
      state.members = state.members.filter((m) => m.projectId !== id)
      save()
    },
    async getMembership(projectId, userId) {
      return (
        clone(state.members.find((m) => m.projectId === projectId && m.userId === userId)) ?? null
      )
    },
    async listMembershipsForUser(userId) {
      return state.members.filter((m) => m.userId === userId).map(clone)
    },
    async listMembers(projectId) {
      return state.members.filter((m) => m.projectId === projectId).map(clone)
    },
    async addMember(projectId, userId, role, by) {
      const ex = state.members.find((m) => m.projectId === projectId && m.userId === userId)
      if (ex) ex.role = role
      else state.members.push({ projectId, userId, role, addedBy: by ?? null })
      save()
    },
    async removeMember(projectId, userId) {
      state.members = state.members.filter(
        (m) => !(m.projectId === projectId && m.userId === userId),
      )
      save()
    },
  }
}
