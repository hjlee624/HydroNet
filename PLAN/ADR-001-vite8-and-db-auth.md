# ADR-001 — Vite 8 시점 · DB/인증(접속자 인증키) 정교화

> 2026-07-30. 사용자 질문("Vite 8이 적절하지 않나?" / "DB는 Supabase나 PostgreSQL은? 접속자 인증키로 아무나 못 붙게") 에 대한 리서치·검증 기반 결정. [PLAN 인덱스](README.md)의 기존 스택을 이 문서로 정교화한다.

## 결정 요약 (TL;DR)
- **Vite**: 지금은 **Vite 7 유지**, Vite 8(Rolldown)은 **검증 완료·대기** → CRDT 전환(P1~P5) 종료 후 **P5에서 별도 브랜치로 실측 채택**. CRDT 커밋과 절대 섞지 말 것.
- **DB**: **Supabase 배제(과설계)**. 기본 = **임베디드 y-leveldb / SQLite**(외부서비스 0·에어갭 최적). 순정 **PostgreSQL은 SQL 조회(프로젝트 목록·감사 로그) 실요구 시에만** 승격.
- **인증**: DB 종류와 무관하게 게이트는 **Hocuspocus `onAuthenticate` 단일 관문**. 접속자별 **jose RS256 서명 JWT** 발급 → onAuthenticate에서 로컬 검증. **RLS는 CRDT WebSocket을 못 막는다**(중요).

---

## 1. Vite 8 (Rolldown)
**권고**: 결론: 지금 당장은 Vite 7 유지, Vite 8은 '검증 후 조건부 채택'으로 대기 유지. 강제 이유가 없다. 단, 마이그레이션 리스크는 이미 낮음(설치된 vite-plugin-singlefile 2.3.3이 Vite 8 대응 완료판)이므로, P5 배포 마감 단계에서 별도 브랜치로 한 번 실측 후 넘어가는 것을 권장. 절대 CRDT 전환(P1~P5)과 Vite 8 이관을 한 커밋에 섞지 말 것.

