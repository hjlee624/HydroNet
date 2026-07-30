# 마이그레이션 & 점진 로드아웃

1. 듀얼런(P3~P5): 기존 파일-PUT 파이프라인과 CRDT provider를 한동안 병행. 서버는 CRDT 문서를 진실원본으로 두되, 매 스냅샷마다 rootMap.toJSON()으로 순수 Project .json을 server/data와 ProgramData 자동저장 위치에 함께 써서(백업), 문제가 생기면 즉시 파일 기반으로 롤백 가능하게 한다.

2. 시드 생성은 서버 권위에서 1회만: 기존 server/data/proj-*.json 각각을 서버가 한 번 로드→normalize/migrateSubNameToParentId→Y.Doc 부트스트랩→encodeStateAsUpdate 바이너리로 영속. 클라이언트는 이 바이너리를 받아 시작하고 절대 각자 .json을 재import하지 않는다(clientID가 갈려 중복/발산).

3. 데이터 이관 순서: (1) tasks/links/categories/rainySeasons만 먼저 CRDT화(안정 nanoid id라 Y.Array&lt;Y.Map&gt; 1:1), (2) view/paper/branding/palette는 가산적으로 나중에, (3) 멀티시트(sheets)는 P3에서 전 시트 상주 구조로 이관하며 활성 시트를 로컬 뷰로 분리.

4. 폴백 계층 유지: 클라 api.ts의 serverOk→localStorage 폴백과 y-indexeddb 오프라인 영속을 병존시켜, 서버·provider가 없어도 단일 사용자로 완전 동작(오프라인 단일 HTML은 provider 미부착이 정상 경로).

5. 스키마 마이그레이션은 가산적으로만: 필드 rename 금지(모든 피어 원자적 wipe 불가), 신규 필드는 로드 어댑터 백필로 흡수, meta.schemaVersion 분기로 멱등 실행. 레거시 subName→parentId 이관은 시드 생성 시 1회 수행 후 CRDT엔 parentId만 상주.

6. 점진 로드아웃 순서 고정: 무인증→인증(P3 forward-auth/onAuthenticate), 파일저장→DB(P3 extension-database), 단일사용자→협업(P1 로컬→P3 provider). 각 전환은 이전 경로를 강등(read-only)만 하고 즉시 삭제하지 않아 되돌릴 여지를 남긴다(P5에서 LWW PUT 최종 제거).

7. 검증·배포 원칙: 모든 이관 단계는 dev 폴더(포트 4020)에서만 기동·검증하고 본인 PID만 종료. 운영 폴더(D:\2026\PROGRAM\HydroNet, 포트 4000, main)는 전무님 사용 중이라 절대 수정/재시작/포트점유 금지. 단계 통과 시 build+smoke+mount→README 갱신→commit→git push origin dev + git push github dev(Gitea·GitHub 둘 다 필수).

---
[← 계획 인덱스](README.md)
