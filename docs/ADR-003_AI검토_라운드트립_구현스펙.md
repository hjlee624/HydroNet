# ADR-003 · AI 검토 라운드트립 (공기 적정성 검토) — 구현 스펙

> **상태:** 제안(Proposed) · MVP 착수 대기
> **결정일:** 2026-08-31
> **관련:** ADR-002(인증/RBAC·readOnly), 세계우위 전략보고서 §F1(뉴로-심볼릭)
> **범위(MVP):** `duration`(공기, 일) **한 필드만** 반영. `durationLabel`/`note`/링크/구조 변경은 2차 이후.

---

## 1. 요약 (TL;DR)

사용자가 공정표를 어느 정도 작성한 뒤 **[AI 검토]** 버튼을 누르면, 앱이 "공사기간 적정성 검토 요청" **마크다운(.md)** 파일을 export 한다. 사용자는 이 파일을 **GPT·Gemini·Claude 등 아무 LLM**에 수동 제출하고, LLM이 검토·수정 제안을 담아 회신한 `.md`를 다시 앱에 업로드하면, 앱이 제안된 **공기 조정을 결정론적으로 반영**한다.

**핵심 원칙 (뉴로-심볼릭):**
- **LLM = neural** — 공기가 적정한지 *검토·제안*만 한다.
- **Sequence 엔진 = symbolic** — 날짜·CPM·주공정·순환검출은 `engine/scheduling.ts`가 100% 유지한다. **LLM은 날짜를 직접 계산하지 않으며, 계산 결과(ES/EF/critical)에 손댈 수 없다.**
- LLM이 무엇을 내놓든 최종 일정은 항상 우리 엔진이 재계산하므로, **환각이 baseline을 오염시킬 수 없다.**

**왜 파일 라운드트립인가 (직접 API 아님):**
- **폐쇄망/오프라인** — 국내 공공 발주처 상당수가 외부 API 반출을 금지. 수동 파일 왕복이 유일 경로일 수 있다.
- **BYO-LLM** — 벤더 종속·토큰비용·모델교체 자유.
- **책임소재** — `.md`에 감사추적(회신 해시·수용/거절·모델명·승인일시)이 파일로 남아 감리 방어에 강하다. (`의사결정.md` 문화와 정합)
- **확장 경로** — 동일 `.md` 포맷·동일 파서를 훗날 "원클릭 direct API"에도 재사용 → UI만 바꿔 승급.

---

## 2. 채택 형식: DTP (Deterministic Table round-trip)

경쟁 설계 3안(코드펜스/표왕복/YAML)을 4기준(결정적 import·LLM 견고성·UX·구현성)으로 채점한 결과 **DTP(37/40)** 채택.

> **사람이 읽는 마크다운 표** (가독) **+ 파일 맨 끝 단일 기계펜스** ` ```sequence-review ` (JSONL, 정본).

- 표는 사람(그리고 LLM)이 읽고 이해하는 용도. **앱은 표를 파싱하지 않는다.**
- **정본은 오직 펜스 안의 JSONL**. 앱은 이 펜스만 파싱해 반영한다.
- 자유 서술 `.md`를 `Task[]`로 되매핑하는 것은 **본질적으로 비결정적**이라 반드시 피한다. → 이중 인코딩으로 "가독"과 "결정성"을 분리.

---

## 3. 데이터 흐름

```
[작성중 공정표]
   │  ① [AI 검토] 클릭
   ▼
buildReviewRequestMd(project)  ──→  {projectName}_공기검토요청_{YYYYMMDD-HHmm}.md   (read-only, 위험 0)
   │  ② 사용자가 GPT/Gemini/Claude에 수동 제출
   ▼
