// Client-side error funnel. Per ABS_RULE.md, all program errors must be
// recorded in error.log so an identified defect never silently repeats.
// Messages are POSTed to the server, which appends them to error.log. Failures
// here are swallowed (logging must never crash the app) but mirrored to console.

import { APP_VERSION } from '../data/support'

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

// 앱 안의 '문의'(SupportDialog)에서 담당자에게 붙여넣을 수 있도록 최근 로그를 링버퍼로
// 보관한다. 서버 /api/log 는 인증 게이트 뒤라 로컬 모드·미로그인 상태에서는 아무것도
// 남지 않으므로, 진단 정보는 클라이언트 쪽 사본에서 만든다(전송은 하지 않는다).
const RECENT_MAX = 50
const recent: LogPayload[] = []

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
      console[e.level === 'info' ? 'log' : e.level](`[Sequence] ${e.message}`, e.context ?? '')
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
  recent.push(payload)
  if (recent.length > RECENT_MAX) recent.shift()
  // Batch within a tick to avoid a request per keystroke.
  setTimeout(flush, 250)
}

export const logError = (m: string, c?: unknown) => log('error', m, c)
export const logWarn = (m: string, c?: unknown) => log('warn', m, c)
export const logInfo = (m: string, c?: unknown) => log('info', m, c)

/** 앱 안에서 읽을 수 있는 최근 로그 사본(오래된 것부터). 전송하지 않는다. */
export function recentLogs(): readonly LogPayload[] {
  return recent
}

/**
 * 이 번들이 겨냥한 배포 형태(F05 의 define). vite 를 거치지 않는 실행 환경
 * (tsx 스모크·jsdom mount-test)에서는 'unknown'.
 */
export function deployMode(): 'standalone' | 'server' | 'unknown' {
  return typeof __SEQUENCE_DEPLOY__ === 'undefined' ? 'unknown' : __SEQUENCE_DEPLOY__
}

/**
 * 문의용 진단 정보를 **문자열로만** 만든다(자동 발송 없음 — 사용자가 복사해서 붙여넣는다).
 *
 * 개인정보 금지 — 전화번호(=로그인 아이디)·비밀번호·세션 토큰은 절대 포함하지 않는다.
 * 그래서 이 함수는 authStore 를 참조하지 않으며, 프로젝트/모듈 같은 맥락은 호출자가
 * `extra` 로 넘긴다(store 를 import 하면 순환 의존이 된다).
 */
export function buildDiagnostics(extra?: Record<string, unknown>): string {
  const w = typeof window === 'undefined' ? null : window
  const lines: string[] = ['[Sequence 진단 정보]']
  lines.push(`앱 버전: ${APP_VERSION}`)
  lines.push(`배포 형태: ${deployMode()}`)
  lines.push(`생성 시각: ${new Date().toISOString()}`)
  if (w) {
    lines.push(`주소: ${w.location?.href ?? '-'}`)
    lines.push(`화면: ${w.innerWidth}×${w.innerHeight}`)
    lines.push(`브라우저: ${w.navigator?.userAgent ?? '-'}`)
  } else {
    lines.push('주소: - (브라우저 아님)')
  }
  for (const [k, v] of Object.entries(extra ?? {})) lines.push(`${k}: ${String(v)}`)
  const errs = recent.filter((e) => e.level === 'error').slice(-5)
  lines.push(`최근 오류(${errs.length}건):`)
  if (errs.length === 0) lines.push('  - 없음')
  else for (const e of errs) lines.push(`  - [${e.at}] ${e.message}`)
  return lines.join('\n')
}

/** Install global handlers so uncaught errors reach error.log too. */
export function installGlobalErrorLogging(): void {
  window.addEventListener('error', (e) => {
    logError(`Uncaught: ${e.message}`, { filename: e.filename, lineno: e.lineno, colno: e.colno })
  })
  window.addEventListener('unhandledrejection', (e) => {
    logError('Unhandled promise rejection', { reason: String((e as PromiseRejectionEvent).reason) })
  })
}
