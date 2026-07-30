# 리스크 · 열린 결정 · 참고자료

## 리스크와 완화
1. **파생 스케줄값(es/ef/critical/cascade가 민 start)이 실수로 Y.Doc에 기록되어 사용자끼리 서로 덮어쓰며 진동한다**
   - 완화: 권위=사용자 입력값만 트랜잭션에 기록. CPM은 SCHEDULE_ORIGIN(비추적) 또는 로컬 파생으로만 재적용. forceCritical·사용자 드래그 start만 권위. P0 경계 문서를 코드 리뷰 게이트로 강제하고 '파생값이 CRDT에 없음'을 P3 수용기준에 명시.
2. **Task.row 재정렬·parentId 세부공정 재부모화를 Y.Array 인덱스/delete+insert로 처리하면 동시 이동 시 공정 중복·인터리빙·편집 유실**
   - 완화: row/order를 fractional-index 소수 정렬키로, parentId를 LWW 값 필드로 모델링('이동=단일 필드 갱신'). moveTaskToRow의 densely renumber를 이웃 중점값 계산으로 재작성. 실측 병목이면 Loro MovableList/Movable Tree로 2순위 승격 검토.
3. **zustand↔Yjs 무한루프: 로컬변경→Yjs쓰기→observe→store 되쓰기→다시 Yjs쓰기**
   - 완화: origin 태깅(LOCAL_ORIGIN=객체 identity, 문자열 금지). observeDeep에서 origin===LOCAL_ORIGIN이면 되쓰기 skip. Y.Doc을 진실원본, zustand는 단방향 파생 뷰로.
4. **중첩 컨테이너 덮어쓰기: 두 클라가 같은 map key에 각각 new Y.Array를 set하면 병합 아니라 한쪽 소멸**
   - 완화: 컨테이너는 부트스트랩에서 정확히 1회만 생성(getArray/getMap 멱등 + 존재체크 guard). 모든 클라는 get()으로 기존 배열을 가져와 push.
5. **멀티시트의 '활성 시트만 최상위 + switchSheet swap' 구조가 CRDT와 궁합 나쁨(swap이 대규모 덮어쓰기)**
   - 완화: 전 시트를 sheets: Y.Array&lt;Y.Map&gt; 상주로 전환, '활성 시트'는 Y.Doc 상태 아닌 로컬 뷰 포인터(zustand)로만. 사용자마다 다른 시트를 봐도 충돌 없음.
6. **무인증 0.0.0.0 Express — 프록시 우회 헤더 스푸핑·CRDT 소켓 무인증 노출**
   - 완화: Express를 127.0.0.1 바인딩하고 프록시만 0.0.0.0 노출(forward-auth). CRDT는 Hocuspocus onAuthenticate 단일 관문. WebSocket 토큰은 쿼리스트링 대신 쿠키/Sec-WebSocket-Protocol.
