# 아키텍처 & 도메인 모델 (CRDT)

핵심 원칙: **Y.Doc = 유일한 진실원본, zustand = 파생 단방향 뷰.** 렌더 레이어(SVG·셀렉터)는 무변경이 목표.

## 1. 데이터 흐름 아키텍처

데이터 흐름은 "Y.Doc = 유일한 진실원본, zustand = 파생 단방향 뷰" 원칙으로 통일한다. 렌더 레이어(App/ChartSvg/Sidebar/Inspector)는 그대로 zustand 셀렉터를 읽으므로 무변경이 목표다.

[1] 클라이언트 Y.Doc ↔ zustand 바인딩 (store.ts 개조)
- Y.Doc 1개를 프로젝트마다 만들고 rootMap=ydoc.getMap('root')에 meta(Y.Map: id/name/kind/facility/startDate/schemaVersion), view(Y.Map), paper(Y.Map), branding(Y.Map), palette(Y.Array), categories/tasks/links/rainySeasons(각각 Y.Array&lt;Y.Map&gt;), sheets(Y.Array&lt;Y.Map&gt; — 비활성 시트까지 전부 상주)를 담는다. 컨테이너는 getMap/getArray가 멱등이므로 부트스트랩 트랜잭션에서 '없으면 1회만' 생성한다(두 클라가 같은 key에 new Y.Array를 set하면 병합이 아니라 덮어쓰기 나므로 절대 재생성 금지).
- 쓰기: 기존 commit(mutate, opts)의 body를 `ydoc.transact(() =&gt; applyMutationToYTypes(draftDiff), LOCAL_ORIGIN)`로 감싼다. LOCAL_ORIGIN은 문자열이 아니라 객체 identity(const LOCAL_ORIGIN = {}). commit이 유일한 쓰기 관문이라 origin 태깅 지점이 단 하나 → 교과서적으로 깔끔하다.
- 읽기: ydoc.observeDeep(events =&gt; { if (txn.origin === LOCAL_ORIGIN) skipRewrite; else 원격/로컬 공통으로 rootMap.toJSON()을 평면 Project로 뽑아 withSchedule(CPM 로컬 재계산) 후 zustand set })로 단방향 push. observeDeep는 과발화하므로 microtask/requestAnimationFrame 배치로 묶는다. 로컬 origin일 때도 CPM은 재적용해야 하므로 "낙관적 반영 후 CPM만 다시" 경로를 둔다.
- 파생값(es/ef/ls/lf/critical/__mirror/cascade가 민 start)은 어떤 경로로도 Y.Doc에 쓰지 않는다. 단 forceCritical·사용자가 직접 드래그한 start는 권위값이라 트랜잭션에 기록. cascade가 민 start는 SCHEDULE_ORIGIN(비추적) 트랜잭션으로만 반영하거나 아예 로컬 파생으로 유지.

