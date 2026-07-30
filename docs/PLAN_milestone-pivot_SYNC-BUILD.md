# HydroNet 마일스톤 전용 전환 — SYNC-BUILD 이관 계획

> 2026-07-30 작성. **이관(SYNC-BUILD로) 먼저 → 그다음 HydroNet 제거.** 이 문서는 계획이며, 실제 실행은 사용자 승인 후.
> 대상 모노레포: **SYNC-BUILD**(`github.com/hjlee624/SYNC-BUILD`, turbo + npm workspaces, `apps/*`·`packages/*`·`services/*`).
> 배경: [memory: milestone-only pivot]. HydroNet = 마일스톤 편집 전용, 비-공정(대시보드·CM 모듈)은 SYNC-BUILD로.

## 1. 이관 위치 (targetHome)
- **`apps/web`** — CM UI를 `apps/web/src/components/cm/`에 이식 + shared `PIPELINE_STEPS`에 새 `StepId 'cm'` 추가(기존 단일 앱 셸/StageShell 재사용). 별도 SPA 신설 안 함.
- **`packages/cm-core`(신규)** — 순수 도메인(`kpis.ts`·`modules.ts`·`ModuleRecord/Baseline` 타입)을 무빌드 공용 패키지로(`exports '.'→src/index.ts`, 기존 shared 패턴).
- 신규 `apps/cm` SPA 분리는 독립 배포/로그인 경계 신호가 없어 **현재 비권장**.

## 2. 스택 정합 (stackFit)
- **zustand v5 완전 정합**(HydroNet ^5.0.2 ↔ SYNC-BUILD 5.0.14). `state/shell.ts`가 순수 `create()`라 그대로 이식.
- **React 18→19**: 이관 모듈은 순수 함수형 + useState/셀렉터라 breaking 노출 거의 없음(잔여=StrictMode 이중마운트, SYNC-BUILD도 동일 조건).
- **Vite 7→8(Rolldown)**: 이관 모듈은 singlefile·resvg·특수 플러그인 미사용 → 호환.
- **주의**: SYNC-BUILD `tsconfig.base.json`이 `verbatimModuleSyntax:true` + `isolatedModules` + `noUnusedLocals/Params` 강제 → 이관 시 **값/타입 혼합 import를 `import type`로 분리 + 미사용 심볼 정리** 필요.
- Node 엔진: SYNC-BUILD 기준(`>=20`) 따르고 HydroNet의 `>=24<25`·engine-strict는 가져오지 않음.

## 3. 이관 파일 (from → to)
| HydroNet (from) | SYNC-BUILD (to) |
|---|---|
| `engine/kpis.ts` | `packages/cm-core/src/kpis.ts` |
| `data/modules.ts` | `packages/cm-core/src/modules.ts` (`schedule` 항목은 shared StepId와 중복 → CM 모듈만) |
| `model.ts`의 `ModuleRecord`·`Baseline`·`BaselineTask` | `packages/cm-core/src/model.ts` (CM 슬라이스만) |
| `state/shell.ts` | `apps/web/src/state/cmShell.ts` (cm 스텝 서브탭 상태로 축소, localStorage 키 `syncbuild:cm:*`) |
| `components/Dashboard.tsx` | `apps/web/src/components/cm/Dashboard.tsx` |
| `components/ProgressModule.tsx` | `apps/web/src/components/cm/ProgressModule.tsx` |
| `components/ReportModule.tsx` | `apps/web/src/components/cm/ReportModule.tsx` (SYNC-BUILD `report` 스텝과 통합 여지) |
| `components/RecordModule.tsx` | `apps/web/src/components/cm/RecordModule.tsx` |
| `components/ModuleRail.tsx` | `apps/web/src/components/cm/ModuleRail.tsx` |
| `components/ModulePlaceholder.tsx` | `apps/web/src/components/cm/ModulePlaceholder.tsx` |
| `components/ProjectTypeChooser.tsx` | `apps/web/src/components/cm/…`(임시) — 공정 프리셋 참조라 정석은 `packages/schedule` |

## 4. 공유 코드 분리 (store/model 얽힘)
- **store.ts CM 액션 6종** → SYNC-BUILD `cmStore.ts`(zustand)로 이관, Project는 읽기전용 인자화:
  - `addModuleRecord/updateModuleRecord/deleteModuleRecord`(store.ts:229-231, 841-867)
  - `setTaskProgress`(225-226, 832-839), `captureBaseline/clearBaseline`(233-234, 869-895)
  - 전부 `history:false` → undo·재계산 무영향.
