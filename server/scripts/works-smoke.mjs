// 네이버웍스 알림 모듈 오프라인 스모크 — 모듈 로드 + 순수 로직 검증(네트워크 없음).
// 실제 발송은 크리덴셜 설정 후 관리자 도구 '알림 테스트' 버튼으로 확인.
//   실행: npm run works-smoke   (server/)
import {
  buildRegistrationText,
  isConfigured,
  worksConfig,
} from '../src/notify/works.js'

let failures = 0
const check = (cond, label) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`)
  if (!cond) failures++
}

// 1) 미설정이면 isConfigured=false
check(!isConfigured(worksConfig({})), '빈 env → 미설정(false)')

// 2) 6개 필수값 모두 있으면 true
const fullEnv = {
  WORKS_CLIENT_ID: 'cid',
  WORKS_CLIENT_SECRET: 'secret',
  WORKS_SERVICE_ACCOUNT: 'svc@example.com',
  WORKS_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nAAA\\n-----END PRIVATE KEY-----',
  WORKS_BOT_ID: '123',
  WORKS_NOTIFY_USER_ID: 'me@example.com',
}
const cfg = worksConfig(fullEnv)
check(isConfigured(cfg), '필수 6개 env → 설정됨(true)')
check(cfg.privateKey.includes('\n') && !cfg.privateKey.includes('\\n'), '프라이빗 키 \\n → 실제 개행 복원')

// 3) 하나라도 빠지면 false
check(
  !isConfigured(worksConfig({ ...fullEnv, WORKS_BOT_ID: '' })),
  'BOT_ID 누락 → 미설정(false)',
)

// 4) 알림 본문: 이름·전화포맷·본부라벨·역할라벨·앱링크 포함
const text = buildRegistrationText(
  { name: '홍길동', id: '01012345678', role: 'pm', division: 'water-res' },
  'https://app.example.com',
)
check(text.includes('홍길동'), '본문에 이름 포함')
check(text.includes('010-1234-5678'), '전화번호 하이픈 포맷')
check(text.includes('수자원본부'), '본부 키→라벨 변환')
check(text.includes('관리자(PM)'), '역할 키→라벨 변환')
check(text.includes('https://app.example.com'), '앱 링크 포함')

// 5) 앱링크 없으면 링크 라인 없음
const noUrl = buildRegistrationText({ name: 'A', id: 'x', role: 'user', division: 'cm' })
check(!noUrl.includes('http'), '앱링크 미설정 시 링크 없음')
check(noUrl.includes('CM'), '라벨 없는 division(CM) 그대로')

console.log(failures ? `\n${failures}건 실패` : '\n모두 통과')
process.exit(failures ? 1 : 0)