7. **단일 HTML(file://)/Electron에서 WASM·번들 부담**
   - 완화: 순수 JS Yjs 채택(WASM 없음, gzip ~18KB 인라인 가능). 오프라인은 provider 미부착+y-indexeddb만. Automerge/Loro의 WASM는 단일 HTML엔 부적합이라 배제. build:single·check-single로 회귀.
8. **서버 영속 용량 팽창(mergeUpdates는 삭제분 GC 안 함) 및 버전 히스토리 gc=false로 무한 증가**
   - 완화: 압축 2단계: append-log + 임계치 시 Y.Doc 로드→encodeStateAsUpdate 재인코딩(진짜 GC). 마일스톤 규모는 gc=true 기본으로 안정. 베이스라인은 '버전마다 전체 스냅샷 복사본' 저장으로 gc 관리 회피.
9. **undo 시맨틱 변화(전역→내 변경만)로 단일 사용자 UX 회귀**
   - 완화: trackedOrigins={LOCAL_ORIGIN}로 '내 변경만' 격리하되 단일 사용자에선 기존과 무차별함을 mount-test류 회귀로 검증. captureTimeout·stopCapturing으로 제스처 병합 경계 재현.
10. **동시 편집으로 링크 그래프에 사이클 발생 → CPM이 비결정적/무한루프. acyclic은 로컬 검증 불가한 전역 불변식**
   - 완화: computeSchedule이 사이클을 방어적으로 처리(가지치기·warnings). 재계산 함수 레벨에서 순수·결정적 보장. 수렴은 되나 recency 아님(stale CPM 잠깐 표시, 최종 일치)을 UX로 수용.
11. **운영 폴더(포트 4000, main)를 실수로 건드려 전무님 서버 중단**
   - 완화: 모든 개발·검증은 dev 폴더·포트 4020(또는 4000 외)에서만. 본인이 띄운 PID만 종료. 절대 규칙으로 CLAUDE.md에 명시됨.
12. **에어갭 사내망에서 npm 레지스트리 접근 불가로 의존성 반입 실패**
   - 완화: node_modules 벤더링 또는 Verdaccio 미러로 의존성 사전 반입. LAN 내부는 ws:// 또는 자체서명 인증서.

## 착수 전 확인 필요 (Open Decisions)
- 협업 단위: 문서 전체를 하나의 Y.Doc으로 vs tasks/links/categories만 CRDT로 하고 view/paper/branding은 별도 세밀도(또는 로컬)로? (초기 권고: 단일 Y.Doc, view/paper는 LWW로 함께 — 단 collapsed 등 순수 UI 상태는 로컬 뷰로 뺄지 결정 필요)
- 멀티시트 상주 방식: 전 시트를 단일 Y.Doc에 상주 vs 시트별 Y.Subdocument로 지연로드? (대형 사업 규모·시트 수에 따라. 초기 권고: 단일 Y.Doc 상주)
- 서버 영속 백엔드: Hocuspocus extension-database(SQLite/Postgres, SQL 조회 가능) vs y-leveldb(임베디드·설치 0)? (SQL로 프로젝트 목록·감사 로그 조회 필요성이 실제 있는지)
- 인증 방식: 리버스프록시 forward-auth(사내 IdP/SSO 있을 때) vs 독립 Express auth-server(JWT 쿠키) vs 앱 내장 세션? 사내에 Keycloak/Authelia 등 IdP가 있는지 확인 필요
- 역할 모델: '전무님=쓰기, 현장 PC=읽기' 같은 문서별 RBAC/readOnly가 실제 필요한지, 아니면 LAN 내 전원 편집 가능으로 충분한지
- 변경 이력이 '제품 기능'인지: 공정표 베이스라인/개정본 감사추적·시점 열람이 요구사항이면 Automerge 3.x 재검토 트리거. 아니면 Yjs '버전 스냅샷 복사본'으로 충분
- Loro 승격 조건 수치화: '동시 이동 시나리오에서 중복/유실이 mount-test 회귀로 재현되는가'를 실제 벤치로 확인해 Yjs fractional-index로 충분한지 판정
- 오프라인 클라의 readOnly 처리: readOnly 사용자의 로컬 y-indexeddb 미수락 변경을 서버본으로 교체하는 정책(오프라인-퍼스트와 충돌 지점)을 어떻게 UX 설계할지
- collapsed·activeSheet·selection 등 '로컬 뷰 상태'를 어디까지 동기화에서 제외할지 확정(사용자마다 다른 뷰 허용 범위)
- 에어갭 배포 확정: 사내망이 npm 레지스트리·외부에 닿는지, node_modules 벤더링/Verdaccio 미러가 필요한지

## 참고 자료 (Citations)
- [dmonad/crdt-benchmarks — CRDT 공식 벤치(파스타임·번들·문서크기)](https://github.com/dmonad/crdt-benchmarks)
- [Yjs Docs — Offline Support (y-indexeddb, provider 없는 오프라인 영속)](https://docs.yjs.dev/getting-started/allowing-offline-editing)
- [B. Sypytkowski — Replacing Yjs move feature (fractional indexing)](https://www.bartoszsypytkowski.com/replacing-yjs-move-feature/)
- [Loro Blog — Movable tree CRDTs (동시 재부모화·사이클 해소)](https://loro.dev/blog/movable-tree)
- [loro-crdt (npm) — 1.x 성숙도·UndoManager·Ephemeral](https://www.npmjs.com/package/loro-crdt)
- [Automerge — Automerge Repo 2.0 (배터리 포함·자체호스팅 sync)](https://automerge.org/blog/automerge-repo-2/)
- [Automerge 3.0 — offline 병합 OOM 수정(700MB→1.3MB)](https://automerge.org/blog/automerge-3/)
- [Yjs Docs — Y.UndoManager (trackedOrigins/captureTimeout)](https://docs.yjs.dev/api/undo-manager)
- [yjs/y-websocket-server (LAN 바인딩·룸·미니멀 서버)](https://github.com/yjs/y-websocket-server)
- [Hocuspocus 공식 — Server Examples (SQLite 즉시 기동, 인터넷 불필요)](https://tiptap.dev/docs/hocuspocus/server/examples)
- [ueberdosis/hocuspocus (MIT, crossws, onAuthenticate)](https://github.com/ueberdosis/hocuspocus)
- [Hocuspocus Authentication (onAuthenticate·readOnly RBAC)](https://tiptap.dev/docs/hocuspocus/guides/authentication)
- [jamsocket/y-sweet (Rust 단일 프로세스·로컬 영속·클라 토큰)](https://github.com/jamsocket/y-sweet)
- [PartyKit — How PartyKit works (Cloudflare Durable Object 종속)](https://docs.partykit.io/how-partykit-works/)
- [Liveblocks — Open sourcing the sync engine & dev server (AGPL·프로덕션 자체호스팅 미지원)](https://liveblocks.io/blog/open-sourcing-the-liveblocks-sync-engine-and-dev-server)
- [automerge-repo-sync-server README (무인증 데모·오프라인 재연결)](https://github.com/automerge/automerge-repo-sync-server/blob/main/README.md)
- [Yjs Docs — Document Updates (encodeStateAsUpdate/mergeUpdates/diffUpdate)](https://docs.yjs.dev/api/document-updates)
- [yjs/y-indexeddb 소스 (PREFERRED_TRIM_SIZE=500 자동 병합)](https://github.com/yjs/y-indexeddb/blob/master/src/y-indexeddb.js)
- [yjs/y-leveldb (MIT·임베디드·storeUpdate/flushDocument/meta)](https://github.com/yjs/y-leveldb)
- [yjs/yhub (구 y-redis, AGPL/상용 이중 라이선스·Redis 필수)](https://github.com/yjs/yhub)
- [y-protocols README (Awareness 인코딩·API)](https://github.com/yjs/y-protocols/blob/master/README.md)
- [Caddy forward_auth (리버스프록시 인증 게이트)](https://caddyserver.com/docs/caddyfile/directives/forward_auth)
- [Kleppmann — Moving Elements in List CRDTs (PaPoC 2020)](https://martin.kleppmann.com/papers/list-move-papoc20.pdf)
- [Yjs vs Automerge vs Loro: CRDT Libraries 2026 (PkgPulse, B4 기반)](https://www.pkgpulse.com/guides/yjs-vs-automerge-vs-loro-crdt-libraries-2026)
- [Yjs Docs — y-websocket provider (단일포트 Express+영속)](https://docs.yjs.dev/ecosystem/connection-provider/y-websocket)
- [Yjs Community — Determining whether a transaction is local (origin 판별)](https://discuss.yjs.dev/t/determining-whether-a-transaction-is-local/361)
- [Yjs GitHub #483 — nested array in map 덮어쓰기 함정](https://github.com/yjs/yjs/issues/483)
- [Automerge Repo Storage — 청크/스냅샷/증분 compaction](https://automerge.org/docs/reference/under-the-hood/storage/)
- [Loro — Export Mode (shallow snapshot, 히스토리 절단)](https://www.loro.dev/docs/tutorial/encoding)

---
[← 계획 인덱스](README.md)
