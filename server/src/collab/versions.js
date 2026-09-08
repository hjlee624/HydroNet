// 프로젝트 버전 보관소(F15) — CRDT 영속 시점마다 프로젝트 **ID 폴더**에 시각 버전
// JSON 을 남기고, 최근 keep 개만 유지한다.
//
// 왜 ID 인가: 옛 임시저장(/api/autosave)은 파일명을 safeName(project.name) 으로 잡아
// 서로 다른 두 프로젝트가 이름만 같으면(본부별 샘플, '○○ 도로 확장공사' 2건 등)
// 같은 파일 하나를 번갈아 덮어썼다. 이름은 언제든 바뀌고 중복되지만 ID 는 유일하다.
import fs from 'node:fs/promises'
import path from 'node:path'

/** 버전 파일명 규칙 — 'YYYYMMDDTHHMMSSZ'. 경로 조작 입력을 여기서 전부 차단한다. */
const VERSION_RE = /^\d{8}T\d{6}Z$/
/** storage.js 의 isDocumentName 과 동일한 프로젝트 ID 규칙. */
const PROJECT_RE = /^[A-Za-z0-9_-]{1,80}$/

const MIN_KEEP = 1
const MAX_KEEP = 200

/** Date → 'YYYYMMDDTHHMMSSZ'. */
const stampOf = (date) =>
  date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z')

/** 'YYYYMMDDTHHMMSSZ' → ISO 문자열(목록 표시용). */
export function versionToIso(version) {
  if (!VERSION_RE.test(version)) return null
  const [d, t] = version.split('T')
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}Z`
}

/**
 * @param {object} options
 * @param {string} options.root 버전 루트 폴더(프로젝트별 하위 폴더가 생긴다).
 * @param {(state: Uint8Array, projectId: string) => object} options.decode Y.Doc state → Project JSON.
 * @param {number} [options.keep] 프로젝트당 보관 개수 상한(1~200).
 * @param {number} [options.minIntervalMs] 보관 최소 간격(스로틀) — 자동·수동 공통. 0 이면 매 영속마다.
 * @param {{ error?: Function }} [options.logger]
 */
export function createVersionArchive({
  root,
  decode,
  keep = 20,
  minIntervalMs = 600_000,
  logger = console,
}) {
  const retention = Math.min(MAX_KEEP, Math.max(MIN_KEEP, Number(keep) || MIN_KEEP))
  const throttleMs = Math.max(0, Number(minIntervalMs) || 0)
  const lastRetainAt = new Map()
  const lastStampMs = new Map()

  const dirFor = (projectId) => {
    if (!PROJECT_RE.test(String(projectId ?? ''))) throw new Error('invalid-project-id')
    return path.join(root, projectId)
  }

  /** 같은 초에 두 번 보관해도 파일이 겹치지 않도록 프로세스 안에서 단조 증가시킨다. */
  const nextStamp = (projectId) => {
    const previous = lastStampMs.get(projectId) ?? 0
    const now = Math.max(Date.now(), previous + 1_000)
    lastStampMs.set(projectId, now)
    return stampOf(new Date(now))
  }

  /** 오래된 버전부터 지워 keep 개만 남긴다. */
  const prune = async (dir) => {
    const files = (await fs.readdir(dir).catch(() => []))
      .filter((f) => f.endsWith('.json') && VERSION_RE.test(f.slice(0, -5)))
      .sort()
    for (const file of files.slice(0, Math.max(0, files.length - retention))) {
      await fs.unlink(path.join(dir, file)).catch(() => {})
    }
  }

  return {
    root,
    keep: retention,
    minIntervalMs: throttleMs,

    /**
     * 버전 한 건 보관. 입력은 **Y.Doc 바이너리 state 하나뿐**이다 — 예전에는 이미 만들어진
     * project JSON 도 받아 그대로 적재했는데(POST /api/autosave), 그 경로로 호출자가 지어낸
     * 스냅샷이 복구 목록 맨 위에 올라갈 수 있었다. 이제 보관물은 서버가 라이브 CRDT 를
     * 디코드한 것만 존재한다.
     * 실패는 절대 위로 던지지 않는다 — 영속 본류(store)를 막으면 안 되기 때문.
     *
     * 반환은 **결과 구분자**다. 예전엔 스로틀도 실패도 똑같이 null 이라, 라우트가 먼저 본
     * retainWaitMs 와 여기의 재검사 사이(TOCTOU)에서 자동 보관이 끼어들면 사용자에게는
     * 500 '버전 저장에 실패했습니다'가 떴다 — 실제로는 그냥 간격 제한인데. 그래서
     * 'throttled' 와 'error' 를 갈라 라우트가 429(Retry-After)로 답할 수 있게 한다.
     * @returns {Promise<{status:'ok'|'throttled'|'error', version: string|null}>}
     */
    async retain(projectId, state) {
      try {
        const dir = dirFor(projectId)
        const now = Date.now()
        if (now - (lastRetainAt.get(projectId) ?? 0) < throttleMs)
          return { status: 'throttled', version: null }
        const snapshot = state?.length ? decode(state, projectId) : null
        if (!snapshot) return { status: 'error', version: null }

        const version = nextStamp(projectId)
        const file = path.join(dir, `${version}.json`)
        await fs.mkdir(dir, { recursive: true })
        const temp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
        try {
          await fs.writeFile(temp, JSON.stringify(snapshot, null, 2), 'utf8')
          await fs.rename(temp, file)
        } catch (error) {
          await fs.unlink(temp).catch(() => {})
          throw error
        }
        lastRetainAt.set(projectId, now)
        await prune(dir)
        return { status: 'ok', version }
      } catch (error) {
        logger.error?.('버전 보관 실패', error)
        return { status: 'error', version: null }
      }
    },

    /**
     * 다음 (force 없는) 보관까지 남은 밀리초. 0 이면 지금 보관할 수 있다.
     * 사용자가 직접 누르는 버전 저장 라우트가 '보관될까?'를 미리 물어보고, 안 되면
     * 조용히 실패(null)하는 대신 429 + 남은 시간을 돌려주기 위한 것.
     */
    retainWaitMs(projectId, now = Date.now()) {
      if (!PROJECT_RE.test(String(projectId ?? ''))) return 0
      const elapsed = now - (lastRetainAt.get(projectId) ?? 0)
      return Math.max(0, throttleMs - elapsed)
    },

    /** 최신순 버전 목록. 폴더가 없으면 빈 배열. */
    async list(projectId) {
      const dir = dirFor(projectId)
      const files = (await fs.readdir(dir).catch(() => []))
        .filter((f) => f.endsWith('.json') && VERSION_RE.test(f.slice(0, -5)))
        .sort()
        .reverse()
      const items = []
      for (const file of files) {
        const version = file.slice(0, -5)
        const stat = await fs.stat(path.join(dir, file)).catch(() => null)
        if (!stat) continue
        items.push({ version, savedAt: versionToIso(version), size: stat.size })
      }
      return items
    },

    /** 버전 원본 JSON 문자열. 형식 위반·미존재는 null. */
    async read(projectId, version) {
      const dir = dirFor(projectId)
      if (!VERSION_RE.test(String(version ?? ''))) return null
      return fs.readFile(path.join(dir, `${version}.json`), 'utf8').catch(() => null)
    },

    /** 프로젝트 삭제 시 버전 이력도 함께 정리(고아 데이터 잔존 방지). */
    async removeProject(projectId) {
      const dir = dirFor(projectId)
      lastRetainAt.delete(projectId)
      lastStampMs.delete(projectId)
      await fs.rm(dir, { recursive: true, force: true })
    },
  }
}