- **model.ts** `ModuleRecord/Baseline/BaselineTask` + `Project.modules/baseline` + `Task.progress` → cm-core로. 전부 optional·normalize 미처리라 Project에서 떼도 커밋/재계산 경로 무수정.
- **`Task.progress`**: `progressByTaskId: Record<ID,number>` 맵으로 분리가 깨끗(단 저장파일 마이그레이션 필요) / optional 잔존도 무해.
- `data/templates.ts`(KIND_META·makeProject·PROJECT_TYPES)·`facilities.ts`(FACILITY_TYPES)는 **공정 자산** → 정석은 `packages/schedule`, CM은 라벨(KIND_META)만 필요.
- `Modal.tsx`·`logger.ts`는 양쪽 각각 보유(복제/치환).

## 5. HydroNet 제거·재배선
- `App.tsx` → **ScheduleModule 단일 루트**(ModuleRail/Dashboard/…/MODULE_MAP/useShell import·switch 삭제).
- `store.ts` CM 액션 6종 삭제(파이프라인 유지).
- 참조 끊긴 파일 물리 삭제: `Dashboard/ModuleRail/Progress/Report/Record/ModulePlaceholder`, `state/shell.ts`, `data/modules.ts`, `engine/kpis.ts`.
- `model.ts` CM 타입·필드 제거(선택·후속), `index.css` CM 규칙 정리(선택), `ProjectTypeChooser` 재배선 or 삭제(결정 필요).

## 6. 실행 순서 (이관 → 제거)
0. **(비파괴)** SYNC-BUILD에 `packages/cm-core` 워크스페이스 신설(package.json/tsconfig/src/index.ts).
1. **이관·도메인**: `kpis.ts`·`modules.ts`·CM 타입 → cm-core(상대경로·`import type`·미사용 정리). ✔ `turbo typecheck --filter=@sync-build/cm-core`
2. **이관·상태**: `apps/web/src/state`에 `cmStore.ts`·`cmShell.ts`. ✔ apps/web typecheck
3. **이관·UI**: CM 컴포넌트 → `apps/web/src/components/cm/` + 새 `StepId 'cm'`. ✔ biome + typecheck + build + dev 육안
4. **제거·재배선(HydroNet)**: App 축소, store CM 액션 삭제(참조만 끊기). ✔ build+smoke+mount
5. **제거·삭제(HydroNet)**: 파일 물리 삭제, model/css 정리(선택). ✔ build+smoke+mount (+build:single·check-single)
6. **마감**: 양쪽 README/PLAN 갱신. HydroNet **commit → `git push origin dev` + `git push github dev`(둘 다)**. SYNC-BUILD 자체 규약.

## 7. 리스크
- verbatimModuleSyntax + noUnusedLocals → 이관 시 대량 typecheck 에러(파일 단위 `import type` 분리·미사용 정리로 대응).
- **Project(공정) 타입 소유권 공백** — `packages/schedule` 미존재 → 임시 최소 타입 필요(드리프트 주의).
- 공정 프리셋(templates/facilities) CM 오분류 위험 → 정석 `packages/schedule`.
- `'schedule'` 이중 정의(SYNC-BUILD PIPELINE_STEPS vs modules.ts) → 계약 명확화.
- **`Task.progress` 제거 시 기존 .json progress 유실** — normalize 마이그레이션 없으면 데이터 손실(optional 잔존으로 완화 가능).
- **운영 폴더(`D:/2026/PROGRAM/HydroNet`, main, 4000) 절대 미접촉** — 작업은 dev(4020)·SYNC-BUILD만, 충돌 없는 포트.
- KEEP 전용 의존(jspdf/@resvg/singlefile) SYNC-BUILD 오이관 금지.

## 8. 결정 필요 (openQuestions)
1. **targetHome**: (a) apps/web 새 `cm` 스텝〔권장〕 vs (b) 기존 `report` 스텝 통합 vs (c) 신규 apps/cm SPA.
2. **Project 타입 소유권**: `packages/schedule` 먼저 이관 vs cm-core 임시 최소 타입 먼저.
3. **공정 프리셋 위치**(templates/facilities/ProjectTypeChooser): packages/schedule vs 임시.
4. **`Task.progress`**: 완전 분리(맵+마이그레이션) vs optional 잔존.
5. **HydroNet '새 사업'(ProjectTypeChooser) 흐름**: 유지(TopBar 재배선) vs 삭제(createSampleProject 부팅).
6. **SYNC-BUILD dev 포트**: 4000/4020 비충돌 확인(현재 apps/web `server.port=5173`).
7. **실행 시작 승인**: 어느 폴더/브랜치에서 언제 착수.
