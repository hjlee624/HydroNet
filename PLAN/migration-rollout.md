# 마이그레이션 · 점진 로드아웃

## 적용된 전환

1. **권위 경계 고정**: Y.Doc과 `.json`에서 `es/ef/ls/lf/totalFloat/critical/__mirror`와 cascade 전용 출력을 제외한다. `forceCritical`과 사용자 입력값은 유지한다.
2. **로컬 CRDT**: Y.Doc을 진실원본으로 두고 zustand는 평면 렌더 뷰로 사용한다. 오프라인 영속은 y-indexeddb, undo/redo는 로컬 origin 전용 `Y.UndoManager`다.
3. **서버 협업**: 기존 Express 서버의 같은 포트에 Hocuspocus `/collab`을 연결한다. project grant를 same-origin HTTP에서 5분 collab ticket으로 교환하고, WebSocket 연결 때 현재 RBAC를 다시 확인한다.
4. **바이너리 영속**: memory backend는 `server/data/ydocs/*.bin`, PostgreSQL backend는 Y.Doc binary 컬럼을 사용한다. 파일 저장은 임시 파일+rename으로 원자화한다.
5. **레거시 시드**: binary가 없을 때만 서버가 `server/data/<projectId>.json`을 canonical Y.Doc update로 1회 변환한다. 클라이언트별 JSON 재import는 금지한다.
6. **LWW 종료**: `PUT /api/projects/:id`는 405다. 평면 백업은 `GET /api/projects/:id/snapshot`으로만 읽는다. autosave list/read/write/delete도 인증과 project grant를 요구한다.
7. **배포 호환**: 단일 HTML은 provider 없이 Yjs+y-indexeddb를 인라인한다. LAN은 4020의 HTTP/API/WebSocket 단일 포트를 사용한다.

## 배포 순서

1. 운영 데이터와 `server/data`를 별도 백업한다.
2. Node 24.x/npm 11.x와 의존성을 준비하고 `npm install`을 완료한다.
3. memory 또는 PostgreSQL 인증 backend를 선택한다. PostgreSQL은 `AUTH_BACKEND=pg`와 `DATABASE_URL`이 모두 필요하다.
4. roster CLI를 먼저 dry-run하고 검증 요약이 맞을 때만 `--apply`한다. 프로젝트가 여러 개면 `--project <projectId>`를 대상별로 명시하며, 기존 비밀번호는 기본적으로 보존한다.
5. 일반 빌드와 전체 smoke를 임시 포트 또는 4020에서 수행한다.
6. LAN 배포 전에 reverse proxy에서 HTTPS/WSS와 내부 CA를 구성하고 허용 Origin을 확정한다.
7. 최초 프로젝트 접속 뒤 Y.Doc binary 생성 여부와 재시작 복원을 확인한다. 레거시 JSON은 binary 생성 후 다시 import하지 않는다.

## 롤백

- 바이너리 전환 전 원본 JSON 백업은 보존한다.
- 문제 발생 시 서버를 중단하고 배포 전 `server/data`와 인증 저장소 백업을 복원한다.
- 이미 생성된 Y.Doc binary와 레거시 JSON을 섞어 재시드하지 않는다. 어느 쪽을 복원할지 한 세트로 결정한다.
- 전체 PUT을 다시 켜는 롤백은 금지한다. 기존 Y.Doc을 덮어써 동시 변경을 유실할 수 있다.

## 절대 운영 경계

개발·검증은 dev 작업공간의 4020 또는 테스트 임시 포트에서만 수행한다. 포트 4000과 기존 운영 프로세스는 점유·재시작·종료하지 않는다. 자세한 명령은 [`../docs/DEPLOY_CRDT.md`](../docs/DEPLOY_CRDT.md)를 참고한다.

---
[← 계획 인덱스](README.md)
