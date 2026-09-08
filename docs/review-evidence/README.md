# 검토보고서 검증 자료

`docs/Sequence_직원활용성_검토보고서.html` 이 인용하는 실행 기록입니다.

## 생성 방법

모든 `.txt` 는 **저장소 루트에서** 아래 명령을 그대로 실행한 표준출력/표준오류 원문이며,
손으로 고치지 않았습니다. 경로는 상대경로이므로 어느 위치에 클론해도 동작합니다.

```bash
cd client && npm run smoke                  > ../docs/review-evidence/client-smoke.txt          2>&1
cd client && npm run smoke:adequacy         > ../docs/review-evidence/adequacy-smoke.txt        2>&1
cd client && npm run smoke:boq              > ../docs/review-evidence/boq-smoke.txt             2>&1
cd client && npm run smoke:crdt             > ../docs/review-evidence/crdt-smoke.txt            2>&1
cd client && npm run smoke:export           > ../docs/review-evidence/export-smoke.txt          2>&1
cd client && npm run smoke:persist          > ../docs/review-evidence/persist-smoke.txt         2>&1
cd client && npm run smoke:schedule-import  > ../docs/review-evidence/schedule-import-smoke.txt 2>&1
cd client && npm run smoke:perf             > ../docs/review-evidence/perf-smoke.txt            2>&1
cd client && npm run mount-test             > ../docs/review-evidence/mount-test.txt            2>&1
cd client && npm run smoke:presence         > ../docs/review-evidence/presence-smoke.txt        2>&1
cd client && npx tsx scripts/onboarding-smoke.ts > ../docs/review-evidence/onboarding-smoke.txt 2>&1
cd server && npm run collab-smoke           > ../docs/review-evidence/collab-smoke.txt          2>&1
cd server && npm run auth-smoke             > ../docs/review-evidence/auth-smoke.txt            2>&1
cd client && npx tsx ../docs/review-evidence/domain-probe.ts > ../docs/review-evidence/domain-probe.txt 2>&1
```

## 파일 목록

| 파일 | 무엇을 보여주는가 | 결과 |
| --- | --- | --- |
| `client-smoke.txt` | 레이아웃·라우팅·프리셋 마일스톤 위생·일정 편집 의미론 | ✅ ALL PASS (검사 371건) |
| `adequacy-smoke.txt` | 공기 적정성(법정 산정식·단위 검증·허용 편차) | ✓ 108 checks passed |
| `boq-smoke.txt` | 내역서(BoQ) 파싱·매핑·미매칭 행 노출 | ✓ 34 checks passed |
| `crdt-smoke.txt` | 협업 수렴·권위·산정 전제 병합·실적 필드 병합·감사기록 | CRDT SMOKE OK |
| `export-smoke.txt` | 출력 범위·사전 점검·단축키 범위 행렬·서버 시드 왕복 | ✅ EXPORT SMOKE OK |
| `persist-smoke.txt` | 저장 표시 모델·내용 대조 확정·파일 백업 정직성·스키마 버전 | passed |
| `schedule-import-smoke.txt` | 일정표 취입 왕복·오류행·복구 시 감사기록 보존 | ✓ 238 checks passed |
| `perf-smoke.txt` | 100/500/1000공정 산정·레이아웃 응답 시간 | ✅ PERF OK (1000공정 p95 4.1ms) |
| `mount-test.txt` | 실제 DOM 마운트 — 모달 포커스·출력 대화상자·반응형·지원 대화상자 | ✅ MOUNT OK |
| `onboarding-smoke.txt` | 첫 실행 안내 단계 판정·프로젝트 목록 권한 범위 | ✅ ONBOARDING SMOKE PASS |
| `presence-smoke.txt` | 참여자 표시(전송 전용, Y.Doc 미기록) | passed |
| `collab-smoke.txt` | 서버 영속·버전 보관·인가 행렬·비활성화 차단 | COLLAB SMOKE PASS (검사 111건) |
| `auth-smoke.txt` | 인증·본부 권한·비밀번호 정책·접근 요청 수명주기 | ✅ AUTH SMOKE PASS (검사 134건) |
| `domain-probe.ts` / `.txt` | F03·F04 재현 스크립트와 **수정 후** 결과 | 아래 참조 |

## domain-probe — 수정 전후

이 스크립트는 원래 F03·F04 결함을 **재현**하려고 작성한 것입니다. 지금 기록된 출력은
**수정이 반영된 뒤의 결과**이며, 두 결함이 해소되었음을 보여줍니다.

| 항목 | 수정 전(검토 시점) | 수정 후(현재) |
| --- | --- | --- |
| 병렬 10일 공정 2개의 작업일 | `summedWork: 20` (경과 공기 10일과 혼동) | `summedWork: 10` — 작업량 합계와 경과 공기를 분리 산출 |
| `ton` 물량을 `㎥` 표준생산성에 적용 | `theoretical: 1`, `verdict: "과다"` | `theoretical: null`, `verdict: "판정불가"` — 차원 불일치를 차단 |

## 한계 — 이 자료가 보증하지 않는 것

- `report-qa.txt` 는 **검토보고서 HTML 자체의 렌더/링크 점검** 기록이며, 생성 명령이 저장소에 남아
  있지 않아 이번에 재실행하지 못했습니다. 최신 상태를 보증하지 않습니다. 같은 점검의 화면 캡처
  (`report-preview.png`)는 재현 명령이 없어 곧 낡으므로 저장소에 두지 않습니다(`.gitignore`).
- `collab-smoke` · `auth-smoke` 는 **파일(메모리) 어댑터**로 실행됩니다. PostgreSQL 경로의 SQL 자체는
  이 기록으로 검증되지 않았습니다.
- 래스터·벡터 출력(PNG/JPG/PDF/SVG)의 실제 산출물 품질은 자동 검사 대상이 아닙니다.
  `export-smoke` 는 사전 점검과 DXF 범위까지만 다룹니다.
- 검토보고서 본문의 실행 결과표(스모크 17건 실패 · adequacy 39 · BoQ 26)는 **검토 시점의 값**이며,
  이 폴더의 기록이 현재 값입니다. 보고서는 검토 당시를 서술한 문서이므로 수정하지 않았습니다.
