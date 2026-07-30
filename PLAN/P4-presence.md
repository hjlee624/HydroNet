# P4. 프레즌스 (Awareness) — 원격 커서·선택

> **노력**: 중간 (3-5인일)

## 목표
누가 무엇을 보고 편집 중인지 실시간 표시해 협업 인지도를 높인다. Y.Doc 비저장 휘발 상태라 권위/파생 경계와 무관.

## 작업 (Tasks)
- y-protocols Awareness에 user{name,color}·selection 필드 브로드캐스트
- 기존 selectedTaskIds/selectedCategoryIds/selectedLinkId를 selection 필드로 얹기
- awareness change 이벤트로 SVG에 원격 선택 하이라이트·사용자 라벨 렌더
- 재연결/오프라인 전환 시 awareness clear(유령 커서 방지)
- 사용자 색·이름 배정(간단한 로컬 프로필 또는 인증 컨텍스트에서)

## 산출물 (Deliverables)
- awareness 브로드캐스트 계층
- SVG 원격 커서·선택 오버레이
- 사용자 색 팔레트

## 검증 (Verification)
- 두 PC에서 서로의 선택·커서가 실시간 표시되는지
- 오프라인 전환 시 상대 화면에서 커서가 사라지는지
- awareness가 .json 저장·CPM에 영향 없는지(휘발 확인)
- build + smoke + mount 통과

## 리스크
- 재연결 시 awareness 미clear로 유령 커서
- SVG 오버레이 렌더 성능(많은 사용자 시)

---
[← 계획 인덱스](README.md)
