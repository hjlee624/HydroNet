# P1. 로컬 데이터모델 CRDT화 (provider 없음) + y-indexeddb

> **노력**: 높음 (8-12인일)

## 목표
project를 Y.Doc로 보유하고 commit을 doc.transact로 바꾸되, 렌더 레이어 코드 무변경으로 단일 사용자 동작을 100% 보존한다. 아직 네트워크 없음.

## 작업 (Tasks)
- rootMap 스키마 부트스트랩(getMap/getArray 멱등, '없으면 1회만' 생성 guard)
- commit(mutate)를 ydoc.transact(applyToYTypes, LOCAL_ORIGIN=객체identity)로 래핑
- observeDeep→(origin!==LOCAL_ORIGIN 또는 CPM 재적용)→rootMap.toJSON()→withSchedule→zustand set 단방향 어댑터(100줄 미만 수동 바인딩, 미들웨어 의존 회피)
- Task.row·Category.order를 fractional-index 소수키로, moveTaskToRow/reorderCategory를 인덱스 전면재작성 없이 이웃 중점값으로 재작성
- parentId는 LWW 값 필드 유지, 부모삭제→자식삭제 규칙 트랜잭션 반영
- localStorage 자동복원 캐시(AUTOSAVE_KEY)를 y-indexeddb(인스턴스 1개)로 대체
- normalize/migrateSubNameToParentId를 로드 어댑터로 이동, meta.schemaVersion 도입

## 산출물 (Deliverables)
- Y.Doc 기반 store.ts
- 수동 Y↔zustand 바인딩 어댑터
- y-indexeddb 로컬 영속
- fractional-index row/order 유틸

## 검증 (Verification)
- build(tsc --noEmit + vite) 통과
- cd client && npx tsx scripts/smoke.ts (CPM 엔진 회귀)
- cd client && npx tsx scripts/mount-test.ts (jsdom 전체앱 빈화면 회귀 — synced 전 렌더 방지)
- 단일 사용자 편집·저장·재시작 복원이 기존과 동일한지 수동 확인
- observeDeep 과발화로 인한 리렌더 폭증 없는지(배치/throttle)

## 리스크
- observeDeep 무한루프(origin 가드 누락)
- 중첩 컨테이너 재생성 덮어쓰기(getArray 멱등 guard 필수)
- synced 이전 빈 화면 회귀
- referential equality 깨져 zustand selector 메모 우회→불필요 리렌더

---
[← 계획 인덱스](README.md)
