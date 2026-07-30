# P5. 배포·호환 마감 — .json↔Y.Doc 무손실, LWW PUT 제거

> **노력**: 중간 (5-8인일)

## 목표
기존 .json 저장/불러오기를 무손실로 유지하면서 CRDT를 정식 진실원본으로 확정하고, 세 배포 형태(단일HTML·LAN서버·Electron)를 안정화한다.

## 작업 (Tasks)
- .json(평면)↔Y.Doc 스냅샷 왕복 어댑터 완성(schemaVersion 분기, api.ts/fileIO.ts)
- 서버 권위에서 레거시 .json→CRDT 시드 '1회' 생성·바이너리 배포(클라별 재import 금지)
- LWW PUT 완전 제거 또는 백업 전용 read-only 확정
- 단일 HTML 빌드에 Yjs 인라인 검증(build:single·check-single)
- Electron 패키징 스모크(선택)
- 버전/베이스라인 보관 정책(전체 스냅샷 복사본) 문서화

## 산출물 (Deliverables)
- 무손실 .json↔Y.Doc 변환기
- 시드 배포 절차
- 최종 배포 3형태
- README/DEPLOY 문서 갱신

## 검증 (Verification)
- 기존 .json 저장→불러오기 왕복 무손실(rootMap.toJSON()==원본 Project 구조)
- 단일 HTML(file://)에서 CRDT+y-indexeddb 정상, WASM 없음 확인
- build:single 후 check-single 회귀
- 여러 클라가 같은 .json 시드로 시작해도 clientID 중복/발산 없는지
- build + smoke + mount 전부 통과 → README 갱신 → commit → git push origin dev + git push github dev(둘 다)

## 리스크
- 클라별 .json 재import로 clientID 갈려 항목 중복/발산
- 단일 HTML 번들에 y-indexeddb 로드 타이밍
- LWW PUT 잔존 회귀

---
[← 계획 인덱스](README.md)
