# 리스크 · 열린 결정 · 참고자료

## 리스크와 완화
1. **파생 스케줄값(es/ef/critical/cascade가 민 start)이 실수로 Y.Doc에 기록되어 사용자끼리 서로 덮어쓰며 진동한다**
   - 완화: 권위=사용자 입력값만 트랜잭션에 기록. CPM은 SCHEDULE_ORIGIN(비추적) 또는 로컬 파생으로만 재적용. forceCritical·사용자 드래그 start만 권위. P0 경계 문서를 코드 리뷰 게이트로 강제하고 '파생값이 CRDT에 없음'을 P3 수용기준에 명시.
2. **공정·공종 재정렬을 배열 인덱스/delete+insert로 처리하면 동시 이동 시 중복·인터리빙·편집 유실**
   - 완화: id 기반 `Y.Map<id, Y.Map>`과 `$position` fractional 정렬키를 사용해 이동을 레코드 필드 갱신으로 표현한다. 이웃 사이 공간이 소진될 때만 bounded rebalance한다. 실측 병목이면 Loro MovableList/Movable Tree로 2순위 승격 검토.
3. **zustand↔Yjs 무한루프: 로컬변경→Yjs쓰기→observe→store 되쓰기→다시 Yjs쓰기**
   - 완화: origin 태깅(LOCAL_ORIGIN=객체 identity, 문자열 금지). observeDeep에서 origin===LOCAL_ORIGIN이면 되쓰기 skip. Y.Doc을 진실원본, zustand는 단방향 파생 뷰로.
4. **중첩 컨테이너 덮어쓰기: 두 클라가 같은 map key에 각각 새 Y type을 set하면 병합이 아니라 한쪽이 소멸**
   - 완화: `root/meta`, `root/tasks` 같은 top-level named Y type을 사용하고 root에는 안정된 문자열 참조만 둔다. IndexedDB/server update를 먼저 적용한 뒤 빈 문서만 시드한다.
5. **멀티시트의 '활성 시트만 최상위 + switchSheet swap' 구조가 CRDT와 궁합 나쁨(swap이 대규모 덮어쓰기)**
   - 완화: 전 시트를 `root/sheets`의 id 기반 map에 상주시키고, '활성 시트'는 Y.Doc 상태가 아닌 로컬 뷰 포인터로 둔다. 사용자마다 다른 시트를 봐도 공유 문서를 다시 쓰지 않는다.
6. **0.0.0.0 LAN 서버의 인증 우회·CRDT 소켓 노출**
   - 완화: Hocuspocus `onAuthenticate`에서 5분 `collab` ticket만 허용하고 사용자·프로젝트·현재 멤버십을 매번 다시 조회한다. 12시간 project grant의 WebSocket 직접 사용과 `?token=` 전달은 금지한다. handshake는 명시 allowlist 또는 같은 host의 private-LAN Origin만 허용한다. Origin 검사는 TLS 대체물이 아니므로 운영 reverse proxy에서 WSS+내부 CA를 적용한다. → [ADR-001](ADR-001-vite8-and-db-auth.md)
