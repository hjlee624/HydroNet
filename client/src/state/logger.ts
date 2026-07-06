// Client-side error funnel. Per ABS_RULE.md, all program errors must be
// recorded in error.log so an identified defect never silently repeats.
// Messages are POSTed to the server, which appends them to error.log. Failures
// here are swallowed (logging must never crash the app) but mirrored to console.

export type LogLevel = 'error' | 'warn' | 'info'

interface LogPayload {
  level: LogLevel
  message: string
  context?: unknown
  stack?: string
  at: string
}

let queue: LogPayload[] = []
let flushing = false

async function flush(): Promise<void> {
  if (flushing || queue.length === 0) return
  flushing = true
  const batch = queue
  queue = []
  try {
    await fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: batch }),
      keepalive: true,
    })
  } catch {
    // Server unavailable (e.g. standalone client). Keep a console trail.
    for (const e of batch)
      console[e.level === 'info' ? 'log' : e.level](`[HydroNet] ${e.message}`, e.context ?? '')
  } finally {
    flushing = false
    if (queue.length) void flush()
  }
}

export function log(level: LogLevel, message: string, context?: unknown): void {
  const payload: LogPayload = {
    level,
    message,
    context,
    at: new Date().toISOString(),
  }
  if (context instanceof Error) payload.stack = context.stack
  queue.push(payload)
  // Batch within a tick to avoid a request per keystroke.
  setTimeout(flush, 250)
}

export const logError = (m: string, c?: unknown) => log('error', m, c)
export const logWarn = (m: string, c?: unknown) => log('warn', m, c)
export const logInfo = (m: string, c?: unknown) => log('info', m, c)

/** Install global handlers so uncaught errors reach error.log too. */
export function installGlobalErrorLogging(): void {
  window.addEventListener('error', (e) => {
    logError(`Uncaught: ${e.message}`, { filename: e.filename, lineno: e.lineno, colno: e.colno })
  })
  window.addEventListener('unhandledrejection', (e) => {
    logError('Unhandled promise rejection', { reason: String((e as PromiseRejectionEvent).reason) })
  })
}
