# HydroNet — 개발 메모리 / 세션 핸드오프

> 새 Claude 세션은 이 파일을 먼저 읽고 작업을 이어가세요. (요약본은 `CLAUDE.md`)
> 마지막 갱신 기준 브랜치: `dev`.

---

## 0. 가장 중요 — 폴더 / 브랜치 / 포트 구조

| 구분 | 경로 | 브랜치 | 포트 | 상태 |
|---|---|---|---|---|
| **운영(production)** | `D:\2026\PROGRAM\HydroNet` | `main` | **4000** | 전무님이 서버 가동 중 — **절대 수정·재시작 금지** |
| **개발(dev) ← 여기서 작업** | `D:\2026\PROGRAM\HydroNET_dev` | `dev` | **4020** | 모든 수정·검증·커밋·푸시는 여기서 |

- 두 폴더는 **같은 GitHub 원격**을 공유: `https://github.com/hjlee624/HydroNet.git`
- **개발은 `dev` 브랜치에 푸시**(`git push origin dev`). `main`은 운영 라인(동결).
- dev 서버 테스트 시 **반드시 포트 4020**(또는 그 외, 절대 4000 아님). 운영 4000을 점유/종료하지 말 것.
- 운영 반영이 필요하면: 운영 PC에서 `git pull` 후 재빌드/재시작(전무님과 협의). 운영 launcher는 `set PORT=4000`으로 포트를 강제하므로 dev 기본값(4020)과 무관하게 4000 유지.
- **운영(4000) 반영은 사용자 명시 요청 시에만, 한 번에**(2026-06-11 지시). 그 전까지 모든 변경은 dev/4020에만 반영하고, 운영 반영 대기 항목은 **`DEPLOY_PENDING_4000.md`** 에 누적 기록 → 요청("운영 반영 ㄱ") 시 클라 전용은 dist 스왑(빌드→`.bak`→robocopy /E, 무재시작)으로 일괄 배포, 서버 코드 변경분만 재시작 협의.

---

## 1. 프로젝트 개요
**HydroNet** — 댐·양수발전 시공~시운전 **마일스톤(공정표) 관리 풀스택 웹앱**. 공종별 바차트 + 의존성 화살표(CPM 주공정) + 우기 음영 + A4~A0 벡터 출력(PNG/JPG/PDF/SVG). 기본 샘플은 `DESIGN/milestone sample.png`를 재현.
- 경량 설계(모든 연산 클라이언트) → 추후 **Electron `.exe`** 패키징 목표.
- 원 요구사항: `plan.md`, 디자인 토큰: `Design.md`(Mistral 에디토리얼 — cream/orange), 절대원칙: `ABS_RULE.md`.

## 2. 기술 스택
- **client**: React 18 + Vite + TypeScript + **zustand**, SVG 직접 렌더(외부 차트 라이브러리 없음), **jspdf**(PDF), nanoid.
- **server**: Express(Node, 순수 JS ESM). 파일 기반 프로젝트 저장 + 중앙 `error.log` + `/fonts` 서빙.
- 글꼴: **KoPubWorld Dotum_Pro**(제목·공종 Bold, 나머지 Medium), 폴백 Malgun Gothic.

