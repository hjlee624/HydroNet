import {
  formatLoginPhoneInput,
  loginPhoneDigits,
  normalizeLoginSubmission,
} from '../src/state/authStore'

let failed = 0
const check = (condition: boolean, label: string) => {
  console.log(`${condition ? '  ✓' : '  ✗'} ${label}`)
  if (!condition) failed++
}

check(formatLoginPhoneInput('01012345678') === '010-1234-5678', '11자리 자동 하이픈')
check(formatLoginPhoneInput('010a1234b5678') === '010-1234-5678', '비숫자 제거')
check(formatLoginPhoneInput('01012345678999') === '010-1234-5678', '11자리 제한')
check(formatLoginPhoneInput('010123') === '010-123', '부분 입력 유지')
check(loginPhoneDigits('010-1234-5678') === '01012345678', 'submit digits-only')
check(
  normalizeLoginSubmission('010-1234-5678') === '01012345678',
  '로그인 payload canonical digits',
)
check(normalizeLoginSubmission('break-glass') === 'break-glass', '비전화 ID 호환 유지')

console.log(failed === 0 ? '\n✅ AUTH PHONE FORMAT PASS' : `\n❌ ${failed} FAIL`)
process.exit(failed ? 1 : 0)
