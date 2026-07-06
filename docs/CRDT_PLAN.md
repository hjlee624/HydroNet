# CRDT(실시간 협업) 도입 계획 — 0단계 경계 정의

> 상태: **0단계(비파괴 명문화)만 반영됨.** 1단계 이상(실제 Y.Doc 도입)은 전문가 검토(이슈: `docs/ISSUE_CRDT.md`) 후 착수한다.
> 전문가 피드백 ⑥⑦ 반영. 상세 분석·근거는 리서치 보고서(`EXPERT_FEEDBACK_REVIEW_2026-07-06.html`) 참고.

## 왜 0단계가 먼저인가

CRDT의 최대 함정은 **파생 계산값을 협업 상태에 써 넣어 사용자끼리 서로 덮어쓰는 것**이다.
HydroNet은 다행히 이미 "사용자 입력값"과 "계산 결과"가 코드상 분리돼 있으므로, 그 경계를
**문서로 못 박아 두면** 이후 어떤 CRDT(Yjs 등)를 붙이든 안전하게 진행할 수 있다.

## 권위(authoritative) 데이터 vs 파생(derived) 캐시

CRDT/동기화/저장의 **진실원본**은 아래 "권위 데이터"뿐이다. "파생 캐시"는 각 클라이언트가
`withSchedule`/`applyCascade`/`mirror`로 **로컬 재계산**하며, **CRDT·동기화·`.json` 저장 어디에도 진실로 기록하지 않는다.**

### ✅ 권위 데이터 (동기화/저장 대상)
- `Project`: `id`, `name`, `kind`, `facility`, `startDate`, `paper`, `view`, `branding`, `palette`, `commissioningEnabled`
- `categories[]`: 각 공종의 `id`, `name`, `color`, `order`, `hidden`, …
- `tasks[]`: 각 공정의 `id`, `categoryId`, `name`, `subName`, `start`, `duration`, `durationLabel`, `row`, `progress`, `forceCritical`, `isDummy`, `hidden`, `milestone` 등 **사용자가 실제 입력/드래그한 값**
- `links[]`: `id`, `from`, `to`, `type`(FS/SS/FF/SF), `lag`, `style` — **의존성 존재와 파라미터**
- `rainySeasons[]`, `sheets[]`(비활성 시트 데이터), `modules`, `baseline`

### ⛔ 파생 캐시 (동기화/저장 금지 — 로컬 재계산)
- `Task.es / ef / ls / lf / totalFloat / critical` — `scheduling.ts`의 CPM 산출(단, `forceCritical`은 권위)
- `Task.__mirror` 및 mirror 관련 표시 필드 — `mirror.ts`가 예정공정표↔마일스톤 연동으로 생성
- `applyCascade`가 밀어낸 `start` — **주의**: cascade 결과로 바뀐 start는 파생이지만, 사용자가 직접 드래그한 start는 권위.
  → 1단계 구현 시 "사용자 제스처가 만든 start"만 CRDT 트랜잭션으로 기록하고, cascade는 관찰자(local)에서 재적용한다.
- `computeLayout`/`kpis.ts`(EVM·SPI/CPI)/`routing.ts` 산출물 — 전부 렌더 시 계산, 저장 안 함(이미 그러함)

## 붙일 지점 (요약)

| # | 위치 | 무엇을 | 난이도 |
|---|------|--------|--------|
| 1 | `state/store.ts` `commit()` / `project` | 유일한 쓰기 관문. project를 Y.Doc로, `mutate(draft)`를 `doc.transact` 요소변형으로 | 높음 |
| 2 | `state/store.ts` `past`/`future` | `Y.UndoManager`(trackedOrigins=로컬)로 대체 | 중간 |
| 3 | `server/src/index.js` | y-websocket provider(room=projectId) 부착, 오프라인은 미부착(옵션화) | 높음 |
| 4 | `state/api.ts` · `fileIO.ts` | `.json`(평면) ↔ Y.Doc 스냅샷 어댑터(schemaVersion 분기) | 중간 |

## 로드맵

- **0. 경계 고정(비파괴) — 본 문서. ✅ 반영.**
- 1. 로컬 데이터모델 CRDT화(provider 없음) + y-indexeddb. → build/smoke/mount 통과가 수용 기준.
- 2. undo/redo → `Y.UndoManager`.
- 3. provider(y-websocket) 서버 동기, 전체-파일 PUT 강등.
- 4. 프레즌스(awareness) — 원격 커서·선택.
- 5. 배포/호환 마감 — `.json`↔Y.Doc 무손실, LWW PUT 제거.

## 라이브러리 결론

**Yjs 1순위**(순수 JS → 단일 HTML/IIFE·file://·Electron 상성, y-indexeddb 오프라인, `Y.UndoManager`).
성능/재정렬 정확성이 병목으로 판명되면 **Loro 2순위** 승격 검토. Automerge는 변경 이력이 제품 기능일 때만.
