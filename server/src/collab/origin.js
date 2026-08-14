import net from 'node:net'

function normalizeOrigin(value) {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    return url.origin.toLowerCase()
  } catch {
    return null
  }
}

function isLanHostname(hostname) {
  const host = String(hostname || '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.local') || !host.includes('.')) return true
  if (net.isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number)
    return (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 192 && b === 168) ||
      (a === 172 && b >= 16 && b <= 31)
    )
  }
  return (
    net.isIP(host) === 6 &&
    (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:'))
  )
}

export function createOriginPolicy(allowedOrigins = process.env.COLLAB_ALLOWED_ORIGINS) {
  const explicit = new Set(
    String(allowedOrigins || '')
      .split(',')
      .map((item) => normalizeOrigin(item.trim()))
      .filter(Boolean),
  )

  return function isAllowedOrigin(request) {
    const origin = normalizeOrigin(request.headers.get('origin'))
    if (!origin) return false
    if (explicit.has(origin)) return true

    const originUrl = new URL(origin)
    const requestUrl = new URL(request.url)
    // Browsers using the served LAN URL are same-origin regardless of whether
    // that host is localhost, a private IP, or an mDNS/single-label LAN name.
    return (
      originUrl.host.toLowerCase() === requestUrl.host.toLowerCase() &&
      isLanHostname(originUrl.hostname)
    )
  }
}
