# CRDT 도입 결정 기록

이 문서는 초기 검토 이슈를 현재 구현 결정에 맞춰 닫은 기록이다. 운영 절차는 [`CRDT_PLAN.md`](CRDT_PLAN.md)와 [`DEPLOY_CRDT.md`](DEPLOY_CRDT.md)를 기준으로 한다.

## 채택한 결정

- Yjs + y-indexeddb + Hocuspocus를 사용한다.
- 프로젝트 전체를 Y.Doc 하나로 관리하되 계산·표시 전용 파생값은 제외한다.
- id 컬렉션은 안정된 named Y type과 `Y.Map<id, Y.Map>`을 사용한다.
- 동시 재정렬은 배열 delete/insert 대신 `$position` fractional key로 표현한다.
- 모든 시트는 문서에 상주하고 active sheet는 로컬 뷰로 분리한다.
- undo/redo는 `Y.UndoManager`의 로컬 origin만 추적한다.
- 오프라인은 provider 없이 y-indexeddb, LAN은 같은 4020 서버의 `/collab`을 사용한다.
- WebSocket은 5분 collab ticket만 받으며 12시간 project grant의 직접 사용을 거부한다.
- 파일 또는 PostgreSQL에 Y.Doc binary를 저장한다. 레거시 JSON은 서버가 한 번만 시드한다.
- 전체 JSON PUT은 405로 종료하고 snapshot GET만 유지한다.
- 단일 HTML은 Yjs를 인라인한 기존 IIFE/file 배포를 유지한다.

## 보류한 결정

- Electron 패키징: 선택 과제, 현재 스캐폴드 없음
- PostgreSQL 전환: `AUTH_BACKEND=pg`와 `DATABASE_URL`이 있는 배포에서만 사용
- 프레즌스의 최종 화면 표현과 운영 TLS/내부 CA 구성: 배포 환경 검증 필요
- Vite 8: 별도 호환성 작업으로 분리

## 회귀 게이트

- 권위 Y.Doc/JSON에 `es/ef/ls/lf/totalFloat/critical/__mirror`가 없어야 한다.
- 두 Y.Doc·두 provider의 서로 다른 필드 편집이 모두 보존되고 수렴해야 한다.
- IndexedDB hydration 전에 새 seed가 기존 로컬 문서를 덮지 않아야 한다.
- legacy seed는 동시에 요청하거나 서버를 재시작해도 중복 생성되지 않아야 한다.
- 무인증·잘못된 Origin·다른 room ticket·철회된 멤버십은 거부해야 한다.
- 전체 JSON PUT은 405, autosave list/read/write/delete는 인증과 project grant를 요구해야 한다.
- 일반 빌드, 엔진 smoke, mount, CRDT smoke, 단일 HTML build/check, auth/collab smoke를 실행한다.
