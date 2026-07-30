# P0. 경계 명문화 (비파괴) — 이미 반영됨

> **노력**: 완료 (0.5인일, 이미 반영)

## 목표
CRDT의 최대 함정(파생 계산값을 협업 상태에 써 사용자끼리 덮어쓰기)을 문서로 못 박아 이후 어떤 CRDT를 붙여도 안전한 토대를 확정한다.

## 작업 (Tasks)
- docs/CRDT_PLAN.md·ISSUE_CRDT.md의 권위 데이터 vs 파생 캐시 경계 유지·최신화
- withSchedule/applyCascade/reschedule/mirror가 순수 함수·비영속임을 코드로 재확인(완료)
- 붙일 지점 4곳(commit, past/future, server, api/fileIO) 확정

## 산출물 (Deliverables)
- 갱신된 CRDT_PLAN.md/ISSUE_CRDT.md
- 권위/파생 필드 목록 확정
- 라이브러리 결론(Yjs 1순위) 문서화

## 검증 (Verification)
- 문서 리뷰 — es/ef/ls/lf/critical/__mirror/cascade-start가 '동기화 제외'로 명시됐는지
- forceCritical·사용자 드래그 start가 '권위'로 분류됐는지 확인

## 리스크
- 경계가 흐려지면 이후 모든 단계가 진동 버그로 오염 — 가장 중요한 사전 게이트

---
[← 계획 인덱스](README.md)
