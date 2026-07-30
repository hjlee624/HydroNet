# HydroNet 팀 협업(CRDT) 전환 계획

> 2026-07-30. 여러 작업자가 사내 LAN에서 마일스톤 공정표를 **실시간 공동 편집**하도록 CRDT·DB·프론트 개조. 온프레미스·오프라인·자체호스팅 최우선.
> 근거: 다중 에이전트 웹 리서치 + 코드베이스 매핑 + 적대적 검증(자세한 종합은 루트 `REPORT_HydroNet_CRDT-collab_2026-07-30.html`).

## 총평
HydroNet은 이미 CRDT 전환에 유리한 골격을 갖췄다: (1) 모든 쓰기가 store.ts의 단일 commit() 관문을 통과하고, (2) CPM 계산(computeSchedule/applyCascade/reschedule)이 순수 함수로 입력값과 완전히 분리돼 있으며 어디에도 파생값(es/ef/critical)을 진실로 저장하지 않는다. 따라서 전환의 본질은 "전체-스냅샷 파이프라인(commit·past/future·전체 PUT)을 요소 단위 op로 바꾸는 것"이며, 렌더 레이어(SVG·zustand 셀렉터)는 그대로 두는 것이 목표다.

권고 스택은 온프레·오프라인·자체호스팅·단일 HTML(file://)·Electron 상성을 최우선으로 하여 Yjs로 확정한다. Yjs는 순수 JS·gzip ~18-20KB·WASM 없음이라 vite-plugin-singlefile 단일 HTML에 인라인 가능하고, y-indexeddb만으로 provider 없이 오프라인 영속이 되며, MIT 라이선스에 Hocuspocus(onAuthenticate·SQLite/DB 영속) 자체호스팅 서버와 Y.UndoManager가 이미 검증된 조각으로 존재한다. Automerge 2.x(WASM 604KB, parse 1.8s, offline 병합 OOM 이력)와 Loro(WASM 399KB)는 배포 형태 때문에 탈락하되, Loro는 tasks row/parentId 재정렬 정확성이 실측 병목으로 판명될 때만 2순위 승격한다(MovableList·Movable Tree가 도메인에 1:1).

두 개의 진짜 함정: (A) Task.row 재정렬·parentId 세부공정 재부모화가 Yjs의 'move 부재' 직격 지점 → Y.Array 인덱스 순서 대신 fractional-index 소수 정렬키 + Y.Map LWW로 모델링(delete+insert 금지). (B) 멀티시트의 '활성 시트만 최상위 + swap' 구조는 CRDT 궁합이 나쁨 → 전 시트를 Y.Doc에 상주시키고 활성 시트는 로컬 뷰 포인터로만 관리.

로드아웃은 무인증→인증, 파일→DB, 단일→협업을 점진적으로: 0(경계 명문화, 이미 완료)→1(로컬 Y.Doc화+y-indexeddb, provider 없음)→2(Y.UndoManager)→3(Hocuspocus 서버 동기+인증)→4(awareness 프레즌스)→5(배포·호환 마감, LWW PUT 제거). 각 단계는 기존 검증 게이트(build=tsc+vite, smoke.ts 엔진, mount-test.ts 빈화면 회귀)를 통과해야 하며, 운영 폴더(포트 4000)는 절대 건드리지 않고 dev(4020)에서만 검증한다.

## 권장 스택
| 항목 | 선택 |
|---|---|
| **CRDT** | Yjs (yjs 13.6.x, 순수 JS·gzip ~18-20KB·WASM 없음). tasks/links/categories/rainySeasons/sheets = Y.Array&lt;Y.Map&gt;, meta/view/paper/branding = Y.Map, palette/mirrorHidden = Y.Array. Task.row·Category.order는 fractional-index 소수 정렬키, parentId는 LWW 값 필드로 move 우회. |
| **전송(Transport)** | 온라인 LAN 모드에서만 부착하는 WebSocket provider(HocuspocusProvider, room=projectId). 오프라인 단일 HTML(file://)·서버 다운 시엔 provider 미부착 → y-indexeddb 로컬 영속만으로 완결. 프레즌스는 y-protocols awareness. |
| **서버(Server)** | Hocuspocus(@hocuspocus/server, MIT). 기존 server/src/index.js의 http.createServer(app) 하나에 부착(추가 포트 없이 4020 유지, 운영 4000 금지). onAuthenticate 훅으로 인증·readOnly 역할. 순수 Node라 Node 24 LTS·Electron 패키징과 호환. |
| **영속/DB** | 서버: @hocuspocus/extension-database(SQLite/Postgres BLOB) 또는 y-leveldb(MIT, 임베디드, 외부서비스 0). room별 Y.Doc append-log+주기 encodeStateAsUpdate 스냅샷, 임계치 시 재인코딩으로 GC. 클라: y-indexeddb(오프라인 영속, 자동 병합). .json은 스냅샷/백업·레거시 로드용으로 병존. |
| **인증(Auth)** | 현재 무인증 0.0.0.0을 하드닝. 최소침습 경로: Caddy forward_auth(또는 nginx auth_request) 리버스프록시로 인증 게이트를 앱 밖에 두고 Express를 127.0.0.1 바인딩(프록시 우회 헤더 스푸핑 차단). CRDT 소켓 인증은 Hocuspocus onAuthenticate 단일 지점. 사내 IdP 없으면 독립 Express auth-server(JWT httpOnly 쿠키). WebSocket 토큰은 쿼리스트링 대신 쿠키/Sec-WebSocket-Protocol 헤더. |
| **프레즌스** | y-protocols Awareness — user{name,color}·selection{selectedTaskIds,selectedCategoryIds,selectedLinkId} 필드 브로드캐스트. 기존 zustand selection state 재사용, SVG에 원격 커서·선택 하이라이트 직접 렌더. 재연결 시 clear로 유령 커서 방지(Y.Doc 비저장 휘발 상태라 권위/파생 경계와 무관). |
| **배포(Deployment)** | 세 배포 형태 공존: (1) 오프라인 단일 HTML(vite-plugin-singlefile, provider 미부착·y-indexeddb만), (2) LAN 서버(Express+Hocuspocus 4020, extension-database 영속), (3) Electron(순수 JS라 무마찰). Node 24.x LTS 강제·Biome·Vite 7 유지. 오프라인/온라인은 provider 부착 여부로만 분기. |

**근거**: 결정 변수는 성능이 아니라 '배포 제약'이다. HydroNet 최우선 제약(온프레 LAN·오프라인 단일HTML/file://·Electron·무인증→인증 하드닝)에 Yjs만 무마찰로 맞는다: 순수 JS라 단일 HTML 인라인·CSP·WASM 로드 문제 없음, y-indexeddb로 provider 없는 오프라인 영속, MIT 라이선스에 Hocuspocus·Y.UndoManager·awareness가 검증된 기성 조각으로 존재. commit() 단일 쓰기 관문 + CPM 순수 분리라는 코드 구조가 origin 태깅·파생 격리에 교과서적으로 맞아 통합 리스크가 최소다. 문서 규모(수백~수천 tasks)에선 성능이 병목이 아니므로 Loro/Automerge의 성능·이력 우위는 배포 부담을 정당화하지 못한다.

### 대안 (조건부)
- **Loro (MovableList + Movable Tree, MIT, 1.x)** — tasks row 재정렬·parentId 세부공정 계층의 동시 이동에서 중복/유실이 mount-test류 회귀로 '실측' 병목으로 드러날 때만 2순위 승격. native movable list/tree가 도메인에 1:1이나 WASM 번들(gzip ~399KB)이 단일 HTML 배포 부담이라 실측 후 결정.
- **Automerge 3.x + automerge-repo** — 공정표 '변경 이력'이 제품 기능이 될 때만(베이스라인/개정본 감사추적·시점 열람·되돌리기 로그). 반드시 2.x 아닌 3.x(2025-08, offline 병합 OOM·700MB→1.3MB 수정) 인용. zustand 단일 스토어를 불변 스냅샷 모델로 리라이트하는 비용·WASM 부담이 커 기본 스택으론 비권장.
- **y-sweet (Rust 단일 바이너리, MIT)** — Node 프로세스와 분리된 전송 서버를 원하거나 문서(projectId)별 클라이언트 토큰 접근제어를 자연스럽게 붙이고 싶을 때 Hocuspocus 대안. 단 서버 자체 auth 문서가 얕아 앱 서버가 토큰 게이트를 책임지는 구조.
- **순정 y-websocket-server / PartyKit / Liveblocks / y-redis(yhub)** — 권장하지 않음. 순정 y-websocket은 무인증·재시작 시 소실(현 감사 지적 재현), PartyKit은 Cloudflare 런타임 하드종속(폐쇄망 불가), Liveblocks는 프로덕션 자체호스팅 미지원·AGPL, yhub는 Redis 필수·AGPL/상용 이중 라이선스(사내 상용 배포 충돌). 사내 LAN 소수 PC 규모엔 수평 확장 불필요.

## 문서
- [아키텍처 & 도메인 모델](00-architecture-and-model.md)
- [P0. 경계 명문화 (비파괴) — 이미 반영됨](P0-boundary.md) — 완료 (0.5인일, 이미 반영)
- [P1. 로컬 데이터모델 CRDT화 (provider 없음) + y-indexeddb](P1-local-crdt.md) — 높음 (8-12인일)
- [P2. Undo/Redo → Y.UndoManager](P2-undo.md) — 중간 (3-5인일)
- [P3. 서버 동기 (Hocuspocus) + 인증 하드닝 + PUT 강등](P3-server-auth.md) — 높음 (10-15인일)
- [P4. 프레즌스 (Awareness) — 원격 커서·선택](P4-presence.md) — 중간 (3-5인일)
- [P5. 배포·호환 마감 — .json↔Y.Doc 무손실, LWW PUT 제거](P5-deploy-compat.md) — 중간 (5-8인일)
- [마이그레이션 & 로드아웃](migration-rollout.md)
- [리스크 · 열린 결정 · 참고자료](risks-and-decisions.md)

## 단계 요약
- **P0 경계 명문화 (비파괴) — 이미 반영됨** — CRDT의 최대 함정(파생 계산값을 협업 상태에 써 사용자끼리 덮어쓰기)을 문서로 못 박아 이후 어떤 CRDT를 붙여도 안전한 토대를 확정한다.
- **P1 로컬 데이터모델 CRDT화 (provider 없음) + y-indexeddb** — project를 Y.Doc로 보유하고 commit을 doc.transact로 바꾸되, 렌더 레이어 코드 무변경으로 단일 사용자 동작을 100% 보존한다. 아직 네트워크 없음.
- **P2 Undo/Redo → Y.UndoManager** — past/future 전체-스냅샷 스택을 Y.UndoManager로 대체하되 단일 사용자 undo UX를 회귀 없이 보존한다.
- **P3 서버 동기 (Hocuspocus) + 인증 하드닝 + PUT 강등** — 사내 LAN에서 여러 PC가 같은 projectId를 실시간 동시 편집하고, 무인증 감사 지적을 인증으로 해소하며, LWW 전체-파일 PUT이 CRDT를 덮어쓰지 못하게 한다.
- **P4 프레즌스 (Awareness) — 원격 커서·선택** — 누가 무엇을 보고 편집 중인지 실시간 표시해 협업 인지도를 높인다. Y.Doc 비저장 휘발 상태라 권위/파생 경계와 무관.
- **P5 배포·호환 마감 — .json↔Y.Doc 무손실, LWW PUT 제거** — 기존 .json 저장/불러오기를 무손실로 유지하면서 CRDT를 정식 진실원본으로 확정하고, 세 배포 형태(단일HTML·LAN서버·Electron)를 안정화한다.
