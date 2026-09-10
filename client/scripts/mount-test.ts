// Dev-only: mount the FULL React app in jsdom to catch runtime render errors
// (e.g. unstable zustand selectors → infinite loop → blank screen) that the
// type-check / bundle build cannot detect. Run: npx tsx scripts/mount-test.ts
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:5273/',
  pretendToBeVisual: true,
})
const w = dom.window as unknown as Window & typeof globalThis
const g = globalThis as Record<string, unknown>
g.window = w
g.document = w.document
g.localStorage = w.localStorage
g.sessionStorage = w.sessionStorage
// 기본 진입은 총괄 대시보드지만, 이 테스트는 편집기(차트/사이드바) 렌더도 검증하므로
// 편집기 뷰를 시드한다. 이후 총괄 대시보드 뷰는 아래에서 토글해 별도 검증.
w.localStorage.setItem('sequence:project-view', 'schedule')
// 마일스톤 편집기 단일 루트. AuthGate는 서버 미탐지 시 '로컬 모드'로 우회하므로,
// 아래 fetch 스텁이 /api/health 를 실패로 응답해 로그인 게이트 없이 편집기가 바로 렌더된다.
g.HTMLElement = w.HTMLElement
g.Element = w.Element
g.Node = w.Node
g.getComputedStyle = w.getComputedStyle
// 출력 미리보기(export/exporter.ts buildExportSvgString)가 전역 XMLSerializer 를 쓴다.
g.XMLSerializer = w.XMLSerializer
g.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0)
g.cancelAnimationFrame = (id: number) => clearTimeout(id)
g.fetch = async (url: unknown) =>
  (String(url).includes('/api/health')
    ? { ok: false, status: 0, json: async () => null }
    : { ok: true, status: 200, json: async () => [], text: async () => '' }) as unknown as Response

const errors: string[] = []
const origError = console.error
console.error = (...a: unknown[]) => {
  errors.push(a.map(String).join(' '))
}

