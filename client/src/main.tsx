import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/index.css'
import { installGlobalErrorLogging, logInfo } from './state/logger'

installGlobalErrorLogging()
logInfo('HydroNet 클라이언트 시작')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// PWA: 설치형/오프라인 지원. 보안 컨텍스트(https·localhost)에서만 등록한다 —
// file:// 단일 HTML·비보안 LAN(http)·jsdom(mount-test)에서는 조용히 건너뛴다.
if (
  'serviceWorker' in navigator &&
  window.isSecureContext &&
  window.location.protocol !== 'file:'
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
