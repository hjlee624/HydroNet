# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-09-10
- Primary product surfaces: 프로젝트 선택, 총괄 대시보드, 공정관리 편집기, 진척·실적 및 보고서
- Evidence reviewed: `README.md`, `client/src/components/DashboardModule.tsx`, `client/src/styles/index.css`, `client/src/styles/theme.ts`, `SHOTS/`

## Brand
- Personality: 신뢰할 수 있고 차분한 토목 공정관리 도구
- Trust signals: 동일 산식에서 파생된 KPI, 명확한 상태·경보, 근거가 보이는 일정 및 원가 정보
- Avoid: 장식 위주의 카드, 과도한 색상, 정보가 중앙의 좁은 열에 몰리는 레이아웃

## Product goals
- Goals: 프로젝트 현황을 한 화면에서 빠르게 파악하고 관련 모듈로 이동하게 한다.
- Non-goals: 대시보드 안에서 모든 원본 데이터를 직접 편집하지 않는다.
- Success signals: 넓은 화면의 가용 폭을 고르게 사용하고, 주요 KPI와 경보를 스크롤 전에 비교할 수 있다.

## Personas and jobs
- Primary personas: 공정 담당자, 사업관리자(PM), 검토자
- User jobs: 일정·진척·원가 상태 확인, 이상 징후 발견, 공정표·업무 모듈 진입
- Key contexts of use: 사무실 PC와 노트북의 가로형 화면, 회의 중 현황 공유

## Information architecture
- Primary navigation: 좌측 모듈 레일
- Core routes/screens: 프로젝트 선택 → 대시보드 → 공정관리/진척·실적/원가/보고서
- Content hierarchy: 프로젝트 상태와 실행 버튼 → 성과지표 → 일정 KPI → 경보·EVM → 마일스톤·시트 → 설명

## Design principles
- 가용 공간을 쓰되 정보 밀도를 억지로 높이지 않는다.
- 같은 위계의 정보는 동일한 그리드와 간격으로 비교 가능하게 배치한다.
- Tradeoffs: 초광폭 화면에서도 카드가 지나치게 길어지지 않도록 콘텐츠 폭은 1600px로 제한한다.

## Visual language
- Color: 기존 cream/canvas/primary 상태 토큰을 유지한다.
- Typography: 기존 본문·KPI 크기와 숫자 위계를 유지한다.
- Spacing/layout rhythm: 12–16px 카드 간격, 16–48px 반응형 외곽 여백, 중앙 정렬된 유동 그리드
- Shape/radius/elevation: 기존 12–14px 카드 반경과 미세한 테두리·그림자
- Motion: hover 상태만 짧게 사용하며 reduced-motion을 존중한다.
- Imagery/iconography: 기존 기능 아이콘과 상태 배지만 사용한다.

## Components
- Existing components to reuse: DashboardModule KPI, hero card, panel, alert, EVM bar
- New/changed components: 대시보드 공통 콘텐츠 폭 및 반응형 그리드 규칙
- Variants and states: 데이터 있음/없음, 경보 있음/없음, 읽기 전용, 좁은 화면
- Token/component ownership: 색상은 기존 CSS 변수, 대시보드 폭은 `.seq-dash`의 `--dash-content-max`
- 기록형 모듈: 제목·표·빈 상태·첨부 문서를 동일한 1180px 중앙 기준선으로 정렬한다. 입력은 행 번호와 필드명으로 접근성 이름을 제공한다.
- 저장 안내: 실제 영속 상태를 표시하는 `SaveStatusChip`을 재사용한다. 첨부 문서 저장은 별도라는 점을 명시한다.

## Accessibility
- Target standard: WCAG 2.1 AA 지향
- Keyboard/focus behavior: 기존 button/link 의미와 키보드 접근성을 보존한다.
- Contrast/readability: 기존 상태색과 텍스트 토큰을 유지한다.
- Screen-reader semantics: 제목 계층과 section 구조를 유지한다.
- Reduced motion and sensory considerations: `prefers-reduced-motion`에서 전환 효과를 제거한다.

