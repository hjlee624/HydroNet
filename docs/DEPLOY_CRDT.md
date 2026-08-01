# CRDT 배포 · 운영

## 배포 형태

| 형태 | 협업 | 영속 | 용도 |
|---|---|---|---|
| 단일 HTML `HydroNet.html` | 없음(provider 미연결) | 브라우저 y-indexeddb + 수동 `.json` | 서버 없는 현장 PC |
| LAN 서버 | `/collab` 실시간 협업 | 파일 binary 또는 PostgreSQL | 여러 PC 공동 편집 |
| Electron | 미구현 | 미정 | 선택 과제 |

현재 Vite 7을 유지하며 Vite 8 전환은 이 배포 범위에 포함하지 않는다.

## 기본 설정

- 개발 기본 주소: `http://<server>:4020`
- WebSocket: 같은 host/port의 `/collab`
- 기본 인증 backend: memory (`server/data/auth.json`)
- 기본 Y.Doc backend: file (`server/data/ydocs/*.bin`)
- PostgreSQL: `AUTH_BACKEND=pg`와 `DATABASE_URL`이 모두 필요
- 명시 Origin allowlist: `COLLAB_ALLOWED_ORIGINS`에 쉼표로 구분한 origin 지정
- secure cookie: 운영에서는 `NODE_ENV=production` 또는 `AUTH_SECURE_COOKIE=1`

기본 Origin 정책은 명시 allowlist 또는 요청 host와 같은 localhost/private-LAN origin만 허용한다. 이는 브라우저 handshake 방어이며 암호화가 아니다. 운영은 reverse proxy에서 HTTPS/WSS와 내부 CA를 적용한다.

## 설치 · 빌드

```powershell
npm.cmd install
npm.cmd run build
```

4020 개발 서버:

```powershell
$env:PORT='4020'
npm.cmd --prefix server start
```

포트 4000은 기존 운영 인스턴스용이다. 이 작업공간에서 점유하거나 프로세스를 재시작·종료하지 않는다.

## 계정 roster

현재 작업공간의 기본 memory 인증 저장소에는 roster가 반영되어 있다. 운영 환경에 다시 적용할 때는 반드시 dry-run부터 실행한다. CLI 출력은 인원·역할 집계와 reconciliation만 포함하고 전화번호·비밀번호는 출력하지 않는다.

```powershell
# 기본: DB/ID.xlsx 검증과 적용 계획만 출력
node server\scripts\seed-roster.mjs

# 현재 선택된 backend에 반영(프로젝트가 하나면 membership도 함께 적용)
node server\scripts\seed-roster.mjs --apply

# 프로젝트가 여러 개면 대상마다 명시적으로 실행
node server\scripts\seed-roster.mjs --apply --project <projectId>

# 기존 계정의 비밀번호 hash를 초기값으로 되돌릴 때만 사용
node server\scripts\seed-roster.mjs --apply --project <projectId> --reset-passwords
```

전화번호는 digits-only canonical ID로 저장하고 UI에서 하이픈을 표시한다. 신규 계정의 초기비밀번호는 전화번호 끝 4자리이며 scrypt hash만 저장한다. 재실행은 기존 비밀번호 hash를 보존한다. 로그인은 동일 IP+ID 5회 실패 시 15분 제한한다.

프로젝트가 정확히 하나면 CLI가 PM/user membership을 자동 배정한다. 프로젝트가 여러 개면 `--apply`가 대상 선택을 요구하므로 `--project <projectId>`를 프로젝트별로 명시한다. 이 보호장치는 roster에 프로젝트 매핑 열이 없을 때 임의의 광범위 권한 부여를 막는다.

PostgreSQL 대상 dry-run/apply 예시:

```powershell
$env:AUTH_BACKEND='pg'
$env:DATABASE_URL='<배포 환경의 연결 문자열>'
node server\scripts\seed-roster.mjs
node server\scripts\seed-roster.mjs --apply --project <projectId>
```

연결 문자열과 초기비밀번호를 저장소·명령 이력·로그에 남기지 않는다.

## 레거시 프로젝트 시드

1. `server/data/<projectId>.json`과 해당 인증 프로젝트 row를 준비한다.
2. 최초 `/collab` fetch에서 같은 project id의 binary가 없는 경우에만 서버가 Y.Doc update를 만든다.
3. 생성 위치는 file backend의 `server/data/ydocs/<projectId>.bin` 또는 PostgreSQL Y.Doc 저장소다.
4. seed는 lock/원자적 write로 한 번만 생성된다. 이후 원본 JSON을 지워도 binary가 복원 원본이다.
5. `es/ef/ls/lf/totalFloat/critical/__mirror`와 cascade 전용 출력은 시드에서 제거된다.

클라이언트가 같은 JSON을 각자 import해 room을 시드하면 중복·발산할 수 있으므로 서버 시드만 사용한다.

## API 변경

- 편집: 인증된 `/collab` WebSocket
- collab ticket: `POST /api/auth/projects/:id/collab-ticket` (5분)
- 평면 백업: `GET /api/projects/:id/snapshot`
- 전체 덮어쓰기: `PUT /api/projects/:id` → 405
- autosave list/read/write/delete: 로그인과 project grant 필요

## 검증 명령

루트에서 순서대로 실행한다. mount와 single-file 검증은 client 작업 디렉터리를 사용한다.

```powershell
npm.cmd run build
client\node_modules\.bin\tsx.cmd client\scripts\smoke.ts

Push-Location client
node_modules\.bin\tsx.cmd scripts\mount-test.ts
npm.cmd run smoke:crdt
npm.cmd run build:single
node_modules\.bin\tsx.cmd scripts\check-single.ts
node_modules\.bin\tsx.cmd scripts\auth-phone-test.ts
Pop-Location

npm.cmd --prefix server run auth-smoke
npm.cmd --prefix server run collab-smoke
node server\scripts\seed-roster.mjs
```

`collab-smoke`는 임시 디렉터리와 OS가 할당한 port 0을 사용해 인증 거부, 두 provider 수렴, legacy 1회 시드, binary 재시작 복원, PUT 405, autosave gate를 검증한다.

## 백업 · 복구

- 배포 전 `server/data`와 PostgreSQL을 함께 백업한다.
- memory/file 구성은 `auth.json`, `ydocs/*.bin`, 필요한 legacy snapshot을 한 세트로 보관한다.
- 복구할 때 binary와 서로 다른 시점의 legacy JSON을 섞어 재시드하지 않는다.
- 운영 종료 시 Hocuspocus 문서 flush가 끝난 뒤 프로세스를 종료한다.
- 민감정보가 있는 `DB/*.xlsx`와 `server/data`는 Git에 추가하지 않는다.
