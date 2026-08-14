// Sequence PWA 서비스워커 — 오프라인 앱 셸(네트워크 우선, 실패 시 캐시 폴백).
// Vite가 자산 파일명을 해시하므로 stale 위험이 낮다. 배포 시 CACHE 버전을 올린다.
// /api 응답은 절대 캐시하지 않는다(항상 최신).
const CACHE = 'sequence-v1'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api')) return // API는 항상 네트워크

  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone()
        caches
          .open(CACHE)
          .then((c) => c.put(req, copy))
          .catch(() => {})
        return res
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('/'))),
  )
})
