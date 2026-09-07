# 건설사업관리 모듈군 복원 — 설계 문서 (Sequence)

> 상태: **설계(승인 대기)** · 작성 2026-09-07 · 관련 커밋: 옛 정의 제거 = HydroNET `2ffc947`, 복원 대상 = `53210b6`
> 승인 후 단계별 구현. 데이터 동기화 방침: **완전 CRDT 동기화**(사용자 결정).

## 0. 목표

옛 HydroNET "건설사업관리 패키지"(공정 백본 + 11개 모듈)를 지금 Sequence에 **되살려 이식**한다.
단, 옛 앱은 로컬 단일 store였고 지금 Sequence는 **CRDT 협업 · RBAC(조회전용) · 다중 시트**다.
따라서 "그대로 복제"가 아니라 **Sequence 아키텍처(Y.Doc 동기화·권한·시트)에 맞춰 재구현**한다.
방금 복원한 **총괄 대시보드**가 이 데이터들을 EVM·모듈경보로 엮는 허브가 된다.

## 1. 모듈 지도 (8그룹 · 11모듈)

| 그룹 | 모듈(id) | 형태 | 데이터 |
|---|---|---|---|
| 개요 | 대시보드(`dashboard`) | 특수 | 파생(projectKpis) — **이미 구현됨** |
| 공정 | 공정관리(`schedule`) | 특수(편집기) | Project.tasks/links — **기존** |
| 공정 | 진척·실적(`progress`) | 전용 UI | **Task.progress**(0–100) |
| 사업비 | 프로젝트 예산(`cost`) | 기록표 | Project.modules.cost |
| 사업비 | 공사 사업비(`boq`) | 기록표 | Project.modules.boq |
| 자원 | 인력·장비(`resource`) | 기록표 | Project.modules.resource |
| 품질·안전 | 품질·검측(`quality`) | 기록표 | Project.modules.quality |
| 품질·안전 | 안전관리(`safety`) | 기록표 | Project.modules.safety |
| 문서·계약 | 문서·도면(`document`) | 기록표 | Project.modules.document |
| 문서·계약 | 인허가(`permit`) | 기록표 | Project.modules.permit |
| 준공 | 시운전(`commissioning`) | 기록표 | Project.modules.commissioning |
| 관리 | 리스크·이슈(`risk`) | 기록표 | Project.modules.risk |
| 관리 | 보고서(`report`) | 자동집계 | 파생(projectKpis + modules) |

- **기록표 9종**(cost·boq·resource·quality·safety·document·permit·commissioning·risk)은 단일 `RecordModule`이
  `ModuleField` 스키마로 표·입력·자동계산(금액=수량×단가, 잔액=예산−집행)·합계행을 그린다 → 정의만 있으면 한 번에 동작.
- 모듈 정의는 `data/modules.ts`(옛 297줄 그대로 재사용, `ModuleId`·`GROUPS`·`MODULES`·`MODULE_MAP`).

## 2. 데이터 모델 (`client/src/types/model.ts` 추가)

```ts
/** 기록형 모듈의 한 행. values 키는 해당 모듈의 ModuleField[] 스키마를 따른다. */
export interface ModuleRecord { id: ID; values: Record<string, string> }

export interface BaselineTask { id: ID; start: number; duration: number }
export interface Baseline {
  capturedAt: string      // ISO timestamp
  asOf: string            // YYYY-MM-DD
  sheetId?: ID            // 박제 당시 활성 시트 — 다른 시트로 전환하면 표류 비교 무의미해 가림
  startDay: number
  endDay: number
  tasks: BaselineTask[]
}

// Task 에 추가:
//   progress?: number    // 실적 진척률 0–100 (파생 아님 → CRDT로 동기화)
// Project 에 추가:
//   modules?: Record<string, ModuleRecord[]>  // 사업 단위(시트 무관)
//   baseline?: Baseline
```

핵심 불변식:
- `modules`·`baseline` 은 **사업 단위**(시트 전환에도 보존, Sheet에는 없음).
- `Task.progress` 는 **task 단위**(시트별 task마다).
- 모두 optional → 기존 저장분(구버전)과 호환.

## 3. CRDT 설계 — **이 문서의 핵심**

지금 Y.Doc 스키마(`client/src/state/crdt.ts` `bootstrapProjectYTypes`): 최상위 named 타입
`root/meta · view · paper · branding · palette · categories · tasks · links · rainySeasons · sheets`.
서버 시드(`server/src/collab/seed.js`)가 동일 스키마로 인코딩/디코딩. 여기에 **3가지를 추가**한다.

