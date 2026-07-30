# P2. Undo/Redo → Y.UndoManager

> **노력**: 중간 (3-5인일)

## 목표
past/future 전체-스냅샷 스택을 Y.UndoManager로 대체하되 단일 사용자 undo UX를 회귀 없이 보존한다.

## 작업 (Tasks)
- Y.UndoManager(scope=[tasksY,linksY,categoriesY,rainyY,viewY], trackedOrigins={LOCAL_ORIGIN})
- CPM 재계산을 SCHEDULE_ORIGIN(비추적)으로 격리 → undo 스택 오염 방지
- captureTimeout으로 드래그 연속 이동 1 undo 병합, 제스처 종료 시 stopCapturing()
- beginGesture/history:false 패턴을 captureTimeout·stopCapturing으로 대체
- stack-item 메타로 selectedTaskIds 복원 UX 유지

## 산출물 (Deliverables)
- Y.UndoManager 기반 undo/redo
- origin 격리 규칙
- 제스처 병합 정책

## 검증 (Verification)
- build + smoke + mount 통과
- 단일 사용자: 드래그/입력/삭제/붙여넣기 undo가 기존 스냅샷 방식과 동일 결과인지 회귀 테스트
- cascade가 undo 스택에 안 쌓이는지 확인
- '내 변경만 undo' 시맨틱이 단일 사용자엔 기존과 무차별한지

## 리스크
- 전역 undo→'내 변경만' 시맨틱 변화가 단일 사용자에서도 미묘한 회귀
- captureTimeout 경계가 어긋나 한 번에 너무 많이/적게 되돌림

---
[← 계획 인덱스](README.md)
