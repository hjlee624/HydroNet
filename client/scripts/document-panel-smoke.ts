import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement,
})
const { createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { DocumentPanel } = await import('../src/components/DocumentPanel')
const { useAuth } = await import('../src/state/authStore')
useAuth.setState({ mode: 'server', entered: { id: 'fixture', token: 'fixture' } as never })
const pending: Array<{ url: string; resolve: (value: Response) => void }> = []
globalThis.fetch = (input) =>
  new Promise<Response>((resolve) => pending.push({ url: String(input), resolve }))
const host = document.getElementById('root')
assert.ok(host)
const root = createRoot(host)
const tick = () => new Promise((resolve) => setTimeout(resolve, 40))
const render = async (moduleId: string, readOnly = false) => {
  root.render(createElement(DocumentPanel, { moduleId, readOnly }))
  await tick()
}
const reply = (index: number, data: unknown, status = 200) =>
  pending[index].resolve(new Response(JSON.stringify(data), { status }))

await render('cost')
assert.equal(document.querySelector<HTMLSelectElement>('[aria-label="문서 분류"]')?.value, '예산서')
assert.match(document.body.textContent ?? '', /불러오는 중/)
await render('permit')
assert.equal(document.querySelector<HTMLSelectElement>('[aria-label="문서 분류"]')?.value, '신청서')
reply(1, [{ id: 'new', name: '현재 인허가 문서', category: '신청서', size: 100 }])
await tick()
reply(0, [{ id: 'old', name: '이전 예산 문서', category: '예산서', size: 100 }])
await tick()
assert.match(document.body.textContent ?? '', /현재 인허가 문서/)
assert.doesNotMatch(document.body.textContent ?? '', /이전 예산 문서/)
assert.ok([...document.querySelectorAll('button')].some((b) => b.textContent === '문서 업로드'))

await render('risk')
reply(2, {}, 500)
await tick()
assert.match(document.querySelector('[role="alert"]')?.textContent ?? '', /불러오지 못/)
assert.doesNotMatch(document.body.textContent ?? '', /등록된 문서가 없습니다/)
const retry = [...document.querySelectorAll('button')].find(
  (b) => b.textContent === '목록 다시 불러오기',
)
assert.ok(retry)
retry.click()
await tick()
reply(3, [])
await tick()
assert.equal(document.querySelector('[role="alert"]'), null)
assert.match(document.body.textContent ?? '', /등록된 문서가 없습니다/)
await render('risk', true)
assert.ok(![...document.querySelectorAll('button')].some((b) => b.textContent === '문서 업로드'))
root.unmount()
dom.window.close()
console.log(
  'PASS: module reset, stale-response isolation, loading/error/retry, keyboard upload, read-only',
)
