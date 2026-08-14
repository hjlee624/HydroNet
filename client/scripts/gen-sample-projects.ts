// 본부별 샘플 프로젝트 콘텐츠(공정표) 생성 → server/seed-samples/<division>.json.
// 서버 부트스트랩(bootstrapSampleProjects)이 이 파일을 읽어 프로젝트 행 + 룸 시드로 심는다.
//   npx tsx client/scripts/gen-sample-projects.ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { divisionLabel } from '../src/data/divisions'
import { facilityLabel } from '../src/data/facilities'
import { makeProject } from '../src/data/templates'
import type { ProjectKind } from '../src/types/model'

const OUT = 'D:/2026/PROGRAM/Sequence/server/seed-samples'

// 본부 → 대표 시설물·도면단계(내용이 풍부한 시공 위주, 기획성 본부는 타당성).
const MAP: { div: string; kind: ProjectKind; facility: string }[] = [
  { div: 'strategy', kind: 'feasibility', facility: 'road-new' },
  { div: 'water-env', kind: 'construction', facility: 'sewage-treatment' },
  { div: 'water-res', kind: 'construction', facility: 'concrete-gravity' },
  { div: 'land', kind: 'construction', facility: 'land-dev' },
  { div: 'railway', kind: 'construction', facility: 'rail-roadbed' },
  { div: 'road', kind: 'construction', facility: 'road-new' },
  { div: 'plant', kind: 'construction', facility: 'water-treatment' },
  { div: 'cm', kind: 'construction', facility: 'bridge-psc' },
  { div: 'overseas', kind: 'construction', facility: 'bridge-cable' },
  { div: 'bizdev', kind: 'feasibility', facility: 'road-new' },
  { div: 'safety', kind: 'construction', facility: 'dam-rehab' },
]

mkdirSync(OUT, { recursive: true })
for (const { div, kind, facility } of MAP) {
  const p = makeProject(kind, facility)
  p.name = `[샘플] ${divisionLabel(div)} — ${facilityLabel(facility)} 예시`
  p.id = '' // 서버 부트스트랩이 p_sample_<div> 로 설정
  writeFileSync(`${OUT}/${div}.json`, JSON.stringify(p, null, 2), 'utf8')
  console.log(`  ${div}.json  ← ${p.name}`)
}
console.log(`생성 완료: ${MAP.length}개 → ${OUT}`)
