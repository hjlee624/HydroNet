/// <reference types="vite/client" />
// Vite 클라이언트 앰비언트 타입 — `?url`/`?raw`/`?worker` 에셋 임포트와 import.meta.env 를
// TypeScript 가 인식하도록 한다(BoqImportDialog 의 pdf.worker `?url` 임포트 등).

/**
 * 이 번들이 겨냥한 배포 형태(F05) — vite.config.ts 의 define 으로 주입된다.
 * 'standalone' = SINGLE=1 오프라인 단독 HTML(서버 없음), 'server' = 사내 서버 대상 배포.
 * vite 를 거치지 않는 실행 환경(tsx 스모크·jsdom mount-test)에는 존재하지 않으므로
 * 읽는 쪽에서 `typeof __SEQUENCE_DEPLOY__ === 'undefined'` 를 반드시 확인한다.
 */
declare const __SEQUENCE_DEPLOY__: 'standalone' | 'server'