7. **단일 HTML(file://)/Electron에서 WASM·번들 부담**
   - 완화: 순수 JS Yjs 채택(WASM 없음, gzip ~18KB 인라인 가능). 오프라인은 provider 미부착+y-indexeddb만. Automerge/Loro의 WASM는 단일 HTML엔 부적합이라 배제. build:single·check-single로 회귀.
8. **서버 Y.Doc binary 용량 증가와 손상**
   - 완화: 현재는 Hocuspocus Database extension의 전체 state binary를 파일 또는 PostgreSQL에 저장한다. 파일은 임시 파일+rename, 최초 seed는 lock으로 원자화한다. 장기 용량·스냅샷 보존 주기는 운영 데이터 계측 후 정하고, 베이스라인은 별도 전체 스냅샷으로 보관한다.
9. **undo 시맨틱 변화(전역→내 변경만)로 단일 사용자 UX 회귀**
   - 완화: trackedOrigins={LOCAL_ORIGIN}로 '내 변경만' 격리하되 단일 사용자에선 기존과 무차별함을 mount-test류 회귀로 검증. captureTimeout·stopCapturing으로 제스처 병합 경계 재현.
10. **동시 편집으로 링크 그래프에 사이클 발생 → CPM이 비결정적/무한루프. acyclic은 로컬 검증 불가한 전역 불변식**
   - 완화: computeSchedule이 사이클을 방어적으로 처리(가지치기·warnings). 재계산 함수 레벨에서 순수·결정적 보장. 수렴은 되나 recency 아님(stale CPM 잠깐 표시, 최종 일치)을 UX로 수용.
11. **운영 폴더(포트 4000, main)를 실수로 건드려 전무님 서버 중단**
   - 완화: 모든 개발·검증은 dev 폴더·포트 4020(또는 4000 외)에서만. 본인이 띄운 PID만 종료. 절대 규칙으로 CLAUDE.md에 명시됨.
12. **에어갭 사내망에서 npm 레지스트리 접근 불가로 의존성 반입 실패**
   - 완화: node_modules 벤더링 또는 Verdaccio 미러로 의존성을 사전 반입한다. 운영 WebSocket은 reverse proxy의 WSS와 배포된 내부 CA를 사용한다.

13. **전화번호 ID와 끝 4자리 초기비밀번호의 추측 가능성**
   - 완화: 비밀번호는 scrypt hash만 저장하고 로그인은 IP+canonical ID 기준 5회 실패 시 15분 제한한다. roster 재실행은 기존 hash를 보존하며 `--reset-passwords`에서만 초기값으로 되돌린다. 최초 로그인 강제 변경 정책은 후속 운영 요구로 남긴다.

14. **memory 인증 저장소를 운영 DB로 오인**
   - 완화: 기본값은 `server/data/auth.json`이며 PostgreSQL은 `AUTH_BACKEND=pg`와 `DATABASE_URL`이 모두 있을 때만 사용한다. roster 반영 뒤 memory는 디스크 재열기, PostgreSQL은 DB readback으로 reconciliation한다.

## 남은 운영 결정 (Open Decisions)
- 서버 영속 backend: 기본 memory/file을 유지할지, SQL 감사·백업 요구 때문에 PostgreSQL로 승격할지
- 인증 연동: 현재 로컬 JWT를 유지할지, 사내 IdP(Keycloak/Authelia)에 연결할지
- TLS: 내부 CA 발급·배포 주체와 reverse proxy 운영 담당
- 역할 모델: 현재 developer/PM/user 전원 편집 정책에 향후 readOnly 역할을 추가할지
- 변경 이력이 '제품 기능'인지: 공정표 베이스라인/개정본 감사추적·시점 열람이 요구사항이면 Automerge 3.x 재검토 트리거. 아니면 Yjs '버전 스냅샷 복사본'으로 충분
- Loro 승격 조건 수치화: '동시 이동 시나리오에서 중복/유실이 mount-test 회귀로 재현되는가'를 실제 벤치로 확인해 Yjs fractional-index로 충분한지 판정
- 오프라인 클라의 readOnly 처리: readOnly 사용자의 로컬 y-indexeddb 미수락 변경을 서버본으로 교체하는 정책(오프라인-퍼스트와 충돌 지점)을 어떻게 UX 설계할지
- collapsed·activeSheet·selection 등 '로컬 뷰 상태'를 어디까지 동기화에서 제외할지 확정(사용자마다 다른 뷰 허용 범위)
- 에어갭 배포 확정: 사내망이 npm 레지스트리·외부에 닿는지, node_modules 벤더링/Verdaccio 미러가 필요한지
- Electron 패키징이 실제 납품 요건인지. 현재는 단일 HTML과 LAN 서버만 구현되어 있다.
- Vite 8 전환 시점. 현재 Vite 7을 유지한다.

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