### 3.1 `Task.progress` — 거의 무료 (task 필드)
- task 레코드 Y.Map은 `syncPlainMap(stripTask(task))`로 필드를 동기화한다.
- `stripTask`/서버 `canonicalTask`는 **파생 필드**만 제거: `es·ef·ls·lf·totalFloat·critical·__mirror`.
- `progress`는 파생이 아니므로 **자동 포함·동기화**된다. 모델에 추가 + `DERIVED_TASK_FIELDS`에 넣지 않기만 하면 됨.
- 읽기(`projectFromYDoc` / 서버 `decodeProjectFromState`)도 `record.toJSON()`이라 자동 반영.
- ⇒ **스키마 확장 불필요, 모델 필드 + store 액션만.**

### 3.2 `Project.modules` — 신규 `root/modules` (granular CRDT)
categories/tasks와 동일한 **RecordMap 패턴**을 모듈마다 중첩한다.

```
root/modules : Y.Map< moduleId(string), Y.Map< recordId, Y.Map<field→value, $position> > >
```

- `bootstrapProjectYTypes`: `const modules = doc.getMap('root/modules')` 추가 + `root.set('modules','root/modules')`.
- `applyProjectToYDoc`(쓰기): 모듈별로 `syncRecordCollection(ensureMap(modules, moduleId), records, (r) => r.values)` 재사용.
  기존 레코드/필드는 무변경 → op 없음(2인 동시 편집이 다른 행·필드면 자연 병합).
- `projectFromYDoc`(읽기): `for (const [moduleId, recMap] of modules) modules[moduleId] = orderedModuleRecords(recMap)`.
  `orderedModuleRecords`는 기존 `orderedRecords`의 변형 — **id를 보존**해 `{ id, values }` 반환($position 제거).
