# CRDT 협업 구조

> 구현 기준: P0 경계, 로컬 Y.Doc/y-indexeddb, Y.UndoManager, LAN Hocuspocus 서버, 바이너리 영속, `.json` 호환 경로가 코드에 반영되어 있다. 프레즌스 UI와 운영 배포 구성은 별도 검증 대상이다.

## 권위 데이터 경계

Y.Doc과 사용자가 저장하는 `.json`에는 사용자 입력값만 기록한다.

- 포함: 프로젝트 메타, 용지·보기·브랜딩·팔레트, 공종·공정·연결·우기, 전체 시트의 사용자 입력 필드
- 제외: `es`, `ef`, `ls`, `lf`, `totalFloat`, `critical`, `__mirror`
- 제외: cascade가 계산한 중간·출력 전용 상태
- 예외: `forceCritical`과 사용자가 직접 드래그·입력한 `start`는 권위 데이터다.

CPM, mirror, layout, KPI와 cascade 결과는 각 클라이언트가 평면 뷰를 만들 때 재계산한다. 이 경계는 `client/src/state/crdt.ts`와 `server/src/collab/seed.js` 양쪽에서 적용한다.

## 현재 데이터 모델

- 프로젝트당 Y.Doc 1개, room 이름은 project id다.
- 안정된 top-level named Y type(`root/meta`, `root/tasks` 등)을 사용한다.
- id 기반 컬렉션은 `Y.Map<id, Y.Map>`이며 `$position` fractional key로 순서를 유지한다.
- 모든 시트는 문서 안에 상주하고, 활성 시트 선택은 로컬 뷰 포인터로 취급한다.
- zustand는 렌더 호환용 평면 뷰이며 Y.Doc이 권위 원본이다.
- undo/redo는 `Y.UndoManager`가 `LOCAL_ORIGIN`만 추적한다.

## 오프라인과 LAN

오프라인·단일 HTML은 provider를 연결하지 않고 `y-indexeddb`로 같은 project id의 Y.Doc을 복원한다. IndexedDB hydration이 끝난 뒤 문서가 비었을 때만 샘플을 시드해 기존 로컬 변경을 덮지 않는다.

LAN 모드는 기존 Express HTTP 서버와 같은 포트의 `/collab`에 Hocuspocus를 붙인다.

1. 로그인 세션으로 프로젝트에 입장해 project grant를 받는다.
2. `POST /api/auth/projects/:id/collab-ticket`으로 5분 ticket을 교환한다.
3. provider가 ticket을 Hocuspocus 인증 메시지로 보낸다. URL query에 토큰을 넣지 않는다.
4. 서버는 ticket claim뿐 아니라 현재 사용자·프로젝트·멤버십을 다시 조회한다.

현재 역할 정책은 developer, PM, user 모두 담당 프로젝트를 편집할 수 있다. developer는 전체 접근, PM과 user는 현재 멤버십이 필요하다.

## 저장과 마이그레이션

- memory 인증 백엔드: `server/data/auth.json`, Y.Doc은 `server/data/ydocs/<projectId>.bin`
- PostgreSQL 인증 백엔드: 계정/RBAC와 Y.Doc binary를 PostgreSQL에 저장
- 레거시 `server/data/<projectId>.json`이 있고 binary가 없으면 서버가 최초 fetch에서 한 번만 canonical Y.Doc update로 변환한다.
- 동시에 여러 연결이 들어와도 seed lock/원자적 write로 binary 하나만 생성한다.
- 이후 레거시 JSON은 다시 import하지 않는다.
- `PUT /api/projects/:id`는 405이며, 백업 조회는 `GET /api/projects/:id/snapshot`을 사용한다.

## 배포 제약

- 개발·검증 포트는 4020 또는 테스트 임시 포트다. 4000 운영 인스턴스는 건드리지 않는다.
- private-LAN/same-origin Origin 검사는 브라우저 출처 제한일 뿐 TLS 대체물이 아니다.
- 운영은 reverse proxy에서 HTTPS/WSS와 내부 CA를 적용한다.
- Electron 패키징은 선택 과제이며 현재 구현되지 않았다.
- Vite 8 마이그레이션은 이번 CRDT 도입 범위 밖이다.

실행·검증·운영 절차는 [`DEPLOY_CRDT.md`](DEPLOY_CRDT.md)를 따른다.
