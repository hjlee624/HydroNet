import { verifyToken } from '../auth/crypto.js'
import { canAccessAll, canEditProjectDiv, canEnterProjectDiv } from '../auth/roles.js'

const denied = () => Object.assign(new Error(''), { reason: 'permission-denied' })

/**
 * Validate a short-lived project token against the current authorization store.
 * Token claims identify the requested grant, but current rows are authoritative.
 */
export async function authenticateProjectToken(repo, token, documentName) {
  if (!token) throw denied()

  const grant = await verifyToken(token, 'collab').catch(() => null)
  if (
    grant?.typ !== 'collab' ||
    !grant.sub ||
    !grant.projectId ||
    grant.projectId !== documentName
  ) {
    throw denied()
  }

  const [user, project] = await Promise.all([
    repo.getUser(String(grant.sub)),
    repo.getProject(String(documentName)),
  ])
  if (!user || user.active === false) throw denied()
  // Match HTTP access: developers retain recovery access to inactive projects.
  if (!project || (project.active === false && !canAccessAll(user))) throw denied()

  const membership = canAccessAll(user)
    ? { projectId: documentName, userId: user.id, role: 'developer' }
    : await repo.getMembership(documentName, user.id)
  if (!canEnterProjectDiv(user, project, membership)) throw denied()
  const currentRole = canAccessAll(user) ? 'developer' : (membership?.role ?? user.role)
  if (grant.projRole !== currentRole) throw denied()

  return {
    userId: user.id,
    projectId: documentName,
    projRole: currentRole,
    // 편집 권한(담당/개발자)만 편집. 그 외(같은 본부 PM 조회)는 읽기전용 연결.
    canEdit: canEditProjectDiv(user, project, membership),
  }
}