**근거**: 코드베이스 실측 확인: client/node_modules/vite-plugin-singlefile=2.3.3(정확히 Vite 8의 inlineDynamicImports 폐기 경고를 고친 버전, issue #118 fix), vite=7.3.6, @vitejs/plugin-react ^5.2.0(Vite 8 호환), engines Node&gt;=24&lt;25(Vite 8의 Node 20.19+/22.12+ 요건 충족), 전 package.json type:module(Vite 8 ESM-only 충족). 즉 환경·플러그인은 이미 Vite 8 준비 완료. 그러나 (1) 현 Vite 7 단일 HTML 파이프라인이 정상 동작하고(HydroNet.html 20MB 산출 확인), (2) memory가 'Rolldown 검증 완료·대기'라 명시했으며, (3) HydroNet의 진짜 우선순위는 CRDT 협업 전환(P1~P5)이지 빌드 속도가 아니다. Vite 8의 이점(빌드 10-30x·dev/prod 동일 번들러)은 실질 가치가 있으나 HydroNet 규모에선 blocking이 아니다. 강제 요인 부재 → 대기가 정답. 채택 시점은 CRDT 전환이 끝나 회귀 표면이 안정된 P5 이후가 가장 안전.

**리스크**
- 단일 지점 리스크: vite.config.ts가 SINGLE=1에서 rollupOptions.output={format:'iife',inlineDynamicImports:true}를 하드코딩하는데, Vite 8에서 플러그인이 추가로 codeSplitting=false를 설정한다. 두 설정이 겹치는 이 지점이 유일한 회귀 위험. inlineDynamicImports는 Vite 8에서 deprecated(경고만, 빌드는 됨) → 장기적으로 rolldownOptions+codeSplitting:false로 리네임 필요. build-single.ts 60행의 'IIFE 아님' 하드 가드가 이 회귀를 정확히 잡아준다(안전망 존재).
- Lightning CSS 기본 최소화기 전환: build-single.ts가 KoPub @font-face url()을 base64로 재작성하는데, Lightning CSS 최소화 후 url() 인용/인코딩 형태가 바뀌면 매칭 실패 가능. 이관 시 KoPub 폰트 인라인이 깨지지 않는지 반드시 확인.
- 에어갭: Vite 8+Rolldown+Lightning CSS는 네이티브 바이너리(+약 15MB)를 동반. 폐쇄망 벤더링 node_modules에 win32-x64 바이너리가 포함돼야 함. 이는 resvg-js 2.6.2의 win32-x64-msvc 바이너리 벤더링 이슈와 동일 성격(Vite 버전 무관·독립).
- rolldown-vite는 experimental(패치 릴리스에서도 breaking 가능)이라 장기 pin 금지 — 검증 단계 용도로만 사용.

**마이그레이션 절차**: 2단계 저위험 경로(실측용 별도 브랜치, Gitea/GitHub 푸시 전 로컬 검증): (1) Vite 7 유지한 채 'vite'를 'rolldown-vite'로 드롭인 교체 → build+smoke+mount+build:single+check-single 전체 게이트 통과 확인(번들러 이슈를 Vite 8 API 변화와 분리). (2) vite@^8로 올리고 vite.config.ts의 rollupOptions.output을 build.rolldownOptions로 리네임+inlineDynamicImports 제거(codeSplitting:false로 대체) → 전체 게이트 재실행. 핵심 수용 기준: 생성된 HydroNet.html을 실제로 더블클릭(file://)해 열어 KoPub 폰트·엔진·렌더가 정상이고, check-single의 IIFE 가드가 통과하는지. 에어갭이면 vite@8·singlefile@2.3.3·Lightning CSS/Rolldown 네이티브 바이너리 정확한 tarball을 오프라인 npm 캐시에 사전 반입 후 이관. 절대 CRDT 커밋과 분리.

---

## 2. DB — Supabase vs PostgreSQL vs 임베디드
**권고**: 결론: Supabase 채택 금지(과설계). 순정 PostgreSQL도 '조회 필요성이 실제로 없으면' 굳이 도입하지 말고, 기본은 임베디드 y-leveldb(또는 Hocuspocus extension-database의 SQLite)로 Y.Doc를 파일 영속하라. 인증은 DB 종류와 무관하게 Hocuspocus onAuthenticate 단일 관문에서 로컬 서명 JWT(jose RS256)를 검증하는 방식으로 구현한다. Postgres는 '프로젝트 목록/감사 로그를 SQL로 조회할 실제 요구'가 확인될 때만 승격(그때도 인증 저장소로서가 아니라 Y.Doc BLOB+감사 테이블 용도).

**근거**: 검증 결과 핵심 두 가지가 확정됨: (1) Supabase 자체호스팅은 11-12개 컨테이너·유휴 1.5-4GB RAM·백업/업그레이드 자체부담·에어갭 비지원(공식 문서가 인터넷 전제, 12개 이미지 사설 레지스트리 미러 필요)로 '소수 PC 사내 LAN'엔 명백한 과설계다. (2) 결정적 미스매치: Supabase RLS와 Realtime 인가는 PostgREST SQL API와 Supabase Realtime 채널만 보호한다. HydroNet의 실제 실시간 편집은 별도 Hocuspocus WebSocket으로 흐르고 Supabase는 그 트래픽을 아예 보지 못한다 → RLS는 CRDT 스트림에 대해 보호력 0. 즉 감사 지적('아무나 접속')을 Supabase가 해결하지 못한다. 게다가 Postgres RLS도 동일하게 WS 인증을 대체 못 한다: Hocuspocus는 서버측 단일 공유 DB 풀 커넥션으로 persist하므로 DB 세션에 접속자별 신원이 없어 RLS가 필터할 대상이 없다. 따라서 인증 게이트는 반드시 onAuthenticate여야 하고, DB는 '무엇을 조회할 것인가'만으로 선택하면 된다. HydroNet은 외부 서비스 0·인터넷 불필요가 최우선이므로 임베디드 파일 영속(y-leveldb/SQLite)이 Postgres 서버 프로세스+백업 운영보다 에어갭에 훨씬 가볍다.

**Supabase vs Postgres 비교**: Supabase(자체호스팅 스택): GoTrue(현 Auth)가 SMTP 없이 관리자 사용자 생성(email_confirm:true)·admin generate_link로 토큰 직접 반환·오프라인 JWT 검증(RS256)이 되어 '접속자별 인증키 발급' 요구엔 기능적으로 잘 맞고 라이선스도 전부 무료(Apache-2.0/MIT/PostgreSQL, SSO/HIPAA/SOC2만 유료·불요). 그러나 (i) 에어갭 out-of-the-box 아님(12개 이미지 미러·analytics/vector 컨테이너 제외 필요), (ii) 유휴 1.5-4GB·Kong 단독 2GB+·백업 미내장·단일 프로젝트 제약, (iii) 무엇보다 RLS/Realtime 인가가 CRDT WebSocket을 보호하지 못해 감사 지적을 못 푼다. 즉 HydroNet이 Supabase에서 실제로 쓸 건 GoTrue의 토큰 발급(유휴 &lt;10MB)뿐이고 나머지(PostgREST/Realtime/Storage/Studio/Kong/imgproxy/Supavisor)는 전부 미사용 무게. 순정 Postgres+커스텀 JWT: 필요한 것만(Y.Doc BLOB 테이블 + users/keys 테이블 + jose 로컬 서명)으로 최소화, 인터넷 0, 벤더링은 pg·jose·@hocuspocus/* yjs만. 다만 Postgres 서버 프로세스·역할/확장 셋업·백업을 자체 운영해야 하므로, SQL 조회 요구가 없다면 이조차 과하다. 온프레·에어갭·소규모·오프라인 우선 관점의 서열: (1순위) y-leveldb 또는 SQLite 임베디드 영속 + 로컬 JWT(jose) onAuthenticate, (2순위) 순정 Postgres+커스텀 JWT(SQL 감사/목록 조회가 실제 요구일 때), (3순위·비권장) Supabase 풀스택. GoTrue만 cherry-pick(GoTrue+Postgres)도 이론상 가능하나 여전히 Postgres 필수·스키마 마이그레이션 부담이 있어 '경량'이라는 인상보다 무겁다.

**대안 서열**
- **y-leveldb / SQLite 임베디드 영속 + jose RS256 로컬 JWT를 onAuthenticate에서 검증** — 기본 권장. SQL 조회 요구가 확인되지 않은 현 단계. 외부 서비스 0·인터넷 0·벤더링 최소·백업은 파일 복사로 끝. 에어갭·소규모·오프라인 우선에 최적.
- **순정 PostgreSQL(ydocs BYTEA + users/keys) + 커스텀 jose JWT** — 프로젝트 목록·감사 로그·사용자 관리를 SQL로 조회할 실제 요구가 생겼을 때. 인증은 여전히 onAuthenticate(RLS 아님). 서버 프로세스·백업 운영을 감수.
- **검증된 OSS 인증 컴포넌트(PocketBase 단일 바이너리 또는 SuperTokens) 도입** — '자작 auth 금지' 원칙을 지키되 GoTrue 풀스택은 피하고 싶을 때. PocketBase는 단일 바이너리(auth+DB+파일)로 에어갭에 가볍고, 발급 토큰을 onAuthenticate가 로컬 검증. 관리 UI/사용자 CRUD가 필요하면 순수 jose 자작보다 안전.
- **Supabase 풀 자체호스팅 (또는 GoTrue+Postgres cherry-pick)** — 이미 사내에 Supabase 표준이 있거나 GoTrue의 사용자/토큰 관리 UI가 강하게 필요할 때만. HydroNet 단독 요구로는 비권장(과설계·RLS가 CRDT 보호 못 함·에어갭 미러 부담).

---

## 3. 접속자 인증키 흐름 (per-user key)
> ⚠️ 이 절은 기존 `P3-server-auth.md`의 "WebSocket 토큰은 쿠키/서브프로토콜" 표현을 **정정**한다(브라우저 WebSocket은 커스텀 헤더 불가·httpOnly 쿠키 JS 접근 불가).

에어갭 완결 플로우(외부 IdP·JWKS 네트워크 fetch 없음): (1) 발급: 소형 auth-server가 jose로 RS256 키쌍 1회 생성, private key는 auth-server에만 보관. 관리자가 접속자별로 사용자 생성 후 서명 JWT(iss/aud/exp/nbf, role: writer|viewer, jti) 발급. (2) 클라 전달: 장기 세션은 httpOnly+Secure+SameSite=Strict 쿠키로 브라우저에 저장. ※ 중요 정정: 브라우저 WebSocket은 커스텀 핸드셰이크 헤더를 못 넣고 httpOnly 쿠키는 JS가 못 읽으므로, PLAN/P3의 'WebSocket 토큰은 쿠키/서브프로토콜'은 부정확하다. 실제 경로는 두 가지: (경로A·권장) 클라가 쿠키 인증된 same-origin HTTP 엔드포인트를 호출해 단수명 collab 티켓을 받고, 그 티켓을 HocuspocusProvider의 token 옵션(async 함수)으로 넘긴다. Hocuspocus는 연결 직후 이 토큰을 in-band 인증 '메시지'로 전송하고, 그전 모든 메시지는 onAuthenticate resolve까지 서버가 버퍼링(미인증 클라의 메모리 고갈 방어). (경로B) HTTP upgrade 핸들러에서 쿠키를 직접 검증해 게이트. 쿼리스트링 ?token= 은 서버 로그 유출·CSWH 노출로 금지. (3) 검증: onAuthenticate({token,...})에서 jwtVerify(token, publicKey, {issuer,audience}), alg는 ['RS256']로 고정(jose는 'none' 기본 거부), exp/nbf 확인, users/keys 조회(+jti 폐기목록). throw하면 연결 종료 → 무자격 차단. 반환 user객체{userId,role}는 onStoreDocument context로 흘러 감사 기록에 사용. (4) readOnly 역할: viewer면 onAuthenticate 안에서 data.connection.readOnly=true 설정 → 문서와 업데이트는 읽되 적용 불가. 역할은 DB의 role 필드에서 구동. (5) 만료·회전: provider token을 async 함수로 두어 재연결마다 새 티켓 재발급(reconnect 재인증 누락 버그 #566 회피). 세션 중 폐기/만료는 서버 beforeHandleMessage에서 재검사해 만료 시 연결 종료. LAN에서도 wss(자체서명 CA/내부 TLS) 사용 — Secure 쿠키는 HTTPS에서만 전송되므로 내부 TLS 필수, Origin 헤더도 검증.

## 4. 아키텍처 (영속 + 인증)
(a) Y.Doc 영속: room=projectId=documentName. @hocuspocus/extension-database의 fetch({documentName})=&gt;Uint8Array|null / store({documentName,state})=&gt;void 두 함수만 구현. 저장한 바이너리를 그대로 반환(fetch에서 새 Y.Doc 재생성 절대 금지 — 중복/히스토리 발산). Postgres를 쓴다면 테이블 ydocs(name TEXT PRIMARY KEY, data BYTEA, updated_at TIMESTAMPTZ), store는 ON CONFLICT DO UPDATE 업서트, fetch는 row.data(Buffer=Uint8Array 하위형이라 그대로 통과). y-leveldb/SQLite면 서버 프로세스 없이 파일 임베디드. onStoreDocument은 디바운스(v4 기본 2000ms, maxDebounce 10000ms)로 자동 호출, Server.destroy()가 종료 시 미완 store를 flush(→ '서버 재시작 후 문서 복원' 검증 충족). (b) 사용자·인증키: 인증 저장소는 Y.Doc 영속 DB와 분리 가능. 소규모면 별도 users/keys 테이블(또는 서버 메모리/작은 파일) + 로컬 서명 JWT면 충분. onAuthenticate가 이 저장소를 조회해 검증·역할 부여. Postgres를 이미 세운다면 같은 인스턴스의 users 테이블에 얹어도 되지만, RLS가 아니라 앱 로직(onAuthenticate)이 게이트임을 명심.

---

## 5. PLAN 정정·갱신 항목
- PLAN/README.md 24행: '…Node 24.x LTS 강제·Biome·Vite 7 유지.'를 'Vite 7 유지(Vite 8/Rolldown은 검증 완료·대기 — CRDT 전환 종료 후 P5에서 별도 브랜치로 실측 채택). singlefile 2.3.3이 Vite 8 대응 완료라 이관 리스크 낮음, 단 SINGLE=1의 iife/inlineDynamicImports 하드코딩과 Lightning CSS 최소화가 유일 회귀점'으로 갱신.
- PLAN/README.md 21행 및 P3-server-auth.md 10행의 영속 백엔드 표현을 '기본=y-leveldb/SQLite 임베디드(외부서비스 0·에어갭 최적), Supabase 배제(과설계·RLS가 CRDT 스트림 보호 못 함), 순정 Postgres는 SQL 조회 실요구 시에만 승격'으로 명확화. Supabase를 명시적 배제 항목으로 추가.
- PLAN/P3-server-auth.md 11행 'onAuthenticate 훅(…), WebSocket 토큰은 쿠키/서브프로토콜' → 'WebSocket 토큰은 HocuspocusProvider token 옵션(async, 재연결마다 재발급)으로 전달하는 in-band 인증 메시지가 기본. httpOnly 쿠키 세션은 same-origin HTTP로 단수명 collab 티켓을 발급받아 token으로 넘김. ?token= 쿼리스트링 금지(로그 유출·CSWH). RS256 jose 로컬 검증, alg 고정, exp/jti 폐기목록, wss+내부 CA'로 정정.
- PLAN/risks-and-decisions.md 32행 '서버 영속 백엔드' 열린 결정에 Supabase 옵션 평가 결과를 결론으로 반영: 'Supabase=과설계·RLS 무효로 배제 확정. 기본 y-leveldb/SQLite, SQL 감사조회 실요구 시 순정 Postgres 승격'. 34행 '인증 방식' 열린 결정에 'IdP 없으면 jose RS256 로컬 서명 JWT를 onAuthenticate에서 검증(+PocketBase/SuperTokens는 자작 회피 대안), Supabase GoTrue는 풀스택 부담으로 비권장' 추가.
- PLAN/risks-and-decisions.md 6번 리스크(무인증 0.0.0.0)와 15행의 완화책 문장에서 'WebSocket 토큰은 쿠키/Sec-WebSocket-Protocol' 표현을 위와 동일하게 in-band token+단수명 티켓으로 정정.
- migration-rollout.md 및 P5-deploy-compat.md에 'Vite 8 이관은 CRDT 커밋과 분리한 독립 단계로, build+smoke+mount+build:single+check-single 전체 게이트 통과 및 HydroNet.html file:// 더블클릭 실측 후에만' 절차를 명시. 벤더링 목록(에어갭)에 jose·(선택)pg·Rolldown/Lightning CSS 네이티브 바이너리·resvg win32-x64-msvc 추가.
- README.md는 'Vite 7/8/Rolldown' 문자열이 없어 버전 언급 갱신 불필요(툴체인 pin은 client/package.json·vite.config.ts). 대신 인증/DB 아키텍처가 확정되면 README의 '기술 스택'·배포 섹션에 onAuthenticate 게이트·임베디드 영속을 추가 반영.

## 6. 리스크
- PLAN/P3-server-auth.md 11행 'WebSocket 토큰은 쿠키/서브프로토콜'은 부정확 → in-band token 메시지(+httpOnly 쿠키는 단수명 티켓 경유)로 정정 필요. 이 오해로 구현하면 브라우저 제약(커스텀 WS 헤더 불가·httpOnly 쿠키 JS 불가)에 부딪힘.
- RLS를 감사 지적 해결책으로 오인 금지 — Supabase든 Postgres든 RLS는 CRDT WebSocket admit/deny를 못 한다. 게이트는 onAuthenticate 단일 지점.
- readOnly(viewer) 클라의 로컬 y-indexeddb 미수락 변경을 서버본으로 교체하는 정책이 오프라인-퍼스트와 충돌(P3 기존 리스크) — viewer에게 provider를 붙일지부터 UX 결정 필요.
- 에어갭 Secure 쿠키: 내부 TLS(자체서명 CA) 없으면 Secure 쿠키가 전송 안 됨(조용히 실패). wss+내부 CA 배포 필수. Origin 헤더 검증도 병행.
- Hocuspocus openDirectConnection()은 onAuthenticate를 우회 → 서버 내부 경로에 인증 미적용. 서버 코드에서 이 경로 사용 시 주의.
- 벤더링 대상(에어갭): @hocuspocus/server·@hocuspocus/extension-database·yjs·jose·(Postgres 채택 시)pg 를 node_modules에 사전 반입.

## 7. 착수 전 확인 (Open Decisions)
- SQL 조회가 실제 요구인가: 프로젝트 목록·감사 로그·사용자 관리를 SQL로 뽑을 실수요가 있는지 확인해야 y-leveldb(임베디드) vs 순정 Postgres 승격을 최종 판정할 수 있음.
- 역할 모델 범위: '전무님=쓰기, 현장 PC=읽기' 같은 문서별 readOnly RBAC가 실제 필요한지, 아니면 LAN 내 전원 편집으로 충분한지(readOnly 구현 여부가 onAuthenticate·오프라인 충돌 설계를 좌우).
- 인증 컴포넌트 선택: 순수 jose 자작 JWT vs PocketBase/SuperTokens 같은 검증 OSS 도입 — 사용자 CRUD/관리 UI 필요도와 '자작 auth 금지' 원칙 사이에서 결정 필요.
- 내부 TLS 배포 가능성: 에어갭 LAN에서 자체서명 CA를 각 PC에 배포해 wss+Secure 쿠키를 쓸 수 있는지(불가하면 인증 전달 방식 재설계 필요).
- Vite 8 실측 타이밍: CRDT 전환(P1~P5) 종료 후 P5에서 이관할지, 아니면 계속 Vite 7로 확정 동결할지 — 빌드 속도 이득이 조직에 실제 가치가 있는지.
- 에어갭 벤더링 범위 확정: node_modules 벤더링 vs Verdaccio 미러 중 무엇으로 pg/jose/@hocuspocus/Rolldown 바이너리를 반입할지.

## 참고 자료
- [Vite official blog — Vite 8.0 is out! (Node/ESM·plugin compat)](https://vite.dev/blog/announcing-vite8)
- [Vite official Migration from v7 guide (rollupOptions→rolldownOptions, iife 유지)](https://vite.dev/guide/migration)
- [vite-plugin-singlefile CHANGELOG (2.3.1 Vite8 지원, 2.3.3 수정)](https://github.com/richardtallent/vite-plugin-singlefile/blob/main/CHANGELOG.md)
- [vite-plugin-singlefile #118 — inlineDynamicImports deprecated on Vite 8 (2.3.3 fix)](https://github.com/richardtallent/vite-plugin-singlefile/issues/118)
- [Supabase Docs — Self-Hosting with Docker (12서비스·에어갭 비지원)](https://supabase.com/docs/guides/self-hosting/docker)
- [Supabase Docs — Realtime Authorization (RLS는 Supabase 채널만 보호)](https://supabase.com/docs/guides/realtime/authorization)
- [Supabase Discussion #26159 — 자체호스팅 리소스(유휴 RAM·Kong 팽창)](https://github.com/orgs/supabase/discussions/26159)
- [supabase/auth (GoTrue) — SMTP 없는 admin 사용자 생성·오프라인 JWT](https://github.com/supabase/auth)
- [Hocuspocus Authentication (onAuthenticate·token·readOnly)](https://tiptap.dev/docs/hocuspocus/guides/authentication)
- [Hocuspocus Server Hooks (onAuthenticate payload·throw 차단)](https://tiptap.dev/docs/hocuspocus/server/hooks)
- [Hocuspocus Database extension (fetch/store·바이너리 그대로 반환)](https://tiptap.dev/docs/hocuspocus/server/extensions/database)
- [Hocuspocus #566 — reconnect 재인증(async token 함수)](https://github.com/ueberdosis/hocuspocus/issues/566)
- [PostgreSQL Docs — Row Security Policies (SQL 명령 한정, superuser 우회)](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Handling JWT the Right Way in Node.js 2026 (jose RS256 오프라인·alg 고정)](https://dev.to/akshaykurve/handling-authentication-with-jwt-the-right-way-in-nodejs-2026-edition-25na)
- [marksteve/hocuspocus-extension-postgres (Postgres BYTEA 어댑터 패턴)](https://github.com/marksteve/hocuspocus-extension-postgres)

---
[← 계획 인덱스](README.md)