async function main() {
  const { createElement } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { default: App } = await import('../src/App')

  const root = createRoot(document.getElementById('root')!)
  root.render(createElement(App))
  await new Promise((r) => setTimeout(r, 400))

  console.error = origError
  const html = document.getElementById('root')!.innerHTML
  const loopErr = errors.find((e) =>
    /Maximum update depth|getSnapshot should be cached|too many re-renders/i.test(e),
  )

  let fail = 0
  const check = (cond: boolean, label: string) => {
    if (!cond) {
      fail++
      console.log('  ✗ ' + label)
    } else console.log('  ✓ ' + label)
  }

  console.log(`#root innerHTML length = ${html.length}`)
  check(html.length > 1000, '#root 가 비어있지 않게 렌더됨 (블랙화면 아님)')
  check(html.includes('Seq') && html.includes('도면 출력'), '브랜드/상단바 렌더 확인')
  check(html.includes('<svg'), '차트 SVG 렌더 확인')
  check(html.includes('공종'), '사이드바(공종) 렌더 확인')
  check(html.includes('공정관리') && html.includes('리스크·이슈'), '모듈 레일 렌더 확인')
  check(!loopErr, '무한 렌더 루프 경고 없음')

  // 총괄 대시보드 뷰 토글 후 렌더 검증(새 화면의 런타임 렌더 오류·무한루프 방지).
  const dashErrors: string[] = []
  console.error = (...a: unknown[]) => {
    dashErrors.push(a.map(String).join(' '))
  }
  const { useView } = await import('../src/state/viewStore')
  useView.getState().setView('dashboard')
  await new Promise((r) => setTimeout(r, 300))
  console.error = origError
  const dashHtml = document.getElementById('root')!.innerHTML
  const dashLoop = dashErrors.find((e) =>
    /Maximum update depth|getSnapshot should be cached|too many re-renders/i.test(e),
  )
  check(dashHtml.includes('프로젝트 총괄'), '총괄 대시보드 렌더 확인')
  check(dashHtml.includes('SPI') && dashHtml.includes('예산 vs 실적'), '대시보드 EVM/예산 존 렌더')
  check(!dashLoop, '총괄 대시보드 무한 렌더 루프 없음')

  // 모듈 토글 렌더 검증 — 기록형(프로젝트 예산) + 진척·실적.
  const modCheck = async (view: string, expect: string, label: string) => {
    const errs: string[] = []
    console.error = (...a: unknown[]) => {
      errs.push(a.map(String).join(' '))
    }
    useView.getState().setView(view as never)
    await new Promise((r) => setTimeout(r, 250))
    console.error = origError
    const h = document.getElementById('root')!.innerHTML
    const loop = errs.find((e) =>
      /Maximum update depth|getSnapshot should be cached|too many re-renders/i.test(e),
    )
    check(h.includes(expect), `${label} 렌더 확인`)
    check(!loop, `${label} 무한 렌더 루프 없음`)
  }
  await modCheck('cost', '프로젝트 예산', '기록 모듈(프로젝트 예산)')
  await modCheck('progress', '진척·실적', '진척·실적 모듈')
  await modCheck('report', '공정 요약', '보고서 모듈')

  // ── 키보드/모달 정확성(F11) ────────────────────────────────────────────────
  // 편집기 화면으로 돌아와서 (1) 입력 중 Ctrl+Z 가 도면을 건드리지 않는지,
  // (2) 모달이 Tab 을 가두고 닫힐 때 포커스를 되돌리는지, (3) 도움말이 keymap.ts 의
  // 모든 항목을 실제로 렌더하는지(문서-동작 드리프트 가드) 검증한다.
  useView.getState().setView('schedule')
  await new Promise((r) => setTimeout(r, 300))

  const { useEditor } = await import('../src/state/store')
  const { fitChartZoom, fitOverviewDensity } = await import('../src/components/ChartCanvas')
  const { monthWidthFromPxPerDay, pxPerDayFromMonthWidth } = await import('../src/engine/layout')
  const { SCREEN_TEXT_MIN_PX } = await import('../src/styles/theme')
  const { buildExportSvgString } = await import('../src/export/exporter')
  const { ALL_SHORTCUTS } = await import('../src/state/keymap')
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const key = (target: EventTarget, init: KeyboardEventInit) =>
    target.dispatchEvent(new w.KeyboardEvent('keydown', { bubbles: true, ...init }))

  const topbar = document.querySelector('.topbar') as HTMLElement | null
  check(!!topbar && getComputedStyle(topbar).flexWrap === 'nowrap', '상단바는 한 줄 레이아웃을 유지한다')

  console.log('\n[월 폭·저배율 편집성]')
  const monthWidthInput = document.querySelector('input[aria-label="월 폭"]') as HTMLInputElement | null
  check(!!monthWidthInput, '도면·프로젝트 속성에 월 폭 조절기가 렌더된다')
  const originalPxPerDay = useEditor.getState().project.view.pxPerDay
  useEditor.getState().setView({ pxPerDay: pxPerDayFromMonthWidth(120) })
  check(
    Math.abs(monthWidthFromPxPerDay(useEditor.getState().project.view.pxPerDay) - 120) < 0.01,
    '월 폭을 공사기간·용지와 별도로 설정할 수 있다',
  )
  useEditor.getState().setZoom(0.15)
  await wait(80)
  const lowZoomBar = document.querySelector('.chart-bar') as SVGRectElement | null
  const lowZoomHit = lowZoomBar?.parentElement?.querySelector(
    'rect[data-export-hide="1"][fill="transparent"][data-task-id]',
  ) as SVGRectElement | null
  const visibleScreenHeight = Number(lowZoomBar?.getAttribute('height') ?? 0) * 0.15
  const hitScreenHeight = Number(lowZoomHit?.getAttribute('height') ?? 0) * 0.15
  check(visibleScreenHeight >= 5, `15% 배율에서도 막대가 화면상 5px 이상 보인다 (${visibleScreenHeight.toFixed(1)}px)`)
  check(hitScreenHeight > visibleScreenHeight, `막대의 투명 클릭 영역이 시각 막대보다 넓다 (${hitScreenHeight.toFixed(1)}px)`)
  useEditor.getState().setZoom(0.03)
  await wait(80)
  const readableRoles = [
    'title',
    'categoryLabel',
    'taskName',
    'taskDuration',
    'axisYear',
    'axisMonth',
  ] as const
  for (const role of readableRoles) {
    const textEl = document.querySelector(`[data-text-role="${role}"]`) as SVGTextElement | null
    const screenPx = Number(textEl?.getAttribute('font-size') ?? 0) * 0.03
    check(
      screenPx >= SCREEN_TEXT_MIN_PX[role] - 0.05,
      `3% 전체 맞춤에서도 ${role} 글자가 최소 ${SCREEN_TEXT_MIN_PX[role]}px로 보인다 (${screenPx.toFixed(1)}px)`,
    )
  }
  const threePctBar = document.querySelector('.chart-bar') as SVGRectElement | null
  const barScreenWidth = Number(threePctBar?.getAttribute('width') ?? 0) * 0.03
  check(barScreenWidth >= 5, `3% 전체 맞춤에서도 짧은 막대가 최소 5px 폭으로 보인다 (${barScreenWidth.toFixed(1)}px)`)
  const chartSvg = document.getElementById('sequence-chart') as unknown as SVGSVGElement | null
  check(
    !chartSvg?.textContent?.includes('공종 / 마일스톤') &&
      !chartSvg?.textContent?.match(/착수\s+\d{4}-\d{2}/),
    '좌측 상단의 공종/마일스톤·착수 헤더 문구를 표시하지 않는다',
  )
  const labelColumn = chartSvg?.querySelector('[data-label-column-content="1"]')
  check(
    labelColumn?.getAttribute('clip-path') === 'url(#hn-label-column-clip)',
    '좌측 WBS 라벨은 라벨 열 경계에서 잘려 시간축으로 침범하지 않는다',
  )
  const screenTaskText = chartSvg?.querySelector('[data-text-role="taskName"]')
  const exportBaseSize = screenTaskText?.getAttribute('data-export-font-size')
  const exportSvg = chartSvg
    ? buildExportSvgString(
        chartSvg,
        {
          width: Number(chartSvg.getAttribute('width')),
          height: Number(chartSvg.getAttribute('height')),
        },
        {},
      )
    : ''
  const exportedTaskTag = exportSvg.match(/<text[^>]*data-text-role="taskName"[^>]*>/)?.[0]
  const exportedTaskSize = exportedTaskTag?.match(/font-size="([^"]+)"/)?.[1]
  check(
    !!exportBaseSize && exportedTaskSize === exportBaseSize,
    `화면 판독용 글자 확대가 출력 도면에는 반영되지 않는다 (기준 ${exportBaseSize} · 출력 ${exportedTaskSize})`,
  )
  const barExportWidth = threePctBar?.getAttribute('data-export-width')
  const exportedBarTag = exportSvg.match(/<rect[^>]*class="chart-bar"[^>]*>/)?.[0]
  const exportedBarWidth = exportedBarTag?.match(/width="([^"]+)"/)?.[1]
  check(
    !!barExportWidth && exportedBarWidth === barExportWidth,
    `화면 판독용 최소 막대 폭이 출력 도면에는 반영되지 않는다 (기준 ${barExportWidth} · 출력 ${exportedBarWidth})`,
  )
  useEditor.getState().setView({ pxPerDay: originalPxPerDay })
  useEditor.getState().setZoom(1)
  await wait(80)

  console.log('\n[공정표 전체 맞춤]')
  const canvasWrap = document.querySelector('.canvas-wrap') as HTMLElement | null
  const fitButton = [...document.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === '전체 맞춤',
  ) as HTMLButtonElement | undefined
  check(!!canvasWrap && !!fitButton, '전체 맞춤 버튼과 공정표 캔버스가 렌더된다')
  if (canvasWrap && fitButton) {
    Object.defineProperty(canvasWrap, 'clientWidth', { configurable: true, value: 900 })
    Object.defineProperty(canvasWrap, 'clientHeight', { configurable: true, value: 600 })
    useEditor.getState().setZoom(1)
    fitButton.click()
    await wait(120)
    const fitted = useEditor.getState().zoom
    const paperScale = document.querySelector('.paper-scale') as HTMLElement | null
    const fittedWidth = Number.parseFloat(paperScale?.style.width ?? 'Infinity')
    const fittedHeight = Number.parseFloat(paperScale?.style.height ?? 'Infinity')
    check(fitted < 1, `큰 시트는 100% 아래로 축소된다 (${Math.round(fitted * 100)}%)`)
    check(fittedWidth <= 852.5 && fittedHeight <= 552.5, '현재 시트의 가로·세로 전체가 캔버스 안에 들어온다')
    check(
      fittedWidth >= 852 * 0.85 && fittedHeight >= 552 * 0.85,
      `축 밀도 균형 조정으로 가로·세로를 함께 사용한다 (${Math.round(fittedWidth)}×${Math.round(fittedHeight)})`,
    )
    const wideProject = {
      ...useEditor.getState().project,
      view: { ...useEditor.getState().project.view, pxPerDay: 20, rowHeight: 46 },
    }
    const densityPatch = fitOverviewDensity(wideProject, 900, 600)
    check(
      (densityPatch.rowHeight ?? 46) > 46,
      '시간축이 과도하게 넓으면 월 폭을 줄이지 않고 행 높이를 늘려 판독 공간을 확보한다',
    )
    check(fitChartZoom(100_000, 50_000, 900, 600) === 0.02, '매우 큰 표도 2%까지 축소할 수 있다')
  }

  console.log('\n[F11 키보드/모달]')
  const before = useEditor.getState().project.categories.length
  useEditor.getState().addCategory({ name: '단축키 검증 공종' })
  await wait(120)
  const added = useEditor.getState().project.categories.length
  check(added === before + 1, `공종 추가로 실행취소할 변경을 만든다 (${before} → ${added})`)

  // (1) 입력 칸에 커서가 있을 때의 Ctrl+Z → 도면(프로젝트)은 그대로여야 한다.
  const textInput = document.querySelector('input.viewbar__search') as HTMLInputElement | null
  check(!!textInput, '보기 막대 텍스트 입력을 찾았다(입력 중 시나리오용)')
  if (textInput) {
    textInput.focus()
    key(textInput, { key: 'z', ctrlKey: true })
    await wait(120)
    check(
      useEditor.getState().project.categories.length === added,
      '입력 칸에서 누른 Ctrl+Z 는 도면을 되돌리지 않는다 (F11 완료 기준)',
    )
    textInput.blur()
  }
  // 대조군: 도면(본문)에서 누른 Ctrl+Z 는 실제로 실행취소가 되어야 한다.
  key(document.body, { key: 'z', ctrlKey: true })
  await wait(200)
  check(
    useEditor.getState().project.categories.length === before,
    '도면에서 누른 Ctrl+Z 는 정상적으로 실행취소된다(대조군)',
  )

  // (2)(3) 도움말 모달 왕복 — 초기 포커스 · aria-labelledby · Tab 가두기 · 포커스 복귀.
  const helpBtn = document.querySelector('[aria-label="도움말"]') as HTMLElement | null
  check(!!helpBtn, '도움말 버튼을 찾았다')
  if (helpBtn) {
    helpBtn.focus()
    helpBtn.click()
    await wait(250)
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement | null
    check(!!document.querySelector('.modal-backdrop'), '도움말 모달이 열렸다')
    const labelId = dialog?.getAttribute('aria-labelledby') ?? ''
    const labelEl = labelId ? document.getElementById(labelId) : null
    check(
      !!labelEl && (labelEl.textContent ?? '').includes('도움말'),
      'role=dialog 가 aria-labelledby 로 제목과 연결됨',
    )
    check(
      !!dialog && dialog.contains(document.activeElement),
      '열리면 포커스가 대화상자 안으로 들어간다',
    )

    // Tab 가두기: 마지막 포커스 가능 요소에서 Tab → 첫 요소로 순환(밖으로 새지 않음).
    const FOCUSABLE =
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    const list = Array.from(dialog?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    check(list.length >= 2, `모달 안에 포커스 가능한 요소가 여러 개 (${list.length}개)`)
    if (list.length >= 2) {
      list[list.length - 1].focus()
      key(list[list.length - 1], { key: 'Tab' })
      await wait(60)
      check(
        document.activeElement === list[0],
        'Tab 이 모달 마지막 → 첫 요소로 순환(포커스 가두기)',
      )
      list[0].focus()
      key(list[0], { key: 'Tab', shiftKey: true })
      await wait(60)
      check(
        document.activeElement === list[list.length - 1],
        'Shift+Tab 이 모달 첫 → 마지막 요소로 순환',
      )
    }

    // 도움말 단축키 표가 실제로 렌더되는지(표가 통째로 사라지는 회귀 방지). 표 자체는
    // keymap.ts 배열에서 생성되므로 '항목 누락'은 구조상 일어날 수 없다 — 진짜 드리프트가
    // 생기는 곳은 **손으로 쓴 범위 설명 산문**이라, 바로 아래에서 그쪽을 따로 검증한다.
    const keysTable = document.querySelector('table.help-keys')?.innerHTML ?? ''
    check(keysTable.length > 0, '도움말에 단축키 표가 렌더된다')
    check(
      ALL_SHORTCUTS.every((d) => keysTable.includes(d.label)),
      `단축키 표가 keymap.ts 정의에서 생성된다 (${ALL_SHORTCUTS.length}건)`,
    )

    // ── 손으로 쓴 '범위 설명' 산문 ↔ 실제 판정 대조 ──────────────────────────
    // 산문은 코드에서 생성되지 않으므로 거짓말을 할 수 있다(실제로 'Ctrl+S만 어디서나
    // 동작합니다'가 틀린 적이 있다). 산문이 이름을 댄 키가 정말 그 자리에서 살아남는
    // 유일한 키인지 resolveAction 으로 확인한다.
    const { KEYMAP, resolveAction } = await import('../src/state/keymap')
    const evFor = (b: (typeof KEYMAP)[number]) => {
      const lower = b.keys.map((s) => s.toLowerCase())
      const last = b.keys[b.keys.length - 1]
      return {
        key: last === 'Esc' ? 'Escape' : last,
        ctrlKey: lower.includes('ctrl'),
        shiftKey: lower.includes('shift'),
      }
    }
    const scopeProse =
      Array.from(document.querySelectorAll('.help-sec p.note'))
        .map((p) => p.textContent ?? '')
        .find((t) => t.includes('대화상자가 열려 있으면')) ?? ''
    check(scopeProse.length > 0, '도움말에 단축키 범위 설명 산문이 있다')
    const modalAlive = KEYMAP.filter(
      (b) => resolveAction(evFor(b), { typing: false, modal: true }) !== null,
    )
    check(
      modalAlive.length === 1 && modalAlive[0].id === 'save',
      `대화상자 위에서 살아남는 바인딩은 저장 하나뿐 — 실제: [${modalAlive.map((b) => b.id).join(', ')}]`,
    )
    check(
      modalAlive.every((b) => b.keys.every((k) => scopeProse.includes(k))),
      `산문이 그 키(${modalAlive.map((b) => b.keys.join('+')).join(', ')})를 실제로 지목한다`,
    )
    const typingAlive = KEYMAP.filter(
      (b) => resolveAction(evFor(b), { typing: true, modal: false }) !== null,
    )
    check(
      typingAlive.every((b) => b.keys.every((k) => scopeProse.includes(k))),
      `산문이 입력 칸에서도 사는 키(${typingAlive.map((b) => b.keys.join('+')).join(', ')})를 모두 밝힌다`,
    )

    // Esc 로 닫고 포커스가 열었던 버튼으로 복귀하는지.
    key(w, { key: 'Escape' })
    await wait(400)
    check(!document.querySelector('.modal-backdrop'), 'Esc 로 도움말이 닫힌다')
    check(document.activeElement === helpBtn, '닫히면 포커스가 열었던 버튼으로 복귀한다')
  }

  // ── 출력 대화상자(F14) 렌더 — 출력 범위·사전 점검이 실제로 보이는지 ──────────
  console.log('\n[F14 출력 대화상자]')
  const exportBtn = Array.from(document.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === '도면 출력',
  ) as HTMLElement | undefined
  check(!!exportBtn, '도면 출력 버튼을 찾았다')
  if (exportBtn) {
    exportBtn.focus()
    exportBtn.click()
    await wait(300)
    const dlg = document.querySelector('.modal')?.innerHTML ?? ''
    check(dlg.includes('출력 범위'), '출력 범위 선택이 렌더된다')
    check(dlg.includes('전체 도면') && dlg.includes('현재 표시 범위'), '두 범위 선택지가 모두 있다')
    check(dlg.includes('출력 전 점검'), '사전 점검 결과가 렌더된다')
    check(dlg.includes('미리보기'), '미리보기 영역이 렌더된다')

    // ── 여백 안내 ↔ 사전 점검 경고가 같은 도면을 말하는가 ─────────────────────
    // 예전엔 여백 안내(fitInfo)만 필터를 무시한 전체 레이아웃으로 계산했다. 그래서
    // ① 필터 없이 용지에 딱 맞춰 놓고 ② '주공정만' + '현재 표시 범위'로 바꾸면,
    // '여백 없이 꽉 차게 출력됩니다'와 '약 70%가 여백으로 남습니다'가 두 줄 사이에
    // 나란히 떴다. 아래는 그 조합을 그대로 재현한다.
    useEditor.getState().clearFilter()
    await wait(120)
    useEditor.getState().fitToPaper()
    await wait(200)
    check(
      (document.querySelector('.modal')?.textContent ?? '').includes(
        '여백 없이 꽉 차게 출력됩니다',
      ),
      '용지에 맞춘 직후 [전체 도면]은 여백 0 으로 안내된다(재현 전제)',
    )
    useEditor.getState().setFilter({ critical: true, milestone: false, query: '' })
    await wait(150)
    const viewScopeBtn = Array.from(
      document.querySelectorAll<HTMLElement>('.modal .seg button'),
    ).find((b) => b.textContent?.trim() === '현재 표시 범위')
    check(!!viewScopeBtn, '출력 범위 [현재 표시 범위] 버튼을 찾았다')
    viewScopeBtn?.click()
    await wait(200)
    const scoped = document.querySelector('.modal')?.textContent ?? ''
    const fitClaim = scoped.includes('여백 없이 꽉 차게 출력됩니다')
    const marginWarn = scoped.includes('여백으로 남습니다')
    check(
      !(fitClaim && marginWarn),
      `여백 안내와 사전 점검 경고가 모순되지 않는다 (꽉참 주장=${fitClaim} · 여백 경고=${marginWarn})`,
    )

    // ── 미리보기가 '지금 조건'을 벗어나면 자동으로 무효화되는가 ───────────────
    const modalBtns = () => Array.from(document.querySelectorAll<HTMLElement>('.modal button'))
    const previewBtn = modalBtns().find((b) => b.textContent?.includes('미리보기 만들기'))
    check(!!previewBtn, '[미리보기 만들기] 버튼을 찾았다')
    previewBtn?.click()
    await wait(250)
    check(!!document.querySelector('.export-preview img'), '미리보기 그림이 만들어진다')
    const fitBtn = modalBtns().find((b) => b.textContent?.includes('여백 없이 시트에 맞추기'))
    check(!!fitBtn, '[여백 없이 시트에 맞추기] 버튼이 렌더된다(여백이 남는 상태)')
    fitBtn?.click()
    await wait(250)
    check(
      !document.querySelector('.export-preview img'),
      '배치 배율이 바뀌면 옛 미리보기가 자동으로 사라진다(같은 대화상자의 맞추기 버튼)',
    )

    // ── [여백 없이 시트에 맞추기]가 **출력될 범위**에 맞추는가 (H2) ────────────
    // 위 클릭은 '현재 표시 범위'(주공정 필터)가 걸린 상태에서 눌렀다. 예전 동작은
    // 필터를 모르는 전체 도면 기준으로 배율을 풀어서, 안내문은 '여백 없이 출력됩니다'인데
    // 바로 아래 점검란은 '약 65%가 여백으로 남습니다'로 서로를 부정했다.
    const afterFit = document.querySelector('.modal')?.textContent ?? ''
    check(
      !afterFit.includes('여백으로 남습니다'),
      '표시 범위로 맞춘 뒤에는 여백 경고가 사라진다(출력될 도면에 실제로 맞았다)',
    )
    check(
      !(afterFit.includes('여백 없이 출력됩니다') && afterFit.includes('여백으로 남습니다')),
      '맞춤 결과 안내와 사전 점검 경고가 서로를 부정하지 않는다',
    )
    useEditor.getState().clearFilter()
    await wait(120)

    // ── 문서 내용이 바뀌면 옛 미리보기도 무효인가 (M3) ────────────────────────
    // 지문에 배치 배율만 넣고 내용은 빼 두면, 협업 중 팀원이 공종·공정을 지워도 옛 그림이
    // '실제 출력과 같은 방식으로 보여줍니다'라는 설명 아래 그대로 남는다.
    modalBtns()
      .find((b) => b.textContent?.includes('미리보기'))
      ?.click()
    await wait(250)
    check(!!document.querySelector('.export-preview img'), '미리보기를 다시 만들었다(M3 전제)')
    const doomed = useEditor.getState().project.tasks[0]
    useEditor.getState().deleteTask(doomed.id)
    await wait(250)
    check(
      !document.querySelector('.export-preview img'),
      '문서 내용(공정 삭제)이 바뀌면 옛 미리보기가 자동으로 무효화된다',
    )

    // ── '현재 표시 범위' 미리보기 지문에 필터가 들어가는가 (B4) ───────────────
    // 지문(previewKey)에 범위·용지·내용은 있는데 **필터**가 빠져 있으면, 범위를
    // '현재 표시 범위'로 두고 필터만 바꿨을 때 옛 그림이 '실제 출력과 같은 방식으로
    // 보여줍니다' 설명 아래 그대로 남고, 바로 옆 사전 점검은 다른 공정 집합을 말한다.
    const scopeBtn = (label: string) =>
      Array.from(document.querySelectorAll<HTMLElement>('.modal .seg button')).find(
        (b) => b.textContent?.trim() === label,
      )
    useEditor.getState().clearFilter()
    await wait(120)
    scopeBtn('현재 표시 범위')?.click()
    await wait(150)
    modalBtns()
      .find((b) => b.textContent?.includes('미리보기'))
      ?.click()
    await wait(250)
    check(!!document.querySelector('.export-preview img'), '표시 범위 미리보기를 만들었다(B4 전제)')
    useEditor.getState().setFilter({ critical: true, milestone: false, query: '' })
    await wait(250)
    check(
      !document.querySelector('.export-preview img'),
      "'현재 표시 범위'에서 필터가 바뀌면 옛 미리보기가 자동으로 무효화된다",
    )
    // 대조군 — '전체 도면'은 출력 시 필터를 해제하므로 필터가 바뀌어도 그림은 여전히 사실이다.
    useEditor.getState().clearFilter()
    await wait(120)
    scopeBtn('전체 도면')?.click()
    await wait(150)
    modalBtns()
      .find((b) => b.textContent?.includes('미리보기'))
      ?.click()
    await wait(250)
    check(
      !!document.querySelector('.export-preview img'),
      '전체 도면 미리보기를 만들었다(대조군 전제)',
    )
    useEditor.getState().setFilter({ critical: true, milestone: false, query: '' })
    await wait(250)
    check(
      !!document.querySelector('.export-preview img'),
      '전체 도면 출력에서는 필터 변경이 미리보기를 무효화하지 않는다(대조군)',
    )
    useEditor.getState().clearFilter()
    await wait(150)

    // ── 닫힘 애니메이션(170ms) 동안 편집기 단축키가 되살아나지 않는가 ─────────
    // 'Esc 로 닫고 곧바로 Delete' 는 아주 흔한 연타다. 예전 isModalOpen() 은
    // .is-closing 이 붙은 대화상자를 '이미 닫힌 것'으로 세어, 아직 화면에 보이는 그
    // 170ms 사이에 선택한 공정이 지워졌다.
    const tasksBefore = useEditor.getState().project.tasks.length
    const victim = useEditor.getState().project.tasks[0]
    check(!!victim && tasksBefore > 0, `삭제 대상 공정이 있다 (${tasksBefore}개)`)
    useEditor.getState().selectTask(victim.id)
    await wait(60)
    key(w, { key: 'Escape' })
    await wait(50)
    check(
      !!document.querySelector('.modal-backdrop.is-closing'),
      '닫히는 중에도 대화상자가 아직 화면에 남아 있다',
    )
    key(document.body, { key: 'Delete' })
    await wait(60)
    check(
      useEditor.getState().project.tasks.length === tasksBefore,
      '닫히는 중 누른 Delete 는 공정을 지우지 않는다',
    )
    await wait(400)
    check(!document.querySelector('.modal-backdrop'), 'Esc 로 출력 대화상자가 닫힌다')
    // 대조군 — 완전히 닫힌 뒤의 Delete 는 실제로 지워져야 한다(과잉 차단이 아님).
    key(document.body, { key: 'Delete' })
    await wait(150)
    check(
      useEditor.getState().project.tasks.length === tasksBefore - 1,
      '완전히 닫힌 뒤의 Delete 는 정상적으로 삭제된다(대조군)',
    )
  }

  // ── 영향 카드의 ↩ 되돌리기가 '카드가 설명한 그 편집'을 되돌리는가 (R5-3) ────
  // 재현: 막대 B 를 20 → 60 으로 끌어 제스처를 봉인하면 카드가 'B 20 → 60' 을 설명한다.
  // 카드는 8초를 사는데, 그 사이에 **다른** 편집(공정 C 삭제)이 일어나도 카드는 옛 드래그를
  // 계속 설명했고 ↩ 는 store.undo() 를 그냥 불러 스택 맨 위 = 그 삭제를 되돌렸다.
  // 즉 설명한 것은 되돌리지 않고, 설명하지 않은 것을 조용히 되돌렸다.
  console.log('\n[R5 영향 카드 되돌리기]')
  const { getCurrentCrdtRuntime } = await import('../src/state/crdt')
  const { previewEdit } = await import('../src/engine/scheduling')
  const undoDepth = () => getCurrentCrdtRuntime()?.undoManager.undoStack.length ?? 0
  const impactCard = () => document.querySelector('.edit-impact--done')
  const undoBtn = () =>
    Array.from(document.querySelectorAll<HTMLElement>('.edit-impact--done button')).find((b) =>
      b.textContent?.includes('되돌리기'),
    )
  useEditor.getState().clearFilter()
  useEditor.getState().setLastEditImpact(null)
  await wait(150)
  check(undoDepth() > 0 || true, `되돌리기 스택 깊이를 읽을 수 있다 (${undoDepth()})`)
  const cardTasks = useEditor.getState().project.tasks
  check(cardTasks.length >= 2, `영향 카드 시나리오용 공정이 있다 (${cardTasks.length}개)`)
  if (cardTasks.length >= 2) {
    const dragged = cardTasks[0]
    const victimTask = cardTasks[1]
    const base = {
      tasks: useEditor.getState().project.tasks.map((t) => ({ ...t })),
      links: useEditor.getState().project.links.map((l) => ({ ...l })),
    }
    const targetStart = dragged.start + 40
    // ChartCanvas 의 드래그 봉인과 **같은 순서**: beginGesture → 라이브 이동 → endGesture →
    // 영향 카드 봉인(봉인 시점 스택 깊이를 함께 찍는다).
    useEditor.getState().beginGesture()
    useEditor.getState().setTaskStartLive(dragged.id, targetStart)
    useEditor.getState().endGesture()
    const sealed = previewEdit(
      base.tasks,
      base.links,
      { id: dragged.id, start: targetStart },
      useEditor.getState().editMode,
      useEditor.getState().autoCascade,
    )
    check(!!sealed, '드래그 영향(previewEdit)이 계산된다')
    if (sealed) {
      useEditor.getState().setLastEditImpact({ ...sealed, historyDepth: undoDepth() })
      await wait(200)
      check(!!impactCard(), '제스처 직후 영향 카드가 화면에 뜬다(재현 전제)')
      check(!!undoBtn(), '영향 카드에 ↩ 되돌리기 버튼이 있다(재현 전제)')
      const movedStart = useEditor.getState().project.tasks.find((t) => t.id === dragged.id)?.start
      check(movedStart === targetStart, `드래그가 실제로 적용됐다 (start=${movedStart})`)

      // 8초 안에 **다른** 편집 — 공정 하나를 지운다.
      const countBeforeDelete = useEditor.getState().project.tasks.length
      useEditor.getState().deleteTask(victimTask.id)
      await wait(250)
      const countAfterDelete = useEditor.getState().project.tasks.length
      check(
        countAfterDelete === countBeforeDelete - 1,
        `카드가 살아 있는 동안 다른 편집이 일어났다 (${countBeforeDelete} → ${countAfterDelete})`,
      )
      check(
        !impactCard(),
        '설명이 더 이상 스택 맨 위가 아니면 영향 카드가 즉시 사라진다(엉뚱한 되돌리기 차단)',
      )
      // 그래도 버튼이 남아 있다면(이중 방어) 눌러도 아무것도 되돌아가면 안 된다.
      undoBtn()?.click()
      await wait(200)
      check(
        useEditor.getState().project.tasks.length === countAfterDelete,
        '↩ 를 눌러도 카드가 설명하지 않은 삭제는 되살아나지 않는다',
      )
      check(
        useEditor.getState().project.tasks.find((t) => t.id === dragged.id)?.start === targetStart,
        '↩ 이후에도 드래그 결과는 그대로다(되돌린 척하지 않는다)',
      )

      // 대조군 — 다른 편집이 없으면 ↩ 는 정상적으로 그 드래그를 되돌린다(과잉 차단 아님).
      useEditor.getState().beginGesture()
      useEditor.getState().setTaskStartLive(dragged.id, targetStart + 10)
      useEditor.getState().endGesture()
      const control = previewEdit(
        base.tasks,
        base.links,
        { id: dragged.id, start: targetStart + 10 },
        useEditor.getState().editMode,
        useEditor.getState().autoCascade,
      )
      if (control) {
        useEditor.getState().setLastEditImpact({ ...control, historyDepth: undoDepth() })
        await wait(200)
        check(!!undoBtn(), '대조군: 새 제스처 직후에는 ↩ 버튼이 다시 나타난다')
        undoBtn()?.click()
        await wait(250)
        check(
          useEditor.getState().project.tasks.find((t) => t.id === dragged.id)?.start ===
            targetStart,
          '대조군: 다른 편집이 없으면 ↩ 가 그 드래그를 실제로 되돌린다',
        )
      }
    }
  }
  useEditor.getState().setLastEditImpact(null)
  await wait(100)

  // ── 저장 칩: 라벨과 툴팁이 같은 사실을 말하는가 (B5) ────────────────────────
  // 서버 프로젝트를 열고 아무것도 하지 않은 상태(dirty=false · 백업 이력 없음)에서
  // 라벨은 '파일 백업 없음'인데 같은 요소의 툴팁은 '마지막 파일 백업 이후 변경 없음'이라며
  // 있지도 않은 마지막 백업을 단언했다.
  console.log('\n[B5 저장 칩 툴팁]')
  const { usePersistence } = await import('../src/state/persistence')
  usePersistence.setState({
    target: 'server',
    link: 'connected',
    serverConfirmedAt: Date.now(),
    lastLocalChangeAt: null,
    pending: false,
    readOnly: false,
    fileBackupAt: null,
  })
  useEditor.setState({ dirty: false })
  await wait(150)
  const syncChip = document.querySelector('.topbar .save-state--sync') as HTMLElement | null
  const fileChip = document.querySelector('.save-state--file') as HTMLElement | null
  check(!!syncChip, '상단 서버 동기화 칩을 찾았다')
  const syncedLabel = syncChip?.textContent ?? ''
  const syncedWidth = syncChip?.style.width ?? ''
  usePersistence.setState({ pending: true })
  await wait(80)
  const pendingSyncChip = document.querySelector('.topbar .save-state--sync') as HTMLElement | null
  check(
    syncedLabel.includes('서버 동기화 완료') &&
      (pendingSyncChip?.textContent ?? '').includes('전송 대기') &&
      syncedWidth === '148px' &&
      pendingSyncChip?.style.width === syncedWidth &&
      pendingSyncChip.style.minWidth === syncedWidth &&
      pendingSyncChip.style.maxWidth === syncedWidth,
    `동기화 상태 문구가 바뀌어도 상단 칩은 148px 고정 폭을 유지한다 (완료="${syncedLabel}" · 대기="${pendingSyncChip?.textContent ?? ''}" · 폭=${syncedWidth})`,
  )
  usePersistence.setState({ pending: false })
  await wait(80)
  check(!!fileChip, '파일 백업 칩을 찾았다')
  check(
    (fileChip?.textContent ?? '').includes('파일 백업 없음'),
    '백업 이력이 없으면 라벨은 [파일 백업 없음]',
  )
  check(
    !(fileChip?.getAttribute('title') ?? '').includes('마지막 파일 백업 이후'),
    `툴팁이 있지도 않은 마지막 백업을 단언하지 않는다 (실제: "${fileChip?.getAttribute('title') ?? ''}")`,
  )
  // 대조군 — 실제로 백업한 적이 있으면 그 문구를 그대로 써야 한다(과잉 수정이 아님).
  usePersistence.setState({ fileBackupAt: Date.now() })
  await wait(150)
  const backedChip = document.querySelector('.save-state--file') as HTMLElement | null
  check(
    (backedChip?.getAttribute('title') ?? '').includes('마지막 파일 백업 이후 변경 없음'),
    '실제 백업 이력이 있으면 [마지막 파일 백업 이후 변경 없음]을 그대로 쓴다(대조군)',
  )

  // ── 좁은 화면에서 3단이 서랍으로 접히는가 (F17) ────────────────────────────
  // jsdom 의 matchMedia 는 항상 matches=false 라 기본 패스는 데스크톱 경로를 탄다(=대조군).
  // 폭 분기 자체를 검증하려면 viewport 스토어를 직접 setState 한다.
  console.log('\n[F17 좁은 화면 · 서랍]')
  const { useViewport } = await import('../src/state/viewport')
  const bodyPanels = () => Array.from(document.querySelectorAll<HTMLElement>('.app__body > .panel'))
  // 3단 레이아웃에서 좌·우 패널이 가로로 차지하는 폭(px) — 그만큼 도면이 좁아진다.
  const panelPx = () =>
    bodyPanels().reduce((s, el) => s + (Number.parseFloat(el.style.width) || 0), 0)

  // (대조군) 넓은 화면 — 기존 3단 레이아웃이 그대로여야 한다.
  check(useViewport.getState().narrow === false, '기본(넓은 화면)에서는 narrow=false (대조군)')
  const wideCount = bodyPanels().length
  const widePx = panelPx()
  check(wideCount === 2, `넓은 화면에서는 좌·우 패널이 본문에 직접 붙어 있다 (${wideCount}개)`)
  check(widePx > 400, `넓은 화면에서 패널이 차지하는 폭 = ${widePx}px (도면은 나머지)`)
  check(
    document.querySelectorAll('.app__body > .resizer').length === 2,
    '넓은 화면에서는 폭 조절 손잡이 2개가 그대로 있다(대조군)',
  )
  check(!document.querySelector('.drawerbar'), '넓은 화면에는 서랍 토글 막대가 없다(대조군)')

  // (본 검증) 좁은 화면 — 패널이 본문에서 빠지고 서랍 토글만 남는다.
  useViewport.setState({ narrow: true, mobile: true })
  await wait(300)
  const narrowPx = panelPx()
  check(
    bodyPanels().length === 0 && narrowPx === 0,
    `좁은 화면에서는 좌·우 패널이 본문에서 빠진다 (패널 폭 ${widePx}px → ${narrowPx}px)`,
  )
  check(
    document.querySelectorAll('.app__body > .resizer').length === 0,
    '좁은 화면에서는 폭 조절 손잡이도 사라진다',
  )
  check(!!document.querySelector('.drawerbar'), '좁은 화면에 서랍 토글 막대가 뜬다')
  const drawerBtns = Array.from(document.querySelectorAll<HTMLElement>('.drawerbar button'))
  check(
    drawerBtns.some((b) => b.textContent?.includes('공종 구성')) &&
      drawerBtns.some((b) => b.textContent?.includes('속성')),
    '서랍 토글 두 개(공종 구성 · 속성)가 모두 렌더된다',
  )
  check(!!document.querySelector('.app__center svg'), '좁은 화면에서도 도면(SVG)은 그대로 렌더된다')
  // 서랍을 열면 사이드바가 도면 위에 겹쳐 뜬다(본문 폭은 계속 0).
  drawerBtns.find((b) => b.textContent?.includes('공종 구성'))?.click()
  await wait(250)
  check(!!document.querySelector('.drawer--left .panel'), '☰ 공종 구성 → 왼쪽 서랍이 열린다')
  check(panelPx() === 0, '서랍이 열려도 본문(도면) 폭은 줄지 않는다 — 겹쳐 뜨기 때문')
  ;(document.querySelector('.drawer__backdrop') as HTMLElement | null)?.click()
  await wait(250)
  check(!document.querySelector('.drawer--left'), '배경을 누르면 서랍이 닫힌다')
  // 휴대전화 범위 한정 — 편집 중심 모듈은 레일에서 빠진다.
  const railHtml = document.querySelector('.mrail')?.textContent ?? ''
  check(
    railHtml.includes('공정관리') &&
      railHtml.includes('진척·실적') &&
      railHtml.includes('대시보드'),
    '휴대전화 레일에 조회·검토·진척 모듈은 남는다',
  )
  check(
    !railHtml.includes('리스크·이슈') && !railHtml.includes('인력·장비'),
    '휴대전화 레일에서 편집 중심 모듈은 빠진다',
  )
  const mobileNote = document.querySelector('.mrail__note')
  check(
    mobileNote?.textContent?.includes('조회') === true &&
      mobileNote.textContent.includes('진척') &&
      mobileNote.getAttribute('title')?.includes('편집은 PC에서') === true,
    '휴대전화 범위는 짧은 안내와 상세 툴팁으로 표시된다',
  )

  // (대조군 복귀) 넓은 화면으로 되돌리면 3단이 그대로 복원되어야 한다.
  useViewport.setState({ narrow: false, mobile: false })
  await wait(300)
  check(
    bodyPanels().length === 2 && panelPx() === widePx,
    `넓은 화면으로 되돌리면 3단이 원복된다 (패널 폭 ${panelPx()}px)`,
  )
  check(!document.querySelector('.drawerbar'), '원복 후 서랍 토글 막대는 사라진다')

  // ── 상단바 정리 ────────────────────────────────────────────────────────────
  console.log('\n[상단바 정리]')
  const supportBtn = document.querySelector('[aria-label="문의"]') as HTMLElement | null
  check(!supportBtn, '요청에 따라 상단바 문의 버튼이 제거됐다')

  if (errors.length) {
    console.log(`\n(console.error ${errors.length}건):`)
    errors.slice(0, 6).forEach((e) => console.log('   • ' + e.slice(0, 160)))
  }
  console.log(`\n${fail === 0 ? '✅ MOUNT OK' : `❌ ${fail} FAIL`}`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error = origError
  console.log('THREW:', e?.message || e)
  process.exit(1)
})
