## 배경 / 목적

HydroNet은 현재 **단일 사용자·단일 `Project` 문서·전체 스냅샷** 편집 도구다. 향후
LAN 다중 편집(현장 사무소에서 여러 PC가 같은 공정표를 동시 편집)을 위해
**CRDT(Yjs) 도입 지점과 단계적 로드맵**을 확정하고자 한다. 실제 코드(`store.ts`,
`model.ts`, `api.ts`, `fileIO.ts`, `server/src/index.js`)를 읽고 정리한 결과를 붙이니
전문가 검토·코멘트를 부탁드린다.

> 리포 호스트: Gitea(`gitea.hmac.kr/saman/HydroNET`). (일부 논의에서 GitHub 미러도 있으나 메인은 Gitea.)

## 현재 구조 (그라운드 트루스)

- **상태관리**: 앱 전체가 zustand 스토어 하나(`useEditor`), 편집 문서 `project: Project`가 통째로 그 안에.
- **유일한 쓰기 지점**: 모든 변경이 `store.ts`의 `commit(mutate, opts)`을 통과
  (clone → `mutate(draft)` → `applyCascade` → `withSchedule`로 CPM 재계산 → `set`). 변경 단위=문서 전체.
- **Undo/Redo**: CRDT 아님. 전체 문서 스냅샷 스택(`past`/`future`, `HISTORY_LIMIT=50`).
- **문서 구조(`model.ts`)**: `categories[]`/`tasks[]`/`links[]`/`rainySeasons[]`가 안정 id(nanoid) 리스트 컬렉션.
  멀티시트는 활성 시트만 최상위, `switchSheet`가 swap. `es/ef/ls/lf/critical`·`__mirror`는 계산/표시 전용(비영속).
- **저장**: 사용자가 '저장' 시. `fileIO.ts`가 File System Access로 project 전체를 `.json`.
  `api.ts`는 전체 문서 PUT `/api/projects/:id` + localStorage 폴백.
- **서버(`index.js`)**: 얇은 Express. PUT = 원자적 전체-파일 교체, 병합 없음(last-write-wins).
  동기화/웹소켓/프레즌스 계층 전무.

즉 CRDT 도입 = '전체 교체 파이프라인(`commit`·`past/future`·`setProject`·PUT)'을 '요소 단위 op'로 바꾸는 일.

## 후보 지점

| # | 위치 | 무엇을 | 난이도 |
|---|------|--------|--------|
| 1 | `store.ts` `commit()`/`project` | project를 Y.Doc로(rootMap + tasks/links/categories = `Y.Array<Y.Map>`), mutate를 `doc.transact` 요소변형으로 | 높음 |
| 2 | `store.ts` undo/redo | `past/future` → `Y.UndoManager` | 중간 |
| 3 | `server/src/index.js` | 기존 PUT과 별개로 y-websocket provider(room=projectId) + 서버 영속 | 높음 |
| 4 | `api.ts`/`fileIO.ts` | `.json`(평면)·Y.Doc 스냅샷 이중 저장 + 평면↔Y.Doc 어댑터 | 중간 |

## 추천: Yjs (+ y-websocket, y-indexeddb, Y.UndoManager)

- `Y.Array<Y.Map>`가 현재 id 기반 리스트 컬렉션에 1:1 대응(서로 다른 Task 편집=필드 병합, 동일 필드만 LWW).
- 순수 JS → 단일 HTML(IIFE)·file://·Electron 상성 좋음. y-indexeddb만으로 provider 없는 오프라인 영속 가능.
- (Automerge는 WASM 의존이라 단일 HTML 부담, Loro는 유망하나 생태계 성숙도 미흡 → 리스크 최소화 위해 Yjs 1순위.)

## 로드맵

0. **경계 고정(비파괴)**: `withSchedule/applyCascade` 산출(`es/ef/…/__mirror`)을 '동기화 제외'로 명문화. → 본 이슈와 함께 `docs/CRDT_PLAN.md`로 반영.
1. **로컬 데이터모델 CRDT화(provider 없음)**: `project` 보유를 Y.Doc로, `commit`을 `doc.transact`로,
   `observeDeep→withSchedule→zustand 평면 push`로 렌더 무변경. y-indexeddb 로컬 영속. → build+smoke+mount 통과.
2. **undo/redo 이관**: `past/future` → `Y.UndoManager`, CPM 재계산은 비추적 origin 격리.
3. **provider(서버 동기)**: `index.js`에 y-websocket ws 업그레이드. 기존 전체-파일 PUT은 스냅샷/백업으로 강등. 오프라인은 provider 미부착.
4. **프레즌스**: awareness로 원격 커서·선택(기존 `selectedTaskIds/selectedCategoryIds` 활용).
5. **배포/호환 마감**: `.json`↔Y.Doc 무손실 변환기(schemaVersion 분기), LWW PUT 제거/read-only화.

## 리스크

- **파생 스케줄 ↔ CRDT 진동**: 권위데이터=사용자 입력값만, cascade/withSchedule는 로컬 계산으로.
- **멀티시트**: 활성 시트만 최상위+swap 구조는 CRDT와 궁합 나쁨 → 모든 시트 Y.Doc 상주, '활성 시트'는 로컬 뷰로.
- **오프라인 배포**: 단일 HTML/file://에서 provider 상시 on 불가 → 옵션화 필수.
- **저장 포맷 이원화**: 평면 `.json` ↔ CRDT update(binary) 왕복 무손실.
- **undo 시맨틱 변화**: 전역 undo → '내 변경만'. 단일사용자 UX 회귀 검증.
- **서버 LWW PUT 잔존**: provider 후에도 남으면 CRDT를 덮어씀 → 강등/제거.

## 열린 질문 (검토 요청)

1. 협업 단위를 문서 전체 Y.Doc로 vs `tasks/links/categories` 하위구조만 CRDT로(view/paper는 별도)?
2. cascade/withSchedule 결과를 전적으로 로컬 계산으로 두는 원칙에 동의?
3. 멀티시트: 모두 Y.Doc 상주 vs 시트별 서브도큐먼트 중?
4. undo를 `Y.UndoManager`('내 변경만')로 바꿔도 단일사용자 UX 괜찮은지?
5. 서버 영속: y-leveldb vs 주기적 `Y.encodeStateAsUpdate` 스냅샷?
6. Loro로 갈 만큼 성능/API 이점이 큰지, 아니면 Yjs가 확실한지?

## 수용 기준

- [ ] 0~1단계 후 `build`(tsc --noEmit + vite) / `smoke.ts` / `mount-test.ts` 전부 통과.
- [ ] 렌더 레이어(`project` 셀렉터 컴포넌트) 코드 변경 없이 동작(Y.Doc→zustand 평면 push 어댑터).
- [ ] 두 클라이언트가 서로 다른 Task 동시 이동 시 둘 다 보존, 같은 필드만 결정적 수렴.
- [ ] cascade/withSchedule 결과가 CRDT에 기록되지 않음(권위=사용자 입력값만).
- [ ] 오프라인(단일 HTML/file://)에서 provider 없이 y-indexeddb만으로 편집·영속 정상.
- [ ] 기존 `.json` 저장/불러오기 무손실(평면↔Y.Doc 왕복), 서버 PUT 관계 정리(강등/read-only).
- [ ] undo/redo가 `Y.UndoManager` 대체 후에도 단일사용자 UX 회귀 없음.

---
*이 이슈는 코드 분석 기반으로 자동 초안 작성됨(전문가 피드백 ⑦⑧ 반영). 검토 후 코멘트 부탁드립니다.*