## 3. 핵심 파일 맵
```
client/src/
  types/model.ts        도메인 타입(Project/Task/Link/Category/RainySeason/PaperSettings/ViewSettings/Branding/LogoItem)
  engine/               순수 로직(DOM 비의존)
    scheduling.ts        CPM(ES/EF/LS/LF/float/critical), applyCascade(위반만 push), reschedule(최조기), 순환 안전
    layout.ts            좌표/레인 스태킹/타임라인/우기/타이틀밴드/푸터(CI)/도메인 px
    routing.ts           의존성 화살표 직교 라우팅(+arrowhead)
    paper.ts             A4~A0 mm/px, DPI clamp(과대 래스터 방지)
    dates.ts             날짜 ↔ day offset
  state/
    store.ts             zustand 스토어(전 액션, undo/redo, 자동저장, normalize, withSchedule)
    api.ts               저장/로드(서버 → 실패 시 localStorage 폴백)
    logger.ts            클라 오류 → POST /api/log → error.log
  components/            ChartSvg, ChartCanvas, TopBar, Sidebar, Inspector, ExportDialog, StatusBar, Resizer,
                         ViewBar(필터·색상·간단/전문가), TemplateDialog(새 도면 갤러리), HelpDialog, LoadDialog, RecalcModal, Modal
  export/exporter.ts     SVG/PNG/JPG/PDF, data-export-hide 제거, 폰트 스타일 주입
  data/sampleProject.ts  기본 샘플(=milestone sample.png), createSampleProject()는 applyCascade로 일관화
  data/templates.ts      새 도면 템플릿(댐/양수발전/간단/빈) — build()로 Project 생성, applyCascade로 일관화
  data/ciLogo.ts         DESIGN/CI_Saman.gif → data URL(번들 임베드)
  styles/                theme.ts(토큰), index.css(@font-face, 전역)
  scripts/               smoke.ts(엔진), mount-test.ts(jsdom 전체앱), render-preview.ts(resvg 이미지)
server/src/index.js      Express(파일저장+error.log+/fonts+SPA), 0.0.0.0 바인딩, LAN IP 출력
client/public/fonts/     KoPub OTF를 여기 넣으면 화면 적용(README.txt 참고)
start-lan.bat            LAN 단일포트 서버 기동(기본 PORT=4020, 외부 PORT env로 override 가능)
```