- 서버 `seed.js`: `encodeLegacyProject`에 `setModuleRecords(modules, project.modules)` 추가,
  `decodeProjectFromState`(#19에서 추가한 디코더)에 동일 읽기 추가 → 백업/스냅샷에도 모듈 반영.
- 삭제/추가/수정은 **UNTRACKED_ORIGIN**으로 write → 공정표 undo 스택에 안 쌓음(옛 `commit history:false`와 동일 의미).

### 3.3 `Project.baseline` — 신규 `root/baseline`
- `root/baseline` = Y.Map(capturedAt·asOf·sheetId·startDay·endDay 스칼라) + `tasks` Y.Array<{id,start,duration}>.
- `captureBaseline`은 한 트랜잭션으로 원자 기록, `clearBaseline`은 비움. 동시 편집 드묾(스냅샷 성격) → 사실상 last-write-wins 허용.
- 읽기/쓰기 클라·서버 대칭.

### 3.4 하위호환 · 마이그레이션
- 기존 프로젝트(모듈 없음): `root/modules` 빈 Y.Map → 읽기 시 `modules = {}`(또는 undefined). 무해.
- 서버 `encodeEmptyProject` 기본값에 `modules: {}` 추가. `projectYDocIsEmpty`는 modules/baseline을 **판정에서 제외**(빈 모듈이 시드 여부를 바꾸지 않게).
- **collab-smoke에 모듈 라운드트립 단언 추가**(레코드 추가→플러시→재fetch 일치).

## 4. Store 액션 (`client/src/state/store.ts` 추가)

옛 시그니처 그대로, 단 **Y.Doc write + readOnly 가드**로 재구현.

```ts
setTaskProgress(id, progress)              // task Y.Map.progress = clamp(0..100), UNTRACKED_ORIGIN
addModuleRecord(moduleId, values?) : ID    // modules[moduleId] 에 {id:nanoid, values} push
updateModuleRecord(moduleId, id, patch)    // 해당 레코드 values 병합
deleteModuleRecord(moduleId, id)           // 해당 레코드 제거
captureBaseline() / clearBaseline()        // root/baseline 기록/삭제
```

- 모두 `if (get().readOnly) return`(조회전용 사용자 차단) — 차트 편집과 동일 가드.
- 쓰기는 기존 CRDT 쓰기 헬퍼(트랜잭션 + origin)를 통해 → 협업 동기화.

## 5. 네비게이션 — 모듈 레일

현재: `viewStore`(`dashboard`|`schedule`) + AuthBar 토글 + TopBar `📊 총괄` 버튼(방금 구현).
확장: `viewStore` → **`shellStore`**(module: `ModuleId`, localStorage 기억) + **좌측 `ModuleRail`**(그룹별 나열, 전체화면 시 숨김).

- 레일 = `GROUPS` 순서로 섹션, 각 모듈 아이콘+라벨, 활성 하이라이트. `status:'soon'`이나 fields 있는 모듈은 활성.
- 라우팅(App): `dashboard`→DashboardModule, `schedule`→ScheduleModule, `progress`→ProgressModule,
  `report`→ReportModule, 그 외 fields 있으면 `RecordModule`, 없으면 `ModulePlaceholder`.
- AuthBar 토글은 레일로 흡수(또는 축약 유지). 대시보드는 개요 그룹의 기본 진입.
- **조회전용**: 레일·열람 허용, 편집 액션만 비활성.

## 6. 모듈 화면 (옛 UI 이식 + Sequence 디자인)

- **RecordModule**(9종): 스키마 구동 표(#·필드들·삭제), 자동계산 셀, 합계 tfoot, ＋추가/빈상태. `.rec*` → `.seq-rec*`로 재스타일(cream/orange/KoPub).
- **ProgressModule**: 공종 그룹별 공정 목록 + 실적%(슬라이더+숫자), 계획(일정상 경과)% 대비 편차, 지연(≤−10%p) 붉게, 전체 실적(기간가중). 전부 공유 `projectKpis.progress`에서.
- **ReportModule**: 공정·진척·원가·안전 자동집계 표 + 출력. 옛 `window.print()` → Sequence 출력 엔진과 연계 검토.
- **ModulePlaceholder**: 미구현 모듈 안내(plan 목록). 현재 fields 없는 soon 모듈 없음 → 안전망.
- **대시보드 EVM 부활**(2단계): `kpis.ts`의 EVM(SPI/CPI/EAC)·모듈경보·예산vs실적·베이스라인 존을 총괄 대시보드에 추가(현재는 일정 KPI만).

## 7. 엔진 (`engine`)

- 방금 만든 `engine/projectKpis.ts`(일정 전용)를 **옛 `kpis.ts` 풀버전으로 확장**: progress(기간가중 계획/실적/지연) + cost/boq/coverage + EVM + 모듈경보 + baseline drift.
- 단일 셀렉터 원칙 유지(대시보드·진척·보고서가 같은 산식 구독 → 발산 없음). 단위 분리(cost 천원 / boq 원) 그대로.

## 8. 단계 계획

- **1단계 — 기반 + 기록 모듈 9종**
  - 모델(§2) + CRDT 스키마 modules/baseline(§3.2~3.4) + store 액션(§4) + shellStore/ModuleRail(§5) + RecordModule/ModulePlaceholder(§6) + data/modules.ts.
  - 산출: 9개 기록 모듈이 실제로 입력·저장·협업 동기화. Task.progress 필드도 이때 함께(모델·CRDT).
  - 검증: build/tsc · mount-test(레일·각 모듈 렌더) · collab-smoke(모듈 라운드트립) · biome.
- **2단계 — 진척 + EVM**
  - ProgressModule + `projectKpis` 풀버전(EVM) + 대시보드 EVM/경보/예산vs실적/베이스라인 존 + captureBaseline UI.
  - 검증: projectKpis 유닛(EVM 일관·결측 0수렴) · mount-test.
- **3단계 — 보고서**
  - ReportModule 자동집계 + 출력(주간/월간) + Sequence 출력 엔진 연계.

## 9. 리스크 · 결정사항

- **CRDT 스키마 변경**이 최대 리스크 → 클라(crdt.ts)·서버(seed.js) **대칭** 필수, collab-smoke 라운드트립로 회귀 차단.
- 기존 프로젝트 하위호환(빈 modules) 확인.
- 모듈↔공정(공종/공정 id) 연계 집계는 후속(옛 미완 gap): resource 부하 히트맵, coverage→경보 환류, 마일스톤 D-day 기준 통일.
- 보고서 출력 형식(HTML print vs Sequence DXF/PDF 엔진) — 2·3단계에서 결정.
- 네비게이션: 레일 도입이 상단바/전체화면·조회전용 배지와 충돌하지 않게(레일 `data-export-hide`).

## 10. 승인 요청

이 설계로 **1단계(기반 + 기록 모듈 9종)** 착수 승인 요청. 조정할 점(모듈 우선순위·레일 형태·보고서 출력 방식 등) 있으면 반영 후 진행.