[LLM이 검토 → 회신 .md]  (표 위에 서술 + 맨 끝 ```sequence-review 펜스)
   │  ③ 사용자가 회신 .md 업로드
   ▼
parseReviewMd(text)  →  델타[]  →  검증 게이트  →  dry-run diff 프리뷰
   │  ④ 사용자가 델타별 체크 → [반영]
   ▼
applyReviewDeltas(selected)  ──(단일 commit)──→  computeSchedule/applyCascade 재계산  →  감사 append
```

---

## 4. Export 스펙 — 검토 요청 `.md`

`buildReviewRequestMd(project): string`. **고정 6섹션.**

### [1] YAML front-matter (기계 메타)
```yaml
---
sequence_review_request: v1
projectId: "<Project.id>"
activeSheetId: "<activeSheet.id>"          # 시트 교차 오적용 차단용 (필수)
sheetRole: "plan" | "milestone"
reviewFingerprint: "<sha256 앞 16자>"        # §10-② 신규 함수
unit: "integer-days"                         # 모든 수치는 정수 '일'
exportedAt: "2026-08-31T09:30:00+09:00"
taskDurations:                               # 필드단위 stale 판정용 (전역해시 아님)
  "t-AbCd1234": 180
  "ft-0-3-1": 60
standardDays:                                # 앱이 미리 계산해 동봉 (§10-⑤)
  "t-AbCd1234": 165                           #   표준 미산출 공정은 키를 넣지 않음
---
```

### [2] 상단 지시문 → §5

### [3] 프로젝트 컨텍스트 + 표준공기 벤치마크
- 사업명·시설물유형(`facility`)·`startDate`·총공기.
- **표준공기 벤치마크 표** — `civilFacilities.ts`의 `CivilStep.months × 30`(일). 이 값을 LLM에 주입해 *일반지식이 아니라 이 프로젝트 기준*으로 판정하게 한다.
- `months ≤ 0`(마일스톤 등)은 표준후보에서 제외하고 `표준대비 %`를 `—`로 표기(0 분모 NaN 차단).

### [4] 공정표 본표 (한 행 = 한 공정)
| 공종 | 공정 / 세부공정 | 현재공기(일) | 시작일 | 주공정 | 표준(일) | 표준대비 | ID |
|---|---|---:|---|:---:|---:|---:|---|
| 댐 본체 | 콘크리트 타설 | 180 | 2026-05-01 | ● | 165 | +9% | `[[id:t-AbCd1234]]` |
| 〃 | └ 양생 | 28 | … |  | — | — | `[[id:t-Ef56Gh78]]` |

- 세부공정(`parentId` 있음)은 `└` 들여쓰기.
- **ID 인코딩 = `[[id:<원본 전체 id>]]`** — 접두사·하이픈 포함 **실제 id 그대로**(§10-①). 백틱 코드스팬으로 감싸 뷰어·복붙 생존성 확보.
- 표준 미매칭 공정은 `표준` 칸에 `표준없음` 배지.

### [5] 하단 지시문 (반복) → §5

### [6] 반쯤 채운 델타 스텁 (준수율↑)
export 시 각 공정의 **실제 id·현재 duration(from)** 을 미리 박아, LLM이 `to`·`reason`만 채우게 한다. 소형·국산 로컬 모델 준수율을 크게 올린다.
> ⚠️ 이 스텁은 **진짜 펜스가 아니게** HTML 주석/들여쓰기로 감싼다 — 회신에 남아도 "펜스 2개"로 오판돼 정상회신이 죽는 자기모순을 방지(§10 저하 로직).

---

## 5. 프롬프트 스펙 (`.md` 상·하단 2곳에 동일 삽입)

한국어 + 영어 키워드 병기(LLM-agnostic). **비타협 규칙:**

1. **공정 신설·삭제·이동·병합 금지.** 기존 공정의 공기만 검토.
2. `[[id:…]]` 값은 **그대로 echo**, 절대 변형·정규화 금지.
3. **단위 = 정수 '일'만**(개월·주·범위·소수 금지). 개월 환산은 `reason` 설명에만 허용.
4. 마일스톤(◆)은 `duration = 0` 고정, 제안 금지.
5. **바꿀 값이 있는 공정만** 델타에 기입.
6. 각 델타에 `from`(현재 duration)을 **반드시 echo**(불일치 시 앱이 거부).
7. **제안 가능 필드 = `duration` 만**(MVP). 시작일·선후행·공종·마일스톤여부·id는 물리적으로 반영 불가.
8. 근거(`reason`/`basis`)는 **이 파일의 표준공기·우기 정보만** 사용.
9. **출력 형식:** (A) 사람용 검토 서술을 자유롭게 위에 쓰고, (B) **파일 맨 끝에 ` ```sequence-review ` 펜스를 정확히 1개**, JSONL(줄당 완전한 JSON 1개)로. 주석·후행쉼표·산문 금지.
10. ⚠️ **경고(크게):** "이 펜스가 없거나 2개 이상이면 앱이 자동 반영하지 못합니다."

---

## 6. 회신 스펙 — `sequence-review` 델타 (MVP: duration only)

파일 전체에서 **유일한** ` ```sequence-review ` 펜스 안, 줄당 1 JSON:

```jsonl
{"projectId":"P123","taskId":"t-AbCd1234","field":"duration","from":180,"to":210,"reason":"우기 6~9월 62일 간섭 대비 저타설 여유 부족","basis":"표준 165일·우기간섭"}
{"taskId":"t-Ef56Gh78","field":"duration","from":28,"to":28,"flag":"선후행 대비 공기 과소 우려","noChange":true}
```

**화이트리스트 스키마 (MVP):**

| 키 | 필수 | 규칙 |
|---|:---:|---|
| `taskId` | ✔ | 원본 전체 id echo. |
| `field` | ✔ | `"duration"` 만 허용(MVP). |
| `from` | ✔ | 정수. export 당시 duration과 대조(CAS). |
| `to` | ✔ | 정수 ≥ 1. |
| `reason` | ✔ | 문자열(개행·제어문자·JSON구조·타 taskId 패턴 스트립). |
| `basis` | – | 문자열(선택). |
| `flag`/`noChange` | – | 변경 없이 우려만 표기. |

- **여분 키가 하나라도 있으면 그 델타 전체를 reject**(drop 후 진행 아님) — 구조 밀수(start/parentId/link 등) 원천 차단.
- 스키마에 **없는** 것 = `start`·`id`·`parentId`·`categoryId`·`isMilestone`·`link.*`·`progress`·`forceCritical`·`es~critical`. → 신규·삭제·구조·날짜 반영 **경로 자체가 존재하지 않음**.
- `.md`에 적힌 날짜·주공정 표시는 **파싱 시 전량 폐기**(엔진이 유일 진실).

---

## 7. Import·반영 알고리즘 — `applyReviewDeltas`

`parseReviewMd(text)` → 검증 → dry-run → 승인 → `applyReviewDeltas(selected)`. **8단계 + 가드.**

| # | 단계 | 내용 / 코드 통합 |
|---|---|---|
| 0 | **권한** | 함수 최상단 `if (get().readOnly) return`(파싱·감사보다 먼저). 서버측 편집권한도 재검증(클라 `readOnly`만 신뢰 금지). cf. `store.ts:888`, `setReadOnly` `store.ts:1704`. |
| 1 | **펜스 추출** | ` ```sequence-review ` **정확히 1개**만 정본. 0개/2개+ → **저하A**(자동반영 중단, 원문을 "사람이 읽는 제안목록"으로 강등, **경고색**). 언어태그 대소문자·전후공백·```/~~~/4백틱 관대 허용. |
| 2 | **JSONL 관대 파싱** | 줄 단위 try/catch. **깨진 줄만 버리고 나머지 반영**(부분 성공). |
| 3 | **지문·시트 대조** | `projectId` 불일치 → 전면중단. `activeSheetId` 불일치 → 전면중단("다른 시트 검토본"; `switchSheet`가 undo를 clear하므로 시트가 바뀌면 단일 undo도 깨짐). 전역해시 대신 **`taskDurations[id]` 필드단위 stale** 판정. |
| 4 | **전수 검증** | 델타별: ① `taskId` ∈ 실제 id 집합 **정확 일치**(trim·정규화 금지, 실패 시 §10-① 3-way 후보 확인 후 **강등**). ② `field` 화이트리스트 + 여분키 reject. ③ `from` ≠ `taskDurations[id]` → stale 배지. ④ 마일스톤 `to≠0` reject. ⑤ 정수·`[1, standardDays×3]`(표준매칭 성공 시), 매칭 실패 시 상한 프리패스 금지 → **flag+수동확인 강등**. |
| 5 | **dry-run** | **실제 반영과 100% 동일 함수**(`applyCascade`+`computeSchedule`, `store.ts:693 deriveProject` 경로)로 시뮬. 프리뷰=결과 보장. 표시: 총공기 변화 · (비주공정이면) "총공기 무변" 배지 · **이 델타가 미는 마일스톤 목록**(id·기존Day→예상Day). critical diff는 표시critical(`forceCritical` override)이 아니라 `computeSchedule` **raw critical** 기준. |
| 6 | **승인 UI** | 델타별 체크박스 **기본 전부 미선택**. before→after·reason·basis·배지(stale/conflict/표준편차/미매칭). rejected는 사람 이해 문구("export 이후 이 공정이 삭제/재생성됨"). |
| 7 | **반영** | 신규 액션 `applyReviewDeltas(selected)`를 **단일 `commit`**(store.ts:~888 경로)으로. 세부는 §8. |
| 8 | **감사** | commit **성공 후에만** 감사 엔트리 append(반영 0이면 감사 0). 반영 직전 `.json` 스냅샷 저장(원클릭 롤백 보강). |

### §8 — 반영(commit) 내부 규칙 (가장 중요)

- **단일 commit** = `undoManager.stopCapturing()`(store.ts:898) 1회 = **원클릭 롤백 1엔트리.** (여러 `updateTask` 반복 호출 금지 — 각 호출이 별도 undo 엔트리가 됨.)
- **commit 콜백 안에서 `from` 재대조(CAS):** 각 델타에 대해 최신 `authoritativeShadow.tasks`(store.ts:704, CRDT 진실)의 `t.duration !== from` 이면 **skip + "반영 중 원격/타검토자 변경" 리포트**. → 프리뷰↔반영 사이 협업 편집 소실(TOCTOU·"마지막 반영자 승리") 방어.
- `t.duration = to` set. **`durationLabel`은 export 당시 값과 같을 때만 초기화**, 다르면 유지 + "라벨 미갱신" 안내(§10-④ 무언파괴 방지). 라벨 소실도 감사에 기록.
- `relinkIncoming`(store.ts:523)은 **전 델타 적용 후 1회 배치**(순서의존 멱등성 깨짐 방지).
- 파생(cascade)은 **기존 `autoCascade` 설정을 그대로 따른다**(store.ts:895, 최소 놀람). `reschedule`은 **절대 호출 안 함**(수동 여유·`forceCritical` 파괴). → *워크플로는 "이 커밋 범위에서만 cascade 강제"도 제안했으나, autoCascade를 끈 사용자의 의도 존중을 위해 MVP는 설정 준수. §12 열린결정.*

---

## 8. 안전 가드 체크리스트

- [ ] `taskId` 정확 일치 매핑만 자동반영. 이름 재매칭 금지. 실패는 삭제 아닌 **무시+리포트**.
- [ ] 화이트리스트(`duration`만) + 여분키 시 델타 전체 reject → 구조 밀수 봉쇄.
- [ ] commit 콜백 내 `from` CAS → 동시편집 소실 방어.
- [ ] dry-run = 실제 반영 동일 코드경로. 마일스톤 이동·총공기 무변 명시.
- [ ] `reviewFingerprint`는 `crdt.ts:325 canonicalProjectSnapshot`과 **별도 신설**, 필드단위 stale.
- [ ] `readOnly`를 모든 부작용보다 먼저 + 서버측 권한 재검증.
- [ ] 형식붕괴(펜스 0/2+·JSON실패·시트불일치)는 조용한 실패 아닌 **경고색 저하**.
- [ ] 표준 미매칭 공정은 상한 프리패스 아니라 flag+수동확인. `months≤0`은 `—`.

---

## 9. 코드 검증이 잡은 지뢰 6가지 (필독)

> 워크플로가 실제 파일을 열어 확인한 함정. **안 잡으면 실제로 터진다.**

1. **ID 포맷** — 실제 id는 `t-{nanoid8}`(store.ts:382) / 템플릿 `ft-{ci}-{ri}-{si}`(facilities.ts:180)로 **접두사·다중 하이픈** 포함. LLM이 "정규화"하거나 표에서 줄바꿈되면 매칭 전량 실패. → `[[id:<실제 전체 id>]]` 고정 + 예시에도 진짜 id. 실패 시 "접두사·하이픈 제거 3-way 후보"로 강등.
2. **함수 이름 충돌** — `crdt.ts:325 canonicalProjectSnapshot`은 매 commit CRDT 쓰기경로(`crdt.ts:343`)가 호출. 절대 재사용/재정의 금지. **신규 `reviewFingerprint(project)`** — 해시입력 = `tasks[].{id,duration,durationLabel,note,isMilestone,parentId}` + `startDate` (view/branding/meta/row/position 제외).
3. **CRDT 동시편집 조용한 덮어쓰기** — 프리뷰 락만으론 부족. **commit 콜백 안 CAS**(§8).
4. **`durationLabel` 무언 파괴** — ChartCanvas.tsx:663-664에서 duration/durationLabel이 흔히 어긋남. 반영 시 라벨 무조건 비우기 금지(§8).
5. **표준공기 fuzzy 매칭 취약** — Task에 안정 `stepKey` 없음 → 이름 fuzzy 대부분 실패 → 상한 프리패스 → 10배 환각 통과. **앱이 export 시 `standardDays` 미리 계산해 동봉**, 매칭 실패는 flag 강등. 근본해결 = `task.meta.stepKey` 신규(§11 2차).
6. **우기(RainySeason)는 "그림"** — `scheduling.ts`는 `efficiency`를 **한 번도 읽지 않음**(렌더 밴드 전용). "우기 겹침 N일"은 **존재하지 않는 계산**. → MVP는 우기를 **참고 표시로만**, dry-run "우기충돌" **제외**. 진짜 반영은 `computeSchedule`에 efficiency 통합이 선행(별도 로드맵). *— 이 기능과 무관하게 알아둘 버그성 사실.*

---

## 10. 신규/수정 코드 표면

| 파일 | 추가/수정 |
|---|---|
| `client/src/export/reviewRequest.ts` *(신규)* | `buildReviewRequestMd(project)` — §4·§5 생성, `standardDays` 계산 동봉. |
| `client/src/state/reviewFingerprint.ts` *(신규)* | `reviewFingerprint(project)` — §9-②. **`crdt.ts`와 이름 분리.** |
| `client/src/state/reviewImport.ts` *(신규)* | `parseReviewMd(text)` — 펜스 추출·JSONL 관대 파싱·저하A/B. |
| `client/src/state/store.ts` *(수정)* | 액션 `applyReviewDeltas(selected)` — §7·§8. `commit` 경로 재사용. |
| `client/src/components/ReviewDialog.tsx` *(신규)* | 업로드 → 검증 결과 → 델타별 diff 프리뷰(기본 미선택) → [반영]. |
| `client/src/components/TopBar.tsx` *(수정)* | **[AI 검토]** 버튼(export) + 회신 업로드 진입점. |
| `client/src/data/civilFacilities.ts` *(참조)* | `CivilStep.months × 30` 표준공기 원천. |

---

## 11. MVP 범위 / 이후

**MVP (착수 대상)**
1. **export만 먼저** (read-only, 위험 0) — front-matter + `[[id:실제id]]` 표 + 표준공기 + 상하단 지시문 + 델타 스텁. *이것만으로도 즉시 유용(수동 GPT 검토).*
2. import 정본 = **`duration` 한 필드만**. 화이트리스트 = duration only.
3. `parseReviewMd` — 단일 펜스 + JSONL 관대 + 저하A/B.
4. 검증 게이트 최소셋(§7-4) + `from` CAS(프리뷰+commit 양쪽).
5. diff 프리뷰(기본 미선택·3-way stale·총공기변화).
6. `applyReviewDeltas` — 단일 commit·stopCapturing·relinkIncoming 배치1회·**reschedule 금지**·readOnly 최우선·감사+스냅샷.
7. `activeSheetId` 대조 + `taskDurations` 필드단위 stale (**빠지면 협업방 상시 오작동**).
8. **CI 회귀 3종**(§13).

**2차 이후 (schemaVersion↑)**
- `durationLabel`/`note` 화이트리스트 옵트인(무언파괴 3택 UI).
- `link.lag` 조정 옵트인(양생기간 확보 등 국내 실수요) — v2.
- 신규/삭제/이동 op(`store` paste의 2패스 tmpId 재매핑) — v3, "공정 누락" 구조제안.
- **개방망 BYO-key direct API** 경로(동일 `parseReviewMd` 재사용, 펜스 없으면 1회 자동 재요청).
- 우기를 `computeSchedule`에 실제 반영(efficiency 통합) → 우기 근거 검토 결정론화.
- `task.meta.stepKey` 도입 → 표준공기 안정참조(fuzzy 제거).
- 감사추적 서버 영속화 + 협업자 간 반영이력 공유 뷰.

---

## 12. 열린 결정 (채택 기본값)

| 결정 | 기본값 |
|---|---|
| MVP 반영 필드 | **`duration` 만** ✅(확정) |
| stale 판정 | **`taskDurations` 필드단위** ✅(전역해시는 감사표식으로만) |
| 우기 겹침 | MVP는 **참고 표시만**, dry-run "우기충돌" 제외 ✅ |
| 표준 미매칭 처리 | **flag+수동확인 강등**(10배 환각 봉쇄, 반영률 다소↓) ✅ |
| duration 반영 시 cascade | **`autoCascade` 설정 준수**(최소 놀람) — *"강제 cascade" 대안은 검토 여지* |
| readOnly 사용자 export | **허용**(read-only 안전), import(반영)만 차단 ✅ |
| direct API 도입 시점 | 폐쇄망 수동 왕복 검증 후, 동일 파서 위에 ✅ |

---

## 13. CI 회귀 테스트 (필수 3종)

1. **id 왕복** — `buildReviewRequestMd` → `parseReviewMd` self-parse: 모든 실제 id(접두사·다중하이픈 포함)가 손실 없이 매칭.
2. **지문 경계** — `reviewFingerprint`: 색/로고/줌 변경 시 **불변**, `duration` 변경 시 **변경**.
3. **멱등성** — 델타 순서 셔플 + 2회 적용 → 동일 결과(relinkIncoming 배치 1회 검증).

---

## 14. 로드맵 정합 & 포지셔닝

이 기능은 세계우위 보고서 **F1(뉴로-심볼릭)** 노선을 코드 불변식으로 강제한다: LLM=검토·제안(neural) / 결정론 엔진=CPM·날짜·critical(symbolic)의 역할분리.

**단, 진짜 해자는 "라운드트립 UX"가 아니다** — 프롬프트 하나로 복제된다. 대체 불가한 해자는 `civilFacilities.ts`의 **국내 시설물별 표준공기 벤치마크(도메인 grounding) + 결정론 재계산**의 결합이다. 라운드트립은 그 해자를 **폐쇄망·규정 환경에 "배달"하는 수단**으로 포지셔닝한다. `task.meta.stepKey`(2차)로 표준 grounding을 안정화하면 뉴로-심볼릭 우위가 실질화된다.
