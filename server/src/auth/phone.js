const PHONE_ID = /^010\d{8}$/

/** 전화번호에서 숫자만 추출한다. 길이/국번 검증은 canonicalPhoneId가 담당한다. */
export const phoneDigits = (value) => String(value ?? '').replace(/\D/g, '')

/** 010 휴대전화 계정 ID를 canonical 숫자 11자리로 변환한다. 유효하지 않으면 null. */
export function canonicalPhoneId(value) {
  const raw = String(value ?? '').trim()
  if (!/^(?:010\d{8}|010[-\s]\d{4}[-\s]\d{4})$/.test(raw)) return null
  const digits = phoneDigits(raw)
  return PHONE_ID.test(digits) ? digits : null
}

/**
 * 로그인 ID 정규화.
 * 유효한 전화 형태만 canonicalize하고, admin 같은 비전화 break-glass ID는 exact(trim) 보존한다.
 */
export function normalizeLoginId(value) {
  const raw = String(value ?? '').trim()
  return canonicalPhoneId(raw) ?? raw
}

/** 숫자 입력을 로그인 화면 표시 형식(010-1234-5678)으로 만든다. */
export function formatPhoneId(value) {
  const digits = phoneDigits(value).slice(0, 11)
  if (digits.length <= 3) return digits
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
}

export const isCanonicalPhoneId = (value) => PHONE_ID.test(String(value ?? ''))