## 4. 구현 완료 기능
- 공종(12종)·공정·마일스톤(◆), 시운전 토글, **우기 음영 밴드(일 단위)**.
- **우기 일 단위 + 드래그**: RainySeason에 startDay/endDay. layout이 연도별 1렉트(월/일 윈도우, 연경계 wrap, 도메인 클립). RainyRect에 seasonId/startX/endX/showStart/showEnd. ChartSvg에 .rainy-grip(투명 fill 속성+호버, data-export-hide, 태스크 뒤가 아니라 위 레이어). ChartCanvas 'rainy' 드래그→x를 날짜로→day-of-year 클램프→setRainySeason 패치(공유 month/day라 모든 해 동시 이동). dates.ts monthDayToDoy/doyToMonthDay(2001 기준).
- **자동 임시저장 + 불러오기**: 서버 `/api/autosave`(POST 저장=safeName(name).json, GET 목록, GET/DELETE file/:name). AUTOSAVE_DIR=resolveAutosaveDir(HN_AUTOSAVE_DIR→**C:\ProgramData\HydroNET(기본)**→~/HydroNET→server/data 중 첫 쓰기가능). ProgramData=계정명 무관 고정경로·관리자 불필요·Windows 공용 앱데이터 표준(실측: 일반권한 쓰기 OK). C:\Program Files는 관리자 필요해 제외. ~/HydroNET은 계정명(saman 등)이 들어가 PC마다 달라지는 문제로 기본에서 빠짐(2026-06-11 사용자 지적). 실제 경로는 /api/autosave 응답 dir로 불러오기 창에 표시. **서버 코드라 운영 4000/4020 반영엔 서버 재시작 필요**. **서버 코드 변경이라 운영 4000 반영엔 서버 재시작 필요**(클라만 dist 스왑으론 엔드포인트 없음→api.ts가 /api/projects로 폴백). client autosaveProject는 serverOk 안 건드림(구버전 서버 404로 주저장 안 깨지게). save()가 autosave 동시 호출. 파일명=프로젝트명, 확장자 .json 권장.
- **사이드바 접기(collapsed)는 사이드바 트리 전용** — layout은 collapsed 무시(레인 항상 전체). 차트 표시/숨김은 별개의 `hidden`로.
- **공정 수직 배치 = 배열 순서(2026-06-11 변경)**: 예전엔 시간 안 겹치면 한 줄에 압축(`stackTasks`)했으나, 사용자 요청으로 **공정마다 한 줄**(배열 순서)로 전환 → 도면이 더 길어짐(표준 간트형). 순서를 바꾸려면 `reorderTask`로 배열을 splice. 새 공정은 `addTask`가 배열 끝에 push → 해당 레인 최하단에 추가됨.
- **출력 여백 = 종횡비 문제**: exporter는 `Math.min(targetW/W, targetH/H)` 레터박스(가운데정렬)라 여백 0 ⟺ `contentW/contentH == paperW/paperH`. 그래서 `fitToPaper`는 절대 크기가 아니라 **종횡비만** 맞춤(부족한 축 밀도만 상향, 압축 X). **공정 추가/규격 변경 시 다시 어긋나므로 재적용 필요**(현재 (b) 수동 버튼; (a) 라이브 자동은 추후). marginMm는 export에서 미사용(꽉 채움 기준=전체 시트).
- **칸이 글자에 맞춰 자동 확대(2026-06-11)**: 예전엔 `titleHeight`/`headerHeight`/`rowHeight`/`headerInset`가 고정 상수라 글자(특히 제목)를 키우면 칸은 그대로 → 글자만 커져 **잘림**(제목은 용지 상단 밖으로). 이제 `computeLayout`이 `resolveTextStyle`로 해석한 글자 크기에 맞춰 이 칸들을 `max(기존상수, 글자기반)`으로 키움. **기본값(fontScale 1·override 없음)에선 기존 상수와 동일**(샘플 1748×1546 불변, smoke가 검증). 주의: rowHeight가 fontScale에 의존 → `fitToPaperView`의 글자 자동확대와 양의 피드백이 있으나 differ-guard+clamp[1,6]로 **수렴**(현실적 ~40행은 1클릭, 100행+ 병적 케이스만 몇 클릭 후 clamp). 좌측 라벨 **폭**은 미적용(가로 overflow는 SVG라 잘림 아님·겹침일 뿐). layout.ts가 theme.ts(resolveTextStyle)를 import — 순환 없음.
- **좌측 라벨 폭·공사일수·DXF 구분선(2026-06-11)**: (3가지) ① **labelWidth 반응형** — computeLayout이 `estimateTextWidth`(CJK 1em·Latin 0.56em)로 가장 긴 공종/세부공종/헤더 라벨 폭을 재서 `labelWidth=max(view.labelWidth, …)`. 글자 커져도 공종명·"공종/마일스톤" 헤더가 차트/타임라인 침범 안 함. 기본값에선 150 유지(샘플 1748 불변). labelWidth가 contentWidth에 들어가 fontScale→labelWidth 피드백 발생 → **`fitToPaperView`를 4회 반복 고정점 수렴**으로 변경(단일 패스는 portrait에서 ~2% 여백 재발 — 적대적 리뷰 지적). 각 패스가 현재 geometry로 종횡비 정확히 맞추고 fontScale 재산정 → landscape 0%·portrait ~1-2% 잔여(허용). Inspector canFit/store no-op은 최종 diff로 판정. ② **공사 일수(duration)** ChartSvg+dxf 둘 다 `y=lt.y+lt.h + fs(taskDuration)*0.85 + 3`(고정 +10.5 → 글자 비례, 막대 아래 유지). ③ **DXF 구분선 parity** — 프리뷰에만 있던 제목↔헤더·연도↔월·헤더↔차트 구분선 + 헤더 월 눈금 + **외곽 테두리(closed polyline)**를 dxf.ts에 추가, ChartSvg에도 외곽 테두리 rect 추가(둘 다 동일). dxf-check LINE 51→89, SEQEND 46→47.
- **표시 ON/OFF**(Category.hidden·Task.hidden): 사이드바 행별 스위치 + 헤더 전체 스위치(setAllVisible). layout/StatusBar에서 hidden 필터(차트·출력에서 제외, 사이드바엔 흐리게 유지). CPM은 전체 기준으로 계산(hidden은 렌더 필터일 뿐).
- **공정 순서·공종 드래그 이동(사이드바+도면 동기, 2026-06-11)**: **차트는 공정마다 한 줄**(array order). layout.ts가 `stackTasks`(시간 압축) 폐기 → `catTasks.forEach((t,row)=>…)` 한 줄씩, 세부공종 라벨은 **연속 같은 subName 런**으로 그룹. 공유 순서 = `project.tasks` 배열 순서(사이드바·차트 둘 다 이 순서로 렌더 → 자동 동기). 스토어 `reorderTask(id, targetCatId, beforeId|null, {history})`가 배열 splice(beforeId 앞에 삽입, null=레인 끝, cascade:false). 사이드바: .cat__task에 onDragOver(상/하반부로 before/after 판정→dropAt 표시선)·onDrop(beforeId 계산), 레인 본문 드롭=끝으로. 차트: 바 move 드래그가 좌우=setTaskStartLive(일정), 위아래=`computeReorderTarget(y)`(레인 밴드+행 위치)로 드롭 시 reorderTask(history:false, 같은 제스처). 점선 안내선 .reorder-line은 .paper(absolute) 안에 렌더. **필터 활성 시 차트 reorder는 비활성**(서브셋이라 행 계산 모호).
- **주공정 수동 지정**(Task.forceCritical: undefined=자동/true=지정/false=제외): withSchedule에서 `critical = forceCritical===undefined ? computed : forceCritical`. CPM es/ef/float는 그대로 계산. 차트에서 주공정 마일스톤 확대+빨강 헤일로+빨강 라벨, 주공정 공정명 빨강.
- **세부공종(Task.subName)** — 레인 내 subName으로 그룹화→좌측 라벨열에 공종명 아래 세부공종 행 표시. 그룹 정렬은 cascade 후 시작일 순. 공종명 겹침 방지용 레인 상단 `CATEGORY_HEADER_INSET=20px`(named 그룹 있을 때만). 샘플 가물막이에 상류/하류 가물막이·유수전환 시드.
- 드래그: 바 이동, **바 양끝 핸들로 기간 리사이즈**, 끝점 ●로 의존성 연결.
- CPM 주공정(빨강) 실시간, 연쇄 자동/일정 정렬/재계산. **재계산·일정정렬 시 변경 내역(시작일 이전→이후, Δ일) 중앙 팝업**(store.recalcReport → RecalcModal, Modal 컴포넌트).
- **텍스트 역할별 스타일**(view.textStyles: Partial<Record<TextRole, {fontSize,fontFamily,color}>>) — 차트 모든 텍스트 클릭→우측 TextStyleInspector에서 pt/글꼴/색 조정. 기본값·라벨·글꼴옵션·resolveTextStyle은 `styles/theme.ts`. **글꼴은 inline style로 적용**(export 주입 CSS 규칙을 이김, §7 P2). 제목 크기는 ProjectInspector에 pt 입력도 제공.
- **색상 즐겨찾기 팔레트**(Project.palette, PALETTE_MAX=10) — TaskInspector 색상/종료일 아래 5×2, ＋저장/클릭적용/우클릭삭제, 10 초과 금지.
- 도면: 상단 중앙 **볼드 제목**, 우측 하단 **CI 로고**(도면 위 모서리 드래그로 크기 조절, 인스펙터 ◀▶로 순서변경, ＋업로드).
- 출력: SVG/PNG/JPG/PDF(용지/방향/**DPI 96~600**), `data-export-hide` 오버레이 제거. paper.ts 캡 상향(MAX_PIXEL_AREA 2.4e8, MAX_DIMENSION 16000) → A4~A2 600DPI 원본, 대형은 자동 클램프.
- 패널 좌우 **드래그 리사이즈**(폭 자동저장), **배율 슬라이더+숫자입력**(차트 전체 균일 줌, CSS transform), **전체화면 미리보기**(Esc).
- **Photoshop식 캔버스 도구**(store.navMode: edit|zoom|pan): `Z`=줌(휠로 커서 기준 확대/축소 — 휠 후 useLayoutEffect[zoom]에서 scrollLeft/Top 보정), `H`=핸드(드래그 스크롤), `V`/`Esc`=편집 복귀. App 전역 keydown이 navMode 설정(입력중·ctrl/meta/alt 제외). 편집 핸들러는 navMode!=='edit'면 stopPropagation 전에 early-return → pan 핸들러로 버블. 휠은 .canvas-wrap 비-passive 네이티브 리스너로 preventDefault. 상단 배지+커서(zoom-in/grab)로 모드 표시(ChartCanvas는 .canvas-host로 감쌈).
- undo/redo, 자동저장(서버/로컬), 단축키(Ctrl+S/Z/Y, Delete, Esc).
- **도움말 모달**(TopBar **`? 도움말` 어두운 버튼 .btn--dark** → HelpDialog, Modal 재사용): 사용법·마우스 조작·캔버스 도구(Z/H/V/Esc)·단축키 안내. 실기능과 일치하게 유지할 것.
- **DXF(캐드) 출력**(export/dxf.ts: projectToDxf, computeLayout+routeLinks에서 직접 생성). R12(AC1009): HATCH/LWPOLYLINE/핸들 없음 → 막대/채움/화살촉=**SOLID**(Z-순서 3·4점 스왑, 삼각형은 4=3점), 외곽선/마일스톤/화살표=**POLYLINE/VERTEX/SEQEND**(66=1,70 closed), 격자/축=LINE, 텍스트=TEXT(좌측 10/20+72=0, 중앙 72=1+11/21), 색=ACI 근사(62), 공종별 레이어. **Y-up이라 fy=H-y 뒤집기**. routing.ts RoutedLink에 points[] 추가. ExportDialog가 dxf는 SVG 거치지 않고 projectToDxf→다운로드(조기 return). scripts/dxf-check.ts로 구조 검증. 한글 렌더는 CAD 폰트 의존(완벽 편집은 SVG→일러). DWG=DXF→AutoCAD저장, AI=SVG 대체.
- **빠른개선 4종(2026-06-11, 로드맵 quick-win)**:
  1. **보기 막대(ViewBar) — 필터·색상·오늘선**: store에 `filter{critical,milestone,query}`·`colorMode('category'|'critical')`·`uiMode('simple'|'pro')` 추가(colorMode/uiMode는 localStorage 스티키). `computeLayout(project, filter?)`가 `matchesFilter`로 비매칭 task 제외 + **빈 레인 드롭**(filterOn일 때만). `filterActive(f)` 헬퍼 export. ViewBar 칩(주공정만/마일스톤만)+이름검색+필터해제, 색상 세그(공종색/주공정 강조), 보기 세그(간단/전문가). ChartCanvas가 todayX(시작일 기준 오늘 day→x, 도메인 안일 때만) 계산→ChartSvg가 **오늘 세로선(data-export-hide)**. Sidebar도 동일 matchesFilter로 목록 추림.
  2. **인라인 이름 편집 + 더블클릭 빠른추가**: ChartCanvas onTaskDoubleClick→`editing` state→`.paper` 안 `<input.inline-rename>`(콘텐츠 좌표, CSS scale 따라감). Enter/blur=updateTask(name)(renameDone ref로 중복커밋 차단), Esc=취소. onPaperDoubleClick=빈 레인 더블클릭→addTask(cat,{start,duration:30})→바로 인라인. **필터 활성 시 빠른추가 차단**(non-match task는 model에서 빠져 editLt=null→rename 박스 안뜸·유령 task 방지).
  3. **새 도면 템플릿 갤러리**: TopBar `＋ 새 도면`→TemplateDialog(.tpl-grid/.tpl-card)→pick=setProject(make())+save(). templates.ts: 댐(=sample), 양수발전, 간단, 빈.
  4. **간단/전문가 모드(점진적 노출)**: uiMode. 간단은 고급 숨김 — TopBar 일정정렬/재계산, Export **SVG/DXF·DPI>300**, Inspector 주공정(forceCritical) select.
- **여백 없이 시트에 맞추기(2026-06-11)**: 래스터화(`exporter.rasterize`)가 `Math.min` 레터박스라 도면:용지 종횡비 다르면 여백. `fitToPaperView(project, wMm, hMm)`(engine/layout)가 computeLayout 후 **부족한 축만 상향**: current<target → `pxPerDay` 상향(시간축 widen), 아니면 `rowHeight` 상향(행 키움). content 크기가 각 knob에 affine이라 역산 정확(압축 안 함 → 가독성 유지). 스토어 `fitToPaper()`(history:true)가 `paperMm`로 종횡비 구해 setView. ExportDialog에 `⤢ 여백 없이 시트에 맞추기` 버튼 + 종횡비 차이% 안내(computeLayout로 reactive). **비율만 맞추면 여백 0**(절대크기는 어차피 DPI로 스케일). smoke에 종횡비 일치 검증 추가. 사용자 결정: **(b) 수동 버튼 방식부터**, 추후 (a) 편집화면=시트 라이브 자동맞춤으로 확장. 기본 규격 A1 가로 권장.
- **규격별 글자 크기 + 라이브 용지 막대(2026-06-11)**: 큰 용지에 채우면 글자가 상대적으로 작아져 **출력 시 글자 안 보임** → `view.fontScale`(기본 1) 전역 배율 도입. `resolveTextStyle(role, ovr, fontScale=1)`이 fontSize에 곱함(ChartSvg `roleAttrs`·DXF `ts()` 둘 다 `project.view.fontScale ?? 1` 전달, **Inspector는 미전달=설계 pt 유지**). `fitToPaperView`가 `contentWidthAfter/paperWmm`로 기준주석(taskName 10.5px)을 ~3.5mm에 맞춰 `fontScale=clamp(…,1,6)` 산정 — **확대 전용**(정상 도면은 안 줄임, 현재값과 다를 때만 반환). 컨트롤 위치는 **우측 Inspector `ProjectInspector` '도면/용지' 구간**(2026-06-11 이동, 하단 PaperBar는 제거 — 차트 세로공간 확보): 용지/방향(`setSheet`=beginGesture+setPaper+fitToPaper, 1회 undo), 글자크기 슬라이더(50~600%→`setView({fontScale})`), 여백%/맞춤 버튼(computeLayout로 offPct). `fitToPaper`는 history:false. **사이드바의 밀도(px/일)·출력 DPI 입력은 제거**(pxPerDay는 맞춤이 자동관리, DPI는 ExportDialog에서만). **computeLayout는 더 이상 텍스트 폭을 측정 안 하므로 fontScale↔레이아웃 기하 무관**(렌더만).
- LAN 접속(서버 0.0.0.0, 빌드본+API 단일포트), `error.log`(ABS_RULE).
- **건설사업관리 패키지 셸(2026-06-12, dev)**: `App.tsx`가 모듈 셸로 전환 — 좌측 `ModuleRail`(카테고리 전환, `state/shell.ts` zustand+localStorage, 전체화면 땐 숨김) + 활성 모듈 콘텐츠. 기존 마일스톤 편집기 전체는 **`components/ScheduleModule.tsx`(백본)** 로 추출(App 본문 그대로 이동, 단축키/전체화면 포함). 신규 **`Dashboard`**(useEditor 실데이터 KPI: 총공기·착수/준공·시간경과%·공정/마일스톤·주공정·우기 + 다가오는 마일스톤 + 모듈 바로가기). 나머지 카테고리(진척·원가·자원·품질·안전·문서·인허가·시운전·리스크·보고)는 **`ModulePlaceholder`**(들어갈 내용 안내). 모듈 정의 = `data/modules.ts`(MODULES/GROUPS/MODULE_MAP, status ready|soon). **기본 진입 = 대시보드**(localStorage 기억). 큰 틀 문서 = **`PACKAGE_PLAN.md`**. mount-test는 module=schedule로 차트 검증 + 대시보드 검증.
- **단일 HTML 배포(2026-06-12)**: `npm run build:single`(client) → 저장소 루트 `HydroNet.html`(~19.5MB) 한 파일. 더블클릭(file://)으로 편집·모든 출력 동작, 저장은 localStorage 폴백(api.ts 설계). 파이프라인: vite-plugin-singlefile + `SINGLE=1`(vite.config, **rollup format:iife** + outDir dist-single) → `scripts/build-single.ts`가 (a) KoPub OTF(public/fonts, gitignore)를 base64로 `@font-face url()`에 내장(spaces %20 인코딩 주의), (b) **진입 스크립트를 type=module→classic <script>로 바꿔 `</body>` 직전으로 이동**(인라인 module은 file:// 막힐 수 있고, 인라인 classic은 즉시 실행돼 #root보다 먼저면 React #299 → body 끝으로 옮겨 해결), (c) String.replace는 **함수 인자**로($ 패턴 깨짐 방지). `scripts/check-single.ts`(jsdom, http origin)로 마운트 검증. App.tsx의 localStorage 접근은 try/catch 가드(잠긴 브라우저/opaque origin 대비). gitignore: `client/public/fonts/*.otf`·`/HydroNet.html`·`dist-single/`.

## 5. 실행 / 검증 명령 (dev 폴더에서)
```bash
# 개발(클라 5173 + API 4020 프록시)
cd D:\2026\PROGRAM\HydroNET_dev && npm run dev
# LAN/단일포트(빌드본 서빙, 기본 4020)
start-lan.bat
# 검증
cd client && npx tsx scripts/smoke.ts          # 엔진 무결성
cd client && npx tsx scripts/mount-test.ts      # jsdom 전체앱 마운트(빈화면 회귀 방지)
cd client && npx tsx scripts/render-preview.ts  # preview.png 생성(HN_SELECT=t-ct3 로 선택상태)
cd client && npm run build                       # tsc --noEmit + vite
```
> dev 서버를 직접 띄워 확인할 땐 운영(4000)과 겹치지 않게 4020(또는 그 외) 사용. PID를 추적해 본인이 띄운 프로세스만 종료할 것.

## 6. 작업 절차(ABS_RULE 준수)
1. dev 폴더에서 수정 → 2. `npm run build` + smoke + mount 통과 확인 → 3. 주요 변경 시 **README.md 갱신** →
4. `git add -A && git commit` → 5. **`git push origin dev`** → 6. 동기화 확인.
- 모든 오류는 `error.log`에 남도록 유지(식별된 오류는 수정 후 재발 방지).

## 7. 반드시 기억할 함정(교훈)
- **빈 화면(블랙스크린)**: zustand v5 selector가 매 렌더 **새 배열/객체 반환** 시 `useSyncExternalStore` 스냅샷 불안정 → 무한 렌더 → 마운트 실패. 셀렉터는 **안정 ref**만 반환하고 파생(`.filter` 등)은 컴포넌트 본문에서. (과거 Sidebar 사례) → `mount-test.ts`가 회귀 방지.
- **폰트는 클라이언트 렌더**: 화면=그 PC에 설치 또는 `/fonts` 번들(서버가 `public/fonts` 직접 서빙→재빌드 불필요). **출력물(PNG/PDF)은 SVG 래스터화 시 OS 설치 폰트만** 사용 → 출력 PC엔 OTF 설치 필요(번들만으론 출력 미보장). 미설치 시 Malgun.
- **내보내기**: 화면 전용 오버레이엔 `data-export-hide="1"` → exporter가 clone에서 제거. SPA catch-all은 확장자 있는 누락 경로에 404(폰트가 HTML로 응답되지 않게).
- **줌**: layout은 기준 배율로 계산, zoom은 `.paper`에 CSS `transform: scale()`. 포인터 좌표는 `/zoom` 역보정(`ChartCanvas.toContent`).
- **CPM**: 바는 항상 `task.start`에 그림. ES는 start로 바닥. applyCascade=위반 공정만 뒤로(슬랙 보존), reschedule=최조기 압축. 샘플은 생성 시 applyCascade로 링크 일관성 확보.
- **배율 입력**: 숫자 input은 로컬 텍스트 상태로 두고 blur/Enter에만 setZoom(매 키 클램프 버그 방지). → 동일 패턴을 Inspector `PtInput`(글자 크기·제목 크기)에도 적용.
- **텍스트 글꼴(export)**: exporter가 `text{font-family:…Medium}` CSS를 주입 → **CSS 규칙이 SVG presentation attribute를 이김**. 그래서 역할별 글꼴은 반드시 **inline `style={{fontFamily}}`** 로 적용해야 출력물(PNG/PDF)에 반영됨(attribute로 주면 출력 시 사라짐). fontSize/fontWeight/fill은 attribute로 OK(주입 규칙이 안 건드림).
- **차트 텍스트 클릭=역할 선택**: 이제 공정/마일스톤의 *이름 텍스트* 클릭은 텍스트 스타일 편집(역할 선택)으로 동작. 공정 *선택*은 바/다이아몬드 클릭 또는 좌측 사이드바로. (의도된 동작 변경)
- **세부공종 레이아웃**: 그룹은 `(subName ?? '').trim()`로 묶고 '' 그룹 우선, 나머지는 min start 순. named 그룹 존재 시 레인 상단 20px 헤더 인셋으로 공종명 분리. 빈 그룹 `Math.max(...[])` 회피(그룹은 항상 ≥1 task).
- **TS 빌드**: 단일 tsconfig + `tsc --noEmit`(프로젝트 레퍼런스 X). zustand는 `create<T>()(...)` 커리드 형태. React 이벤트 타입은 `import type { PointerEvent as RPointerEvent }`로(UMD 전역 회피).
- **필터(view filter)는 전역 부작용 주의**(2026-06-11 적대적 리뷰 6건 수정): ① **출력은 항상 전체 도면** — 래스터(PNG/JPG/PDF/SVG)는 화면 SVG를 clone하므로 필터가 켜져 있으면 **부분 도면**이 나감. DXF는 projectToDxf(project)라 원래 전체. 정책 통일: ExportDialog가 export 전 `clearFilter()`(+selectTask(null))하고 finally에서 원복 → 모든 포맷=전체. ② **빈 레인 더블클릭 빠른추가**는 필터 활성 시 차단(위 §4-2). ③ **colorMode 'critical'는 `showCriticalPath`(주공정 표시 체크)와 독립**이어야 함 — ChartSvg에서 `crit = showCriticalPath && lt.critical`만 쓰면 주공정 표시를 끄면 전 바가 회색됨. **`emphasizeCrit = colorMode==='critical' ? lt.critical : crit`** 를 색/이름강조/막대테두리/마일스톤 fill에 사용(헤일로·다이아 확대 등 CP-오버레이 장식만 `crit` 유지). ④ **간단모드 DPI 클램프**: pro에서 600 설정 후 simple 전환 시 `<select>` 값이 옵션에 없어 stale → `effectiveDpi = pro ? dpi : min(dpi,300)`로 select·크기노트·export(paperEff) 모두 일치(영속값은 안 건드림).

## 8. 향후 후보(미구현)
- Electron 패키징(`.exe`, 오프라인). 출력물 폰트 임베딩(base64, 한글 OTF 수 MB 부담). 라벨 충돌 자동 회피. 기상 데이터 우기 자동보정 / 보수보강 전용 타임라인. dev→main 머지·운영 배포 절차.

## 9. 진행 이력(요약)
초기 풀스택 구현 → 멀티에이전트 리뷰 수정(서버 동시쓰기·export 무음실패) → 빈화면 수정 → 도면 제목+CI → 패널리사이즈·전체줌·전체화면·LAN → 배율 컨트롤·바 기간 리사이즈·README 이미지(init.png) → KoPub 글꼴 → 배율입력 버그·CI 드래그크기/순서 → LAN 폰트 번들 서빙 → dev 폴더 분리 + dev 브랜치 + 포트 4020 → **6대 개선(텍스트 역할 스타일 클릭편집·세부공종 좌측라벨·제목 pt입력·재계산 결과 팝업·DPI 600·색상 즐겨찾기 팔레트) + 멀티에이전트 적대적 리뷰** → 도움말 어두운버튼 + **DXF(캐드) 출력**(텍스트 좌측앵커·STYLE/한글 \U+XXXX·SOLID/POLYLINE) → 인기 서비스 비교 딥리서치(improvement-roadmap.md) → **빠른개선 4종(보기 필터·색상·오늘선 / 인라인 이름편집·더블클릭 빠른추가 / 새 도면 템플릿 갤러리 / 간단·전문가 모드) + 적대적 리뷰 6건 수정**(출력=전체도면 통일·colorMode 독립·DPI 클램프·필터 빠른추가 차단·Help 갱신) → seg 라벨 박스 넘침 수정(.seg.seg--sm 특이도) + 운영 반영 대기 문서(DEPLOY_PENDING_4000.md) → **공정 순서 드래그 재배치(공정마다 한 줄 · 사이드바↔도면 동기 · reorderTask)** → **출력 여백 제거(fitToPaper: 도면 종횡비를 용지에 맞춰 채움 · ExportDialog 버튼)** → **규격별 글자 크기(view.fontScale, 확대 전용) + 도면 아래 라이브 용지 막대(PaperBar: 용지·방향·글자크기·맞춤)**.
