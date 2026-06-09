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
