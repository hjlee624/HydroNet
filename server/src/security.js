import { createOriginPolicy } from './collab/origin.js'

const LOG_LEVELS = new Set(['info', 'warn', 'error'])

export function resolveAuthBackendConfig(env = process.env) {
  const backend = String(env.AUTH_BACKEND || 'memory')
    .trim()
    .toLowerCase()
  if (backend !== 'memory' && backend !== 'pg') {
    throw new Error(`Unsupported AUTH_BACKEND=${backend || '(empty)'}; expected memory or pg`)
  }
  const databaseUrl = String(env.DATABASE_URL || '').trim()
  if (backend === 'pg' && !databaseUrl) {
    throw new Error('AUTH_BACKEND=pg requires DATABASE_URL; refusing to start with mixed storage backends')
  }
  return { backend, databaseUrl: backend === 'pg' ? databaseUrl : null }
}

/** Adapts the WebSocket origin policy to an Express request. */
export function createHttpOriginPolicy(allowedOrigins) {
  const isAllowedWebSocketOrigin = createOriginPolicy(allowedOrigins)
  return function isAllowedHttpOrigin(req) {
    const origin = req.get?.('origin') ?? req.headers?.origin
    // CLI, health probes, and same-process requests do not send Origin.
    if (!origin) return true
    const host = req.get?.('host') ?? req.headers?.host
    if (!host) return false
    const protocol = req.protocol === 'https' ? 'https' : 'http'
    const requestUrl = `${protocol}://${host}${req.originalUrl || req.url || '/'}`
    return isAllowedWebSocketOrigin({
      headers: { get: (name) => (String(name).toLowerCase() === 'origin' ? origin : null) },
      url: requestUrl,
    })
  }
}

function boundedText(value, maxLength) {
  if (value === undefined || value === null) return ''
  return String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u001b]/g, '')
    .replace(/\r?\n/g, '\\n')
    .slice(0, maxLength)
}

function boundedContext(value) {
  if (value === undefined) return ''
  if (typeof value === 'string') return boundedText(value, 2_000)
  try {
    return boundedText(JSON.stringify(value), 2_000)
  } catch {
    return '[unserializable context]'
  }
}

/** Returns a strict, log-injection-safe client error payload. */
export function normalizeClientLogEntries(payload, options = {}) {
  const maxEntries = options.maxEntries ?? 20
  const source = Array.isArray(payload?.entries) ? payload.entries : [payload]
  if (source.length < 1 || source.length > maxEntries) {
    throw new Error(`client log entries must contain 1-${maxEntries} items`)
  }
  return source.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`client log entry ${index + 1} must be an object`)
    }
    const level = LOG_LEVELS.has(value.level) ? value.level : 'info'
    const message = boundedText(value.message, 500).trim()
    if (!message) throw new Error(`client log entry ${index + 1} requires message`)
    const stack = boundedText(value.stack, 4_000)
    const context = boundedContext(value.context)
    return { level, message, detail: stack || context || undefined }
  })
}

/** Fixed-window limiter bounded by maxTracked actor/IP keys. */
export function createBoundedRateLimiter(options = {}) {
  const limit = options.limit ?? 30
  const windowMs = options.windowMs ?? 60_000
  const maxTracked = options.maxTracked ?? 5_000
  const tracked = new Map()

  return {
    consume(key, now = Date.now()) {
      const normalizedKey = boundedText(key, 300) || 'unknown'
      let current = tracked.get(normalizedKey)
      if (!current || now >= current.resetAt) {
        current = { count: 0, resetAt: now + windowMs }
        tracked.delete(normalizedKey)
        tracked.set(normalizedKey, current)
      }
      current.count += 1

      if (tracked.size > maxTracked) {
        for (const [candidate, value] of tracked) {
          if (now >= value.resetAt || tracked.size > maxTracked) tracked.delete(candidate)
          if (tracked.size <= maxTracked) break
        }
      }

      return {
        allowed: current.count <= limit,
        retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1_000)),
      }
    },
    get size() {
      return tracked.size
    },
  }
}
