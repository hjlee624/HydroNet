# P3. 서버 동기 (Hocuspocus) + 인증 하드닝 + PUT 강등

> **노력**: 높음 (10-15인일)

## 목표
사내 LAN에서 여러 PC가 같은 projectId를 실시간 동시 편집하고, 무인증 감사 지적을 인증으로 해소하며, LWW 전체-파일 PUT이 CRDT를 덮어쓰지 못하게 한다.

## 작업 (Tasks)
- server/src/index.js에 Hocuspocus 부착(같은 http 서버·4020, 운영 4000 금지)
- extension-database(SQLite/Postgres) 또는 y-leveldb로 room별 Y.Doc 영속 + 주기 스냅샷/GC
- onAuthenticate 훅(토큰/세션 검증, readOnly 역할), WebSocket 토큰은 쿠키/서브프로토콜
- 리버스프록시 forward-auth 또는 독립 auth-server 도입, Express를 127.0.0.1 바인딩
- 클라: 온라인 LAN 모드에서만 HocuspocusProvider(room=projectId) 부착(오프라인 미부착 옵션화)
- 전체-파일 PUT /api/projects/:id를 스냅샷/백업·레거시 로드용으로 강등(read-only)
- 멀티시트: 전 시트 Y.Doc 상주 + 활성 시트=로컬 뷰 포인터로 전환

## 산출물 (Deliverables)
- Hocuspocus 통합 서버
- 서버 영속(DB) + 압축 정책
- 인증 게이트(프록시/auth-server)
- provider 옵션화 클라이언트
- 강등된 PUT

## 검증 (Verification)
- 두 클라이언트가 서로 다른 Task 동시 이동 → 둘 다 보존, 같은 필드만 결정적 수렴
- 오프라인(단일 HTML)에서 provider 없이 y-indexeddb만으로 편집·영속 정상
- 서버 재시작 후 문서 복원(영속) 확인
- 무인증 접근 차단·readOnly 뷰어 검증
- dev 4020에서만 기동, 본인 PID만 종료, 운영 4000 무영향 확인
- build + smoke + mount 통과

## 리스크
- 에어갭 npm 접근 불가→node_modules 벤더링 필요
- readOnly 클라의 로컬 y-indexeddb 미수락 변경을 서버본으로 교체하는 로직이 오프라인-퍼스트와 충돌
- y-leveldb rooms 무한 증가·GC 누락으로 용량 팽창
- LWW PUT 잔존 시 CRDT 덮어쓰기
- 동시 편집으로 링크 그래프 사이클 발생→CPM 방어 필요

---
[← 계획 인덱스](README.md)
