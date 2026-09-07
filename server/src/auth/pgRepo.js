// Postgres 어댑터 — repo.js와 동일 인터페이스. 운영용(AUTH_BACKEND=pg, DATABASE_URL).
// 스키마: server/db/schema.sql. 인증 게이트는 앱 로직(라우트/onAuthenticate)이며 RLS 아님(ADR-001).
import pg from 'pg'

/** createPgRepo(connectionString) → repo. 최초 사용 시 스키마 존재 가정(schema.sql 적용). */
export function createPgRepo(connectionString) {
  const pool = new pg.Pool({ connectionString })
  const q = (text, params) => pool.query(text, params)
  const userRow = (r) =>
    r && {
      id: r.id,
      name: r.name,
      role: r.role,
      division: r.division,
      passwordHash: r.password_hash,
      active: r.active,
      pending: r.pending,
      resetRequested: r.reset_requested,
      mustChangePassword: r.must_change_password,
      pendingAt: r.pending_at != null ? Number(r.pending_at) : null,
      resetRequestedAt: r.reset_requested_at != null ? Number(r.reset_requested_at) : null,
    }
  const projRow = (r) =>
    r && {
      id: r.id,
      name: r.name,
      accessCodeHash: r.access_code_hash,
      createdBy: r.created_by,
      active: r.active,
      division: r.division,
      sample: r.sample,
    }
  const memRow = (r) =>
    r && { projectId: r.project_id, userId: r.user_id, role: r.role, addedBy: r.added_by }

  return {
    backend: 'pg',
    pool,
    async getUser(id) {
      return userRow((await q('SELECT * FROM users WHERE id=$1', [id])).rows[0]) ?? null
    },
    async listUsers() {
      return (await q('SELECT * FROM users ORDER BY id')).rows.map(userRow)
    },
    async upsertUser(u) {
      // reset_requested/must_change_password: INSERT 시 미제공이면 false, UPDATE 시 미제공(null)이면
      // 기존 값 보존(COALESCE). 부분 upsert(예: /admin approve)에서도 플래그가 지워지지 않게 —
      // 메모리 어댑터의 `u.x ?? prev.x ?? false` 와 동일한 의미.
      const r = await q(
        `INSERT INTO users (id,name,role,division,password_hash,active,pending,reset_requested,must_change_password,pending_at,reset_requested_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,false),COALESCE($9,false),$10,$11)
         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role,
           division=COALESCE(EXCLUDED.division, users.division),
           password_hash=COALESCE(EXCLUDED.password_hash, users.password_hash),
           active=EXCLUDED.active, pending=EXCLUDED.pending,
           reset_requested=COALESCE($8, users.reset_requested),
           must_change_password=COALESCE($9, users.must_change_password),
           pending_at=COALESCE($10, users.pending_at),
           reset_requested_at=COALESCE($11, users.reset_requested_at),
           updated_at=now()
         RETURNING *`,
        [
          u.id,
          u.name ?? '',
          u.role ?? 'user',
          u.division ?? null,
          u.passwordHash ?? null,
          u.active ?? true,
          u.pending ?? false,
          u.resetRequested ?? null,
          u.mustChangePassword ?? null,
          u.pendingAt ?? null,
          u.resetRequestedAt ?? null,
        ],
      )
      return userRow(r.rows[0])
    },
    async insertUser(u) {
      // #38: create-if-absent(존재 시 conflict). 동시 등록 last-write-wins 방지.
      const r = await q(
        `INSERT INTO users (id,name,role,division,password_hash,active,pending,reset_requested,must_change_password,pending_at,reset_requested_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,false),COALESCE($9,false),$10,$11)
         ON CONFLICT (id) DO NOTHING
         RETURNING *`,
        [
          u.id,
          u.name ?? '',
          u.role ?? 'user',
          u.division ?? null,
          u.passwordHash ?? null,
          u.active ?? true,
          u.pending ?? false,
          u.resetRequested ?? null,
          u.mustChangePassword ?? null,
          u.pendingAt ?? null,
          u.resetRequestedAt ?? null,
        ],
      )
      if (!r.rows[0]) throw Object.assign(new Error('user-exists'), { code: 'conflict' })
      return userRow(r.rows[0])
    },
    async setUserPassword(id, hash) {
      await q('UPDATE users SET password_hash=$2, updated_at=now() WHERE id=$1', [id, hash])
    },
    async deleteUser(id) {
      await q('DELETE FROM users WHERE id=$1', [id]) // project_members ON DELETE CASCADE
    },
    async listProjects() {
      return (await q('SELECT * FROM projects ORDER BY updated_at DESC')).rows.map(projRow)
    },
    async getProject(id) {
      return projRow((await q('SELECT * FROM projects WHERE id=$1', [id])).rows[0]) ?? null
    },
    async upsertProject(p) {
      const r = await q(
        `INSERT INTO projects (id,name,access_code_hash,created_by,active,division,sample) VALUES ($1,$2,$3,$4,COALESCE($5,true),$6,COALESCE($7,false))
         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,
           access_code_hash=COALESCE(EXCLUDED.access_code_hash, projects.access_code_hash),
           active=COALESCE($5, projects.active),
           division=COALESCE(EXCLUDED.division, projects.division),
           sample=COALESCE($7, projects.sample),
           updated_at=now()
         RETURNING *`,
        [
          p.id,
          p.name ?? '',
          p.accessCodeHash ?? null,
          p.createdBy ?? null,
          p.active ?? null,
          p.division ?? null,
          p.sample ?? null,
        ],
      )
      return projRow(r.rows[0])
    },
    async createProjectWithMember(p, member) {
      // #38: 프로젝트 생성 + PM 멤버십을 단일 트랜잭션으로 묶어 원자성 보장.
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const r = await client.query(
          `INSERT INTO projects (id,name,access_code_hash,created_by,active,division,sample) VALUES ($1,$2,$3,$4,COALESCE($5,true),$6,COALESCE($7,false))
           ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,
             access_code_hash=COALESCE(EXCLUDED.access_code_hash, projects.access_code_hash),
             active=COALESCE($5, projects.active),
             division=COALESCE(EXCLUDED.division, projects.division),
             sample=COALESCE($7, projects.sample),
             updated_at=now()
           RETURNING *`,
          [
            p.id,
            p.name ?? '',
            p.accessCodeHash ?? null,
            p.createdBy ?? null,
            p.active ?? null,
            p.division ?? null,
            p.sample ?? null,
          ],
        )
        await client.query(
          `INSERT INTO project_members (project_id,user_id,role,added_by) VALUES ($1,$2,$3,$4)
           ON CONFLICT (project_id,user_id) DO UPDATE SET role=EXCLUDED.role`,
          [p.id, member.userId, member.role, member.by ?? null],
        )
        await client.query('COMMIT')
        return projRow(r.rows[0])
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        throw error
      } finally {
        client.release()
      }
    },
    async setProjectAccessCode(id, hash) {
      await q('UPDATE projects SET access_code_hash=$2, updated_at=now() WHERE id=$1', [id, hash])
    },
    async setProjectActive(id, active) {
      await q('UPDATE projects SET active=$2, updated_at=now() WHERE id=$1', [id, !!active])
    },
    async deleteProject(id) {
      await q('DELETE FROM projects WHERE id=$1', [id]) // members ON DELETE CASCADE
    },
    async getMembership(projectId, userId) {
      return (
        memRow(
          (
            await q('SELECT * FROM project_members WHERE project_id=$1 AND user_id=$2', [
              projectId,
              userId,
            ])
          ).rows[0],
        ) ?? null
      )
    },
    async listMembershipsForUser(userId) {
      return (await q('SELECT * FROM project_members WHERE user_id=$1', [userId])).rows.map(memRow)
    },
    async listMembers(projectId) {
      return (await q('SELECT * FROM project_members WHERE project_id=$1', [projectId])).rows.map(
        memRow,
      )
    },
    async addMember(projectId, userId, role, by) {
      await q(
        `INSERT INTO project_members (project_id,user_id,role,added_by) VALUES ($1,$2,$3,$4)
         ON CONFLICT (project_id,user_id) DO UPDATE SET role=EXCLUDED.role`,
        [projectId, userId, role, by ?? null],
      )
    },
    async removeMember(projectId, userId) {
      await q('DELETE FROM project_members WHERE project_id=$1 AND user_id=$2', [projectId, userId])
    },
    async fetchYDoc(name) {
      const row = (await q('SELECT data FROM ydocs WHERE name=$1', [name])).rows[0]
      return row?.data ?? null
    },
    async storeYDoc(name, data) {
      await q(
        `INSERT INTO ydocs (name,data) VALUES ($1,$2)
         ON CONFLICT (name) DO UPDATE SET data=EXCLUDED.data, updated_at=now()`,
        [name, Buffer.from(data)],
      )
    },
    async seedYDoc(name, data) {
      const inserted = await q(
        `INSERT INTO ydocs (name,data) VALUES ($1,$2)
         ON CONFLICT (name) DO NOTHING RETURNING data`,
        [name, Buffer.from(data)],
      )
      if (inserted.rows[0]) return inserted.rows[0].data
      return (await q('SELECT data FROM ydocs WHERE name=$1', [name])).rows[0]?.data ?? null
    },
    async deleteYDoc(name) {
      // #20: 프로젝트 삭제 시 라이브 CRDT row 정리(FK CASCADE와 별개로 명시 삭제).
      await q('DELETE FROM ydocs WHERE name=$1', [name])
    },
  }
}
