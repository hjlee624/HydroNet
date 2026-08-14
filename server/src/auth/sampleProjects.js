// 본부별 샘플 프로젝트 부트스트랩. 서버 시작 시 각 본부에 예시 프로젝트를 1개씩 만들어,
// 신규 사용자가 로그인하면 바로 자기 본부의 예시를 열어볼 수 있게 한다(온보딩용).
//   · 프로젝트 행: repo.upsertProject({ id, name, division, active })
//   · 룸 콘텐츠 시드: server/data/<id>.json (client/scripts/gen-sample-projects.ts 로 미리 생성)
// 멱등: 프로젝트 행이 이미 있으면 건너뛴다.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DIVISION_KEYS } from './roles.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SEED_DIR = path.resolve(__dirname, '..', '..', 'seed-samples')

/** 본부 → 샘플 프로젝트 id(문서명 규칙 [A-Za-z0-9_-] 준수). */
export const sampleProjectId = (division) => `p_sample_${division}`

export async function bootstrapSampleProjects(repo, dataDir) {
  const created = []
  for (const div of DIVISION_KEYS) {
    const id = sampleProjectId(div)
    if (await repo.getProject(id)) continue // 이미 존재 → 건너뜀
    let content
    try {
      content = JSON.parse(fs.readFileSync(path.join(SEED_DIR, `${div}.json`), 'utf8'))
    } catch {
      continue // 시드 콘텐츠 없으면 이 본부는 건너뜀
    }
    content.id = id // 룸 시드(encodeLegacyProject)는 id === documentName 요구
    const name = content.name || `[샘플] ${div}`
    // 콘텐츠 = 룸 시드(server/data/<id>.json). 이미 있으면 덮어쓰지 않음(사용자 편집 보존).
    const dest = path.join(dataDir, `${id}.json`)
    if (!fs.existsSync(dest)) fs.writeFileSync(dest, JSON.stringify(content, null, 2), 'utf8')
    await repo.upsertProject({ id, name, division: div, createdBy: null, active: true })
    created.push(id)
  }
  return created
}
