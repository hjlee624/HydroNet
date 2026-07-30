# ADR-002 — 인증 · 접속코드 · 3역할 RBAC (Postgres)

> 2026-07-30 사용자 확정. HydroNet에 **사내 로그인 → 프로젝트 선택 → 프로젝트별 접속코드 → 3역할 RBAC**를 도입. DB=**PostgreSQL**(운영). 사용자 계정은 **엑셀 업로드**로 시드. [PLAN 인덱스](README.md) · 상위 [ADR-001](ADR-001-vite8-and-db-auth.md).

## 결정
1. **DB = PostgreSQL**(운영). 개발/검증 환경엔 로컬 Postgres가 없어, **저장소 인터페이스 + 어댑터 2종**으로 분리:
   - `memory`(JSON 파일 `server/data/auth.json` 백업) — dev·테스트·오프라인. 서버 재시작에도 보존.
   - `pg`(`pg` Pool) — 운영. 스키마 `server/db/schema.sql`.
   - 환경변수 `AUTH_BACKEND=memory|pg`(기본 memory), `DATABASE_URL`(pg일 때).
2. **인증은 서버가 있을 때만.** 오프라인 단일 HTML(file://)·서버 미탐지 시 **로컬 단일사용자 모드**(로그인 없이 편집) — 오프라인 배포 요건 유지. 클라 `authStore`가 `/api/health` 프로브로 판정.
3. **3역할(그룹)**:
   | 역할 | 권한 |
   |---|---|
   | `developer` (개발자) | 전체 접속 + 모든 프로젝트 수정. **프로젝트 접속코드 면제.** 사용자/프로젝트 관리(관리자). |
   | `pm` (프로젝트 관리자) | 담당 프로젝트의 **멤버 관리(추가/삭제/역할)·접속코드 설정** + 수정. 자기 담당 프로젝트는 코드 면제. |
   | `user` (사용자) | 부여받은 프로젝트에 **접속코드 입력 후 입장·수정.** |
4. **인증 흐름**:
   - `POST /api/auth/login {username,password}` → scrypt 검증 → **세션 JWT**(jose HS256, httpOnly·SameSite=Strict 쿠키).
   - `GET /api/auth/me` → 현재 사용자{id,name,role}.
   - `GET /api/auth/projects` → 접근 가능 프로젝트 목록(developer=전체, 그 외=멤버십).
   - `POST /api/auth/projects/:id/enter {code}` → 접속코드 검증(developer·해당 PM 면제, user 필수) → **프로젝트 토큰**(JWT {sub,projectId,projRole}, 단수명) 발급.
   - 프로젝트 데이터 라우트(`/api/projects/:id` GET/PUT)는 **프로젝트 토큰**(또는 developer 세션) 필요 → 접속코드 게이트 강제. (향후 P3 Hocuspocus `onAuthenticate`도 이 토큰 검증 — [ADR-001].)
5. **엑셀 업로드로 사용자 시드**: `POST /api/admin/users/import`(developer 전용, multipart 또는 base64). `xlsx`(또는 CSV) 파싱 → upsert. **컬럼 스펙**: `username`(=사번/ID, 필수), `name`, `role`(developer|pm|user), `password`(선택 — 없으면 계정만 생성·비밀번호 미설정). 샘플 `server/data/users.sample.csv`.
6. **비밀번호·접속코드 해시** = Node 내장 `crypto.scrypt`(네이티브 의존 0·에어갭). JWT = `jose`(HS256, 단일 발급/검증). 추후 Hocuspocus 독립 검증이 필요하면 RS256으로 승격([ADR-001]).

## 보안 메모
- RLS는 이 게이트를 대신하지 못함([ADR-001]) — 인증 게이트는 앱 로직(라우트 미들웨어/`onAuthenticate`).
- 쿠키는 `httpOnly`·`SameSite=Strict`·(운영)`Secure`(내부 TLS 필요). 프로젝트 토큰은 `Authorization: Bearer`.
- `xlsx@0.18.5`는 알려진 취약점(admin 전용 업로드라 위험 낮음) — 운영은 SheetJS 최신(CDN) 또는 CSV 권장.
- 무인증 0.0.0.0(감사 지적)은 로그인 게이트 + (운영)프록시 forward-auth로 해소.

## 구현(1차 슬라이스)
- 백엔드: `server/src/auth/{roles,crypto,repo,pgRepo,importUsers,routes}.js` + `server/db/schema.sql` + `server/scripts/auth-smoke.mjs`(memory 어댑터로 로그인·역할·접속코드·멤버십 무-Postgres 검증) + `index.js` 배선.
- 프론트: `client/src/state/authStore.ts` + `components/auth/{LoginScreen,ProjectSelectScreen,AccessCodeScreen}.tsx` + `App.tsx` 게이트(local/server 모드).
- 검증: server auth-smoke + client build·mount·build:single·check-single.

## 남은 확인/후속
- 엑셀 컬럼 최종 확정(업로드 샘플 받은 뒤). 비밀번호 정책(최초 로그인 변경 강제?).
- 프로젝트 생성 주체(developer만? PM?)·접속코드 발급 UI.
- 운영 Postgres 인스턴스·`DATABASE_URL`·내부 TLS 배포. 에어갭 시 pg/jose/xlsx 벤더링.

---
[← 계획 인덱스](README.md)