## Responsive behavior
- Supported breakpoints/devices: 휴대전화부터 1920px 이상 데스크톱
- Layout adaptations: 넓은 화면은 1600px까지 확장, 중간 화면은 가용 폭 전체, 좁은 화면은 카드가 자동 줄바꿈·단일 열화한다.
- Touch/hover differences: 핵심 정보는 hover 없이 보이며 버튼 터치 영역을 유지한다.
- 첨부 문서: 좁은 화면에서도 분류·개정·상태를 유지하고 업로드·미리보기 도구는 줄바꿈한다.
- 공정표 배율: 예정공정표와 마일스톤 모두 현재 시트의 가로·세로 전체를 캔버스에 맞추는 명시적 동작을 제공한다. 큰 표는 25% 아래로도 축소할 수 있어야 한다.
- 공정표 편집 밀도: 월 폭은 용지 규격과 별도로 사용자가 조절한다. 용지 변경은 월 폭·행 높이를 자동 변경하지 않으며, 낮은 화면 배율에서도 막대와 마일스톤은 잡을 수 있는 최소 포인터 영역을 유지한다.
- 공정표 전체 맞춤 판독성: 전체 도면을 한 화면에 넣더라도 공사명·공종·공정·세부공정·연·월·막대명·공사일수는 역할별 최소 화면 크기를 유지한다. 이 화면 보정은 출력 도면의 사용자 지정 글자 크기를 바꾸지 않는다.
- 상단 상태 안정성: 서버 동기화·파일 백업 문구가 바뀌어도 상태 칸은 같은 폭을 유지해 편집 중 도구와 작업 화면이 좌우로 움직이지 않는다.
- 공정표 WBS 경계: 좌측 상단의 중복 헤더 문구는 표시하지 않는다. 공종·공정·세부공정 라벨은 저배율에서도 좌측 라벨 열을 넘어 시간축으로 침범하지 않는다.
- 세부공정 행 배치: 세부공정은 `parentId` 소속을 유지한 채 같은 상위 공정 블록 안에서 같은 줄에 합치거나 위·아래 별도 줄로 나눌 수 있다.
- 연결선 판독성과 편집: 전체 맞춤에서도 연결선 두께와 화살촉은 막대 높이에 비례한 최소 화면 크기를 유지한다. 투명 선택 영역은 화면 기준 14px 이상이며, 연결 속성 탭의 목록에서도 대상을 선택해 선 종류·두께를 수정할 수 있다.

## Interaction states
- Loading: 전역 프로젝트 로딩 흐름을 따른다.
- Empty: 공정표에서 공정을 추가하는 직접 링크를 제공한다.
- Error: 모듈 경보와 전역 오류 표시를 사용한다.
- 첨부 목록 오류는 빈 목록과 구분하고 다시 불러오기 버튼을 제공한다. 모듈·프로젝트 전환 시 이전 문서와 업로드 분류를 이월하지 않는다.
- Success: 경보 없음 상태를 명시한다.
- Disabled: 읽기 전용에서는 기준선 저장 액션을 숨긴다.
- Offline/slow network, if applicable: 로컬 프로젝트 상태와 기존 저장·동기화 표시를 따른다.

## Content voice
- Tone: 짧고 업무 중심적인 한국어
- Terminology: 예정공정표, 시공 마일스톤, 주공정(CP), 기준선, 진척·실적
- Microcopy rules: 상태·수치·행동을 먼저 쓰고 설명은 보조 문구로 둔다.

## Implementation constraints
- Framework/styling system: React, Zustand, 단일 `client/src/styles/index.css`
- Design-token constraints: 기존 CSS 변수를 재사용하고 새 디자인 시스템을 만들지 않는다.
- Performance constraints: 레이아웃 변경은 CSS 그리드로 처리하고 추가 런타임 계산을 만들지 않는다.
- Compatibility constraints: 기존 대시보드 DOM과 작은 화면의 `auto-fit` 동작을 보존한다.
- Test/screenshot expectations: TypeScript/build, mount smoke, 데스크톱·좁은 화면 시각 확인

## Open questions
- [ ] 실제 사내 표준 모니터 해상도별 선호 정보 밀도 / 제품 담당자 / 향후 사용자 검증
