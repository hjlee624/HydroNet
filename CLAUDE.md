# HydroNet (개발 폴더)

**시작 전 `memory.md`를 먼저 읽고 작업을 이어가세요.** 전체 맥락·파일맵·함정·이력이 거기에 있습니다.

## 절대 규칙
- **여기는 개발 폴더입니다.** `D:\2026\PROGRAM\HydroNET_dev`, 브랜치 **`dev`**, dev 서버 포트 **4020**.
- **운영 폴더 `D:\2026\PROGRAM\HydroNet`(브랜치 `main`, 포트 4000)는 전무님이 서버로 사용 중 — 절대 수정/재시작/포트점유 금지.** dev 서버는 항상 4020(또는 그 외, 4000 아님)으로 띄우고 본인이 띄운 PID만 종료할 것.
- **푸시는 항상 Gitea·GitHub 둘 다** — `git push origin dev` **그리고** `git push github dev`. 한쪽만 올리지 말 것(절대). 2026-07-29 확정.
- **메인 레포 = Gitea `gitea.hmac.kr/saman/HydroNET`(리모트 `origin`, 인증 계정 `saman`).** GitHub(`hjlee624/HydroNet`)은 미러(리모트 `github`, 인증 계정 `hjlee624`). 커밋 작성자는 `HYUNJUNGLEE <hjlee@samaneng.com>` 고정. 2026-07-06 전환.
- **환경 강제**: Node **24.x LTS**(`.nvmrc`·3개 `package.json` `engines`·`.npmrc engine-strict`). 린트/포맷은 **Biome**(`npm run check` / `format`). 빌드는 **Vite 7**(Rollup). Rolldown(Vite 8)은 검증 완료·대기.
- ABS_RULE: 오류는 `error.log`에 남기고, 주요 변경 시 `README.md`를 함께 갱신하며, **Gitea(`origin`)·GitHub(`github`) 둘 다**에 커밋&푸시.

## 자주 쓰는 명령 (dev 폴더)
```bash
npm run dev                              # 클라 5273 + API 4020 (5173은 SYNC-BUILD 점유)
start-lan.bat                            # LAN 단일포트(기본 4020)
cd client && npm run build               # tsc --noEmit + vite
cd client && npx tsx scripts/smoke.ts        # 엔진 검증
cd client && npx tsx scripts/mount-test.ts   # jsdom 전체앱(빈화면 회귀 방지)
cd client && npx tsx scripts/check-single.ts # 단일 HTML 회귀(build:single 후)
npm run check                                # Biome 린트+포맷 체크(루트, client+server 공통)
```

## 변경 후 체크리스트
build + smoke + mount(단일 HTML 변경 시 build:single·check-single 추가) 통과 → (필요 시) README 갱신 → commit → **`git push origin dev` + `git push github dev`(Gitea·GitHub 둘 다, 필수)**.