[2] 전송 (온라인 LAN 모드에서만 부착, 옵션화)
- HocuspocusProvider(또는 y-websocket provider) room=projectId로 사내 LAN 서버(ws://호스트:4020/collab)에 붙는다. 오프라인 단일 HTML(file://)·서버 다운 시엔 provider를 아예 부착하지 않는다 → 전송 선택과 오프라인 요건이 분리된다.
- awareness(y-protocols): setLocalStateField('user',{name,color}), 'selection'({selectedTaskIds,selectedCategoryIds,selectedLinkId})을 브로드캐스트. 기존 zustand selection state를 그대로 얹는다. change 이벤트로 원격 커서·선택 하이라이트를 SVG에 직접 렌더. 재연결 시 awareness clear로 유령 커서 방지.

[3] 서버 (server/src/index.js 확장)
- 같은 http.createServer(app) 하나에 Hocuspocus를 부착(추가 포트 없음, 4020 유지, 운영 4000 금지). onAuthenticate 훅에서 토큰/세션 검증(무인증 감사 지적 해소), 실패 시 throw로 연결 차단. 뷰어 역할은 connection.readOnly=true.
- 기존 전체-파일 PUT /api/projects/:id는 CRDT 도입 후 '스냅샷/백업 export' 및 레거시 로드용으로 강등(read-only 또는 삭제). LWW PUT이 CRDT를 덮어쓰지 못하게 하는 것이 5단계 필수.

[4] DB / 영속
- 서버측: @hocuspocus/extension-database(또는 y-leveldb)로 room(projectId)별 Y.Doc 바이너리를 로컬 파일(SQLite/LevelDB)에 append-log+주기 스냅샷으로 영속. 외부 서비스 0개, 인터넷 불필요. 재시작 후에도 문서 복원. 압축은 'mergeUpdates만으로는 삭제분 GC 안 됨' 함정 때문에 임계치 도달 시 Y.Doc 로드→encodeStateAsUpdate 재인코딩 2단계로.
- 클라이언트측: y-indexeddb(PREFERRED_TRIM_SIZE=500 자동 병합)로 provider 없이도 오프라인 편집·영속. 기존 localStorage 자동복원 캐시(AUTOSAVE_KEY)를 이걸로 대체. Y.Doc당 IndexeddbPersistence 인스턴스는 반드시 1개.

[5] 오프라인 / 스냅샷 / 호환
- .json ↔ Y.Doc 왕복 어댑터(api.ts/fileIO.ts, schemaVersion 분기): 로드 시 평면 .json → (서버 권위에서 1회만) CRDT 시드 바이너리 생성·배포(클라별 재import 금지 — clientID 갈려 중복/발산). 저장 시 rootMap.toJSON()으로 순수 Project .json을 그대로 뽑아 기존 파일 포맷 무손실 유지. 베이스라인/개정본 보관은 현 규모에선 '버전마다 전체 스냅샷 복사본 저장'(gc 관리 회피)이 가장 안전.
- 재연결 병합: y-indexeddb가 오프라인 diff를 큐잉했다가 provider 재연결 시 자동 merge(무손실 수렴). 'synced' 이벤트 전 빈 화면 렌더 회귀는 mount-test.ts가 잡는 그 버그이므로 로드 완료까지 대기.

## 2. 도메인 모델 → CRDT 타입 매핑

HydroNet 도메인을 Yjs 타입으로 매핑한다. 핵심 원칙: 안정 id(nanoid) 리스트 컬렉션 = Y.Array&lt;Y.Map&gt;, 서로 다른 항목 동시 편집=병합, 같은 필드만 LWW 수렴.

[Project 최상위]
- rootMap = ydoc.getMap('root'). 그 아래:
  - meta: Y.Map { id, name, kind, facility, startDate, schemaVersion, createdAt, updatedAt, commissioningEnabled }. 모두 스칼라 LWW 필드.
  - view: Y.Map (ViewSettings 필드들 — pxPerDay/rowHeight/scale/showCriticalPath/displayStart/displayEnd/mirrorPlan/showYearLine 등). textStyles는 Y.Map&lt;role, Y.Map&gt;. mirrorHidden은 Y.Array&lt;ID&gt;. paper: Y.Map. branding.logos: Y.Array&lt;Y.Map{src,w,h}&gt;. palette: Y.Array&lt;string&gt;(최대 10).
    → view/paper/branding은 '문서 전체 협업'이 아니라 별도 세밀도로 둘 수 있으나(열린질문 1), 초기엔 같은 Y.Doc에 두고 LWW로 충분.

[Category]
- categories: Y.Array&lt;Y.Map&gt;. 각 Y.Map { id, name, color, collapsed, order, isCommissioning, hidden }.
- 재정렬(order): Y.Array 인덱스 순서에 의존하지 말 것(Yjs native move 부재·delete+insert 시 동시 재정렬이 중복/인터리빙). order를 fractional-index 소수 정렬키(1.0, 1.5, 2.0…)로 두고 '이동=단일 order 필드 LWW 갱신'으로 모델링. reorderCategory/reorderCategories/moveCategory는 두 이웃 사이 중점값 부여로 재작성. collapsed는 로컬 UI 상태라 협업 동기화에서 제외(로컬 뷰) 검토.

[Task]
- tasks: Y.Array&lt;Y.Map&gt;. 각 Y.Map { id, categoryId, name, start, duration, isMilestone, row, color, labelPosition, note, parentId, durationLabel, hidden, forceCritical, progress, isDummy }. 전부 권위 스칼라 필드(LWW).
- row 재정렬 + parentId 재부모화(세부공정)가 CRDT 'move' 직격 지점. 해법 두 갈래:
  (a) Yjs 유지(권장): row를 fractional-index 소수키로, parentId를 값 필드 LWW로. moveTaskToRow의 '한 줄 densely renumber'는 절대 인덱스 전면 재작성 금지 → 대상 행 소수키만 계산. 세부공정 계층은 parentId LWW로 수렴(동시 재부모화는 LWW 승자 결정적, 패자 조용히 무효 = 수용기준의 '같은 필드만 결정적 수렴'과 일치). 부모 삭제 시 자식(parentId=부모id) 동반 삭제는 각 클라가 로컬 관찰로 재적용(또는 트랜잭션에 함께 기록).
  (b) 이동 정확성이 실측 병목이면 Loro 2순위 승격: MovableList(row)·Movable Tree(parentId 계층·사이클 해소)가 1:1 대응. 단 WASM 번들이 단일 HTML 부담이라 실측 후에만.
- es/ef/ls/lf/totalFloat/critical/__mirror는 Y.Map에 넣지 않음(파생). critical은 forceCritical(권위) 있으면 그 값, 없으면 로컬 CPM.

[Link]
- links: Y.Array&lt;Y.Map&gt;. 각 { id, from, to, type(FS/SS/FF/SF), lag, style, width, showDummy }. 의존성 존재+파라미터가 권위. lag는 사용자 입력 또는 위치역산(relinkIncoming) 결과지만 '드래그 제스처가 만든 lag'는 권위로 기록. 동시성: 서로 다른 링크 편집=병합, 같은 링크 lag 동시 변경=LWW.
- CPM 그래프에 사이클(선후행 순환)이 동시 편집으로 생길 수 있음 → computeSchedule이 사이클을 방어적으로 처리(가지치기/warnings)해야 함. acyclic은 로컬로 검증 불가한 전역 불변식이므로 재계산 함수 레벨 방어 필수.

[RainySeason]
- rainySeasons: Y.Array&lt;Y.Map&gt;{ id, label, startMonth, startDay, endMonth, endDay, efficiency }. 현재 단일 원소(setRainySeason이 [0] 교체)라 사실상 단일 Y.Map로 둬도 무방하나 리스트 유지가 안전.

[Sheet — 멀티시트]
- 현 구조(활성 시트만 최상위 + switchSheet swap)는 CRDT 궁합 나쁨. 전환: 모든 시트를 sheets: Y.Array&lt;Y.Map&gt;에 상주시키고 각 Y.Map { id, role, name, categories/tasks/links/rainySeasons(각각 Y.Array&lt;Y.Map&gt;) }. '활성 시트'는 Y.Doc 상태가 아니라 로컬 뷰 포인터(zustand activeSheetId)로만 관리 → 사용자마다 다른 시트를 봐도 충돌 없음. 최상위 categories/tasks 평면화는 렌더 셀렉터 계층에서 activeSheetId로 파생.
  - 대안: 시트별 Y.Subdocument(대형 사업에서 지연로드). 초기엔 단일 Y.Doc 상주로 단순하게.

[CPM 파생 처리]
- withSchedule(computeSchedule) / applyCascade / reschedule / mirror.augmentForMirror는 전부 순수 함수(입력=tasks/links, 출력=새 배열)이며 이미 저장/동기화와 분리돼 있음(코드로 확인). 이 원칙을 유지: CRDT엔 결정적 입력만, 재계산 함수는 순수·결정적, 사이클/전역 불변식은 재계산 단계에서 방어. 수렴은 보장하나 recency는 아니므로 아직 전파 안 된 상대 변경 반영 전 stale CPM이 잠깐 보일 수 있음(최종 일치).

[undo 처리]
- past/future 스냅샷 스택(HISTORY_LIMIT=50) → Y.UndoManager(scope=[tasksY, linksY, categoriesY, rainyY, viewY], trackedOrigins=new Set([LOCAL_ORIGIN])). '내 변경만 undo' 시맨틱(원격 협업자 변경 불건드림). captureTimeout으로 드래그 연속 이동을 1 undo로 병합, 제스처 종료 시 stopCapturing(). CPM 재계산은 SCHEDULE_ORIGIN(비추적)으로 격리해 undo 스택 오염 방지. beginGesture/setTaskStartLive의 history:false 패턴이 captureTimeout·stopCapturing으로 자연 대체됨. 전역→'내 변경만' 시맨틱 변화는 단일사용자 UX 회귀를 mount-test류로 반드시 검증.

[normalize 처리]
- normalize()/migrateSubNameToParentId(레거시 subName→parentId 이관)는 로드 어댑터 계층으로 이동. CRDT 마이그레이션은 가산적(additive) 우선 — 필드 rename 금지(모든 피어 원자적 wipe 불가), 신규 필드는 백필로 흡수. meta.schemaVersion 분기로 멱등 실행(단일 ydoc.transact 안에서).

---
[← 계획 인덱스](README.md)
