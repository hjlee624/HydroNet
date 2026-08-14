# Sequence

**토목 설계·시공 공정표(예정공정표 · 마일스톤) 관리 프로그램**

Sequence 는 토목 전 분야(도로·교량·터널·하천·상하수도·항만·철도·단지·지반·수자원/댐 등)의
**공정표를 그리고, 일정을 계산하고, 도면으로 출력**하는 웹 애플리케이션입니다. 시설물 유형을
고르면 그 유형의 표준 공종·공정 프리셋으로 공정표가 세팅되고, 막대를 끌어 일정을 잡으면
선후행(CPM)·주공정·전체 공기가 실시간으로 계산됩니다.

---

## 주요 기능

- **전사공통 시설물 프리셋** — 11개 분야 43종(도로·공항 / 교량 / 터널 / 하천·방재 / 상수도 /
  하수도 / 항만·해안 / 철도·궤도 / 단지·부지 / 지반·기초 / 환경·정화 / 수자원·댐) 각각의 표준
  시공 공정표(공종·공정·마일스톤) 템플릿.
- **새 도면 마법사** — 도면 유형(타당성 / 기본설계 / 실시설계 / 시공)과 시설물 유형을
  검색·선택하고, 시작 전 **공정표 샘플(총 공기·공종·마일스톤)** 을 미리 봅니다.
- **일정 엔진(CPM)** — 선후행(FS/SS/FF/SF·지연) 연결, 주공정(Critical Path)·여유(Float)
  자동 계산, 연쇄 자동 이동·일정 정렬·재계산.
- **예정공정표 ↔ 마일스톤 연동** — 설계 단계 사업은 예정공정표와 시공 마일스톤 시트를 함께 관리.
- **우기 음영**, 연도/월 구분선, WBS(공종·세부공종) 좌측 라벨, 자유로운 막대 이동(날짜 제약 없음).
- **실시간 협업** — 같은 프로젝트에 동시 접속 시 다른 참여자의 커서·선택 위치가 이름·역할
  (관리자/사용자) 배지로 표시(Yjs/CRDT 기반).
- **인증 · 권한(RBAC)** — 개발자 / 프로젝트 관리자(PM) / 사용자. 개발자는 프로젝트 생성·삭제·
  활성/비활성 관리, PM 은 담당 프로젝트 멤버·접속코드 관리.
- **도면 출력** — A4~A0, 가로/세로, SVG · PNG · JPG · PDF · DXF, DPI 조절, 용지 맞춤.
- **동적 로그인 배경** — 마우스에 반응하는 패럴랙스 모션 배경.

---

## 기술 스택

| 영역 | 스택 |
|------|------|
| Client | React 18 · TypeScript · Vite · Zustand · Yjs(+y-indexeddb) · jsPDF |
| Server | Node.js · Express · Hocuspocus(WebSocket) · PostgreSQL(또는 파일 기반 메모리 저장소) |
| 협업/영속 | CRDT(Y.Doc) — room = projectId, IndexedDB(로컬) + 서버 영속 |
| 품질 | Biome(lint · format) |

요구 런타임: **Node.js ≥ 24 < 25**, **npm ≥ 11**.

---

## 프로젝트 구조

```
Sequence/
├─ client/            # React + Vite 프런트엔드
│  ├─ src/
│  │  ├─ components/  # 차트·도면·다이얼로그·인증 UI
│  │  ├─ data/        # 시설물 유형·공정표 프리셋(facilities, civilFacilities, templates)
│  │  ├─ engine/      # 일정(CPM)·레이아웃·라우팅·날짜
│  │  ├─ export/      # SVG/PNG/PDF/DXF 출력
│  │  └─ state/       # store(zustand) · crdt · collaboration · auth
│  └─ public/         # 폰트·PWA·프리셋 애셋
├─ server/            # Express + Hocuspocus 협업/인증 서버
│  └─ src/{auth,collab}/
└─ package.json       # 워크스페이스 스크립트(concurrently)
```

---

## 개발

```bash
npm install          # 루트 + client + server 의존성 설치(postinstall)
npm run dev          # 서버 + 클라이언트 동시 실행(concurrently)
npm run build        # 클라이언트 프로덕션 빌드(tsc --noEmit && vite build)
npm run lint         # Biome 린트
npm run check:fix    # Biome 린트+포맷 자동수정
```

개별 실행:

```bash
npm run dev:client   # Vite 개발 서버만
npm run dev:server   # 협업/인증 서버만
```

### 사내망(LAN) 실행

`start-lan.bat` 로 LAN 접속용 서버를 기동합니다. 서버가 없으면 클라이언트는 자동으로
오프라인(로컬 단일 사용자) 모드로 동작합니다.

### 단일 HTML 배포본

```bash
npm --prefix client run build:single   # → Sequence.html (오프라인 단독 실행 파일)
```

---

## 배포 / 서버 설정

- **DB** — 운영은 PostgreSQL(`AUTH_BACKEND=pg`, `DATABASE_URL`). 스키마: `server/db/schema.sql`.
  파일 기반 메모리 저장소로도 동작(소규모/사내).
- **초기 계정** — 사용자가 하나도 없으면 환경변수(`AUTH_BOOTSTRAP_USER` /
  `AUTH_BOOTSTRAP_PASSWORD`, 기본 `admin` / `sequence`)로 개발자 계정을 시드합니다.
- **권한** — 개발자(전체) · PM(담당 프로젝트) · 사용자(부여받은 프로젝트, 접속코드 입력).

---

## 브랜치

이 저장소의 `Sequence` 브랜치가 Sequence 애플리케이션 전용 라인입니다.
