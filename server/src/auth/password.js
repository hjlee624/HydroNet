// 비밀번호 정책 — 8~12자, 허용문자 [A-Za-z0-9!@#$%^&*], 영문·숫자·특수 중 2종 이상 조합.
// client/src/utils/password.ts 와 규칙·문구를 동일하게 유지할 것.
const ALLOWED = /^[A-Za-z0-9!@#$%^&*]+$/
const HAS_LETTER = /[A-Za-z]/
const HAS_DIGIT = /[0-9]/
const HAS_SPECIAL = /[!@#$%^&*]/

export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 12
export const PASSWORD_RULE_TEXT = '8~12자 · 영문·숫자·특수기호(!@#$%^&*) 중 2종 이상'

/** 정책 검증 → { ok, reason }. reason 은 사용자 노출용 한글 문구. */
export function validatePassword(pw) {
  const s = String(pw ?? '')
  if (s.length < PASSWORD_MIN || s.length > PASSWORD_MAX)
    return { ok: false, reason: `비밀번호는 ${PASSWORD_MIN}~${PASSWORD_MAX}자여야 합니다.` }
  if (!ALLOWED.test(s))
    return { ok: false, reason: '영문·숫자·특수기호(!@#$%^&*)만 사용할 수 있습니다.' }
  const kinds =
    (HAS_LETTER.test(s) ? 1 : 0) + (HAS_DIGIT.test(s) ? 1 : 0) + (HAS_SPECIAL.test(s) ? 1 : 0)
  if (kinds < 2) return { ok: false, reason: '영문·숫자·특수기호 중 2종 이상을 조합하세요.' }
  return { ok: true }
}

export const isValidPassword = (pw) => validatePassword(pw).ok
