# 운영(4000) 반영 대기 목록 — Pending deploy to production

> **목적**: `dev`(4020)에는 있지만 **운영 `D:\2026\PROGRAM\HydroNet`(브랜치 `main`, 포트 4000)** 에 아직 반영 안 된 변경을 추적한다. 전무님이 4000 서버를 사용 중 → 사용자 요청 시 한 번에 배포.

## ⏳ 대기 (2026-06-19 — 클라이언트 전용, dist 스왑)
- **사이드바·저장 개편 등 사용자 요청 8건** — 모두 **클라이언트 변경**(서버 코드 무변경): ① 공종 드래그 재배치 ② 공종 삭제(✕) ③ 막대 공기 텍스트 더블클릭 편집(durationLabel) ④ 사이드바 공종·공정 더블클릭 이름수정 ⑤⑥⑦ **자동저장 제거 → 수동 파일 저장/불러오기**(`state/fileIO.ts`, File System Access + 다운로드/파일선택 폴백) ⑧ 공종 다중선택(Ctrl·Shift) + Ctrl+C/V 복붙.
- **반영 방법**: `dev`에서 `cd client && npm run build` 후 `client/dist`를 운영에 `dist` 스왑(robocopy /E, 기존 백업). **서버 재시작 불필요**(엔드포인트 추가 없음). 단일 HTML(`HydroNet.html`) 배포본을 쓰는 경우 dev의 새 `HydroNet.html`을 전달.
- **주의**: 이 변경으로 **서버 자동저장(`/api/autosave`) 사용이 클라에서 제거됨** — 운영도 dist 스왑 시 자동저장 UI가 사라지고 수동 파일 저장으로 통일된다(아래 ‘재시작 대기’ 항목은 사실상 불필요해짐). 검증: tsc·smoke·mount·build·build:single·check-single 전부 통과.

## 현재 상태 (2026-06-12 배포함)
- ✅ **클라이언트 전부 반영 완료(무중단)** — dev 빌드 `index-BfICcB_y.js`를 운영 `client/dist`에 `dist` 스왑(robocopy /E, 백업 `client/dist.bak.20260612`). 운영 4000이 새 클라를 서빙함을 HTTP로 검증(`/`·새 번들·`/api/projects` 모두 200). 서버 무재시작.
- ⏳ **자동저장 서버(`/api/autosave`) — 파일 스테이징 완료, 4000 재시작 대기.** 운영 `server/src/index.js`를 dev 버전으로 교체(백업 `index.js.bak.20260612`, PORT 기본값 4000 유지, 라우트 4개 확인). **단, 운영 서버(PID 40284)는 아직 옛 코드를 메모리에서 구동 중 → `start-lan.bat`로 4000을 재시작해야 자동저장이 켜짐.** (재시작 전까지 클라는 `/api/projects` 폴백으로 정상 동작.)

## 남은 작업 (사용자/전무님)
1. **4000 재시작** — 운영 폴더에서 현재 떠 있는 node 서버(PID 40284)를 종료하고 `start-lan.bat` 더블클릭(또는 실행). 그러면 새 `server/src/index.js`가 로드되어 자동저장/불러오기가 동작. (start-lan.bat이 `set PORT=4000`이라 포트 유지.) — 수 초 중단.
2. 재시작 후 검증: `http://127.0.0.1:4000/api/autosave` 응답이 404가 아니면 OK.

## 운영에 반영하지 **말 것** — dev 전용 인프라
| 항목 | 커밋 | 이유 |
|---|---|---|
| dev 작업 폴더 분리(서버 기본 포트 `4000→4020`, dev `CLAUDE.md`/`memory.md`, vite proxy, `start-lan.bat`) | `e6bb60b` | 운영은 PORT=4000 유지. **dist 스왑/서버 파일 교체 방식이라 이 커밋은 운영에 안 들어감**(git merge 안 함). 서버 파일 교체 시 PORT 기본값만 4000으로 되돌려 적용함. |

> 배포 방식 = **git merge 아님, dist 스왑 + 서버 파일 교체.** 그래서 dev 전용 인프라(e6bb60b)·문서가 운영에 섞이지 않음.

## 반영 완료 이력
- **2026-06-12** — 클라이언트 전체(빠른개선·드래그 재배치·여백 맞춤·글자 크기/칸 자동확대·DXF 구분선/테두리·공사일수/라벨 등 `bc5be1c`~`167eebe` 누적)를 `dist` 스왑으로 운영 반영·검증 완료(무중단). 자동저장 서버 파일은 스테이징 완료(재시작 대기).
