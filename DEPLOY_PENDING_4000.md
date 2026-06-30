# 운영(4000) 반영 대기 목록 — Pending deploy to production

> **목적**: `dev`(4020)에는 있지만 **운영 `D:\2026\PROGRAM\HydroNet`(브랜치 `main`, 포트 4000)** 에 아직 반영 안 된 변경을 추적한다. 전무님이 4000 서버를 사용 중 → 사용자 요청 시 한 번에 배포.

## ⏳ 대기 (2026-06-30 — 클라이언트 전용, dist 스왑)
- **마일스톤 4대 개선** — 모두 **클라이언트 변경**(서버 무변경): ① **표시 기간 팝업**(마일스톤 상단 연/월 클릭 → 시작~종료 월 지정, 그 구간만 정확히 표시·자동 초기화) ② **도면 제목/CI → CI만**(인스펙터에선 CI만, 제목은 차트 클릭→텍스트 탭에서 표시ON/OFF·글꼴·크기·색) ③ **속성 4탭**(도면·프로젝트/텍스트/공정/연결, 차트 클릭 시 자동 전환) ④ **예정공정표↔마일스톤 라이브 연동(옵트인)**(시공 마일스톤 시트에서 예정 공종/공정을 같은 공종 아래로 함께 표시·표시전용, 🔗 행 스위치로 마일스톤에서만 개별 숨김, 예정 원본 불변). `model/layout/store/ChartSvg/ChartCanvas/Inspector/Sidebar/index.css` 변경 + 신규 `engine/mirror.ts`.
- **반영 방법**: `cd client && npm run build` → `client/dist` 스왑(robocopy /E, 백업). 서버 재시작 불필요. 단일 HTML은 새 `HydroNet.html` 전달. 검증: tsc·smoke(표시기간·미러 19검사 추가)·mount·build·build:single·check-single·render-preview(샘플 불변) 통과.

## ⏳ 대기 (2026-06-23 — 클라이언트 전용, dist 스왑)
- **CPM·인터랙션 8건** — 모두 **클라이언트 변경**(서버 무변경): ① 지연일수(lag) FS/SS/FF/SF 정확 양방향 스냅 ② 화살표/막대 드래그 시 화면 가장자리 자동 스크롤(화면 밖 공종 도달) ③ DUMMY 막대(공종색 60% 투명 — 우클릭/인스펙터 명시 + 같은 줄 공정 사이 빈구간 자동) ④ 공정 다중선택(Ctrl/⌘+클릭 + 빈 곳 드래그 마키) → 수평 그룹 이동 ⑤ Z 줌모드 제거 → **Ctrl+휠 줌**(브라우저 페이지 줌 차단, 차트만) ⑥ 한 막대로 들어오는 화살표 중심 수렴(fan-out 제거). `scheduling/routing/store/ChartSvg/ChartCanvas/Inspector/ScheduleModule/ViewBar/HelpDialog/index.css` 변경.
- **반영 방법**: `cd client && npm run build` → `client/dist` 스왑(robocopy /E, 백업). 서버 재시작 불필요. 단일 HTML은 새 `HydroNet.html` 전달. 검증: tsc·smoke·mount·build·build:single·check-single 통과.

## ⏳ 대기 (2026-06-22b — 클라이언트 전용, dist 스왑)
- **마일스톤 화살표 클릭 개선 + 간단/전문가 토글 제거** — 모두 **클라이언트 변경**(서버 무변경): ① 의존성 화살표를 투명 14px 히트 path(`pointer-events:stroke`)로 감싸 **클릭이 잘 잡히게**(파선/점선 빈칸·마일스톤 화살표 포함) ② 보기 막대의 **간단/전문가 모드 제거** → 그 자리에 **Z·H 단축키 안내**, `uiMode`는 'pro' 고정(고급 기능 항상 노출). `ChartSvg`·`ViewBar`·`index.css`·`store.ts`·`HelpDialog` 변경.
- **반영 방법**: `cd client && npm run build` → `client/dist` 스왑(robocopy /E, 백업). 서버 재시작 불필요. 단일 HTML은 새 `HydroNet.html` 전달. 검증: tsc·smoke·mount·build·build:single·check-single 통과.

## ⏳ 대기 (2026-06-22 — 클라이언트 전용, dist 스왑)
- **시설물 유형 프리셋 + 한 줄 패키지 + 화살표 편집 + 시트 이름 등 사용자 요청 6건** — 모두 **클라이언트 변경**(서버 무변경): ① 시트별 도면 제목 + 시트 탭 더블클릭 rename ② 공종 복붙을 선택 공종 바로 뒤에 삽입 ③ 다중 공종 동시 드래그 이동 ④ 새 사업 창 **시설물 유형 선택**(9종) + 유형별 예정공정표·시공 마일스톤 프리셋(기존 고정 6 건설마일스톤 제거) ⑤ `Task.row`로 한 줄에 여러 공정(굴착→축조→슬라브→충수) + 화살표 옆/아래 라우팅 + **선 스타일(실선/파선/점선)** 편집 ⑥ 양수발전 영상 기반 샘플. 신규 `data/facilities.ts`, 딥리서치 `RESEARCH_facility_packages.json`.
- **반영 방법**: 위와 동일(`npm run build` → `client/dist` 스왑, 서버 재시작 불필요). 단일 HTML 배포 시 새 `HydroNet.html` 전달. 검증: tsc·smoke·mount·build·build:single·check-single 통과.

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
