// 관리자(PM) 셀프등록 시 개발자에게 SMS 알림(서버 측 → 개발자 로그인/접속 불필요).
// 게이트웨이는 SMS_PROVIDER 로 선택. 미설정이면 'log'(콘솔 기록만, 실발송 없음)로 안전 폴백.
// 등록 흐름을 절대 막지 않도록 호출부는 fire-and-forget + 여기서도 예외를 삼킨다.
//
// env:
//   SMS_PROVIDER = aligo | webhook | log(기본)
//   NOTIFY_PHONE = 수신 개발자 번호(쉼표로 여러 명). 비우면 전화번호 ID를 가진 활성 개발자에게 자동 발송.
//   SMS_SENDER   = 발신번호(사전 등록된 번호)
//   aligo:   SMS_API_KEY, SMS_USER_ID, (SMS_TEST=1 이면 테스트모드)
//   webhook: SMS_WEBHOOK_URL  (POST JSON {to, from, text} — 임의 게이트웨이/프록시)

const DIV_LABEL = {
  strategy: '경영전략본부',
  'water-env': '물환경본부',
  'water-res': '수자원본부',
  land: '국토개발본부',
  railway: '철도본부',
  road: '도로본부',
  plant: '플랜트본부',
  cm: 'CM',
  overseas: '해외사업본부',
  bizdev: '사업개발실',
  safety: '안전품질관리실',
}
const isPhone = (id) => /^010\d{8}$/.test(String(id ?? ''))

/** 수신자 = NOTIFY_PHONE(명시) 우선, 없으면 전화번호 ID를 가진 활성 개발자 자동. */
async function resolveRecipients(repo) {
  const env = String(process.env.NOTIFY_PHONE || '')
    .split(',')
    .map((s) => s.replace(/\D/g, ''))
    .filter(isPhone)
  if (env.length) return [...new Set(env)]
  try {
    const users = await repo.listUsers()
    return users
      .filter((u) => u.role === 'developer' && u.active !== false && isPhone(u.id))
      .map((u) => u.id)
  } catch {
    return []
  }
}

async function sendOne(to, text) {
  const provider = process.env.SMS_PROVIDER || 'log'
  if (provider === 'aligo') {
    const body = new URLSearchParams({
      key: process.env.SMS_API_KEY || '',
      user_id: process.env.SMS_USER_ID || '',
      sender: (process.env.SMS_SENDER || '').replace(/\D/g, ''),
      receiver: to,
      msg: text,
      ...(process.env.SMS_TEST === '1' ? { testmode_yn: 'Y' } : {}),
    })
    const res = await fetch('https://apis.aligo.in/send/', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    })
    return res.ok
  }
  if (provider === 'webhook') {
    const url = process.env.SMS_WEBHOOK_URL
    if (!url) return false
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to, from: process.env.SMS_SENDER || '', text }),
    })
    return res.ok
  }
  // 'log' 폴백 — 게이트웨이 미설정/개발용. 실제 발송 없이 서버 로그에만 남긴다.
  console.log(`[notify:sms:log] → ${to}: ${text.replace(/\n/g, ' / ')}`)
  return true
}

/** 관리자(PM) 등록 신청 알림. 실패해도 throw 하지 않는다(등록 흐름 보호). */
export async function notifyAdminRegistration(repo, user) {
  try {
    const div = DIV_LABEL[user.division] || user.division || '본부 미지정'
    const text = `[Sequence] 관리자 등록 신청\n${user.name || ''} ${user.id}\n${div}\n승인: 관리자 도구에서 처리`
    const tos = await resolveRecipients(repo)
    if (!tos.length) {
      console.log('[notify:sms] 수신자 없음 — NOTIFY_PHONE 설정 또는 전화번호 ID 개발자 계정 필요')
      return
    }
    await Promise.allSettled(tos.map((to) => sendOne(to, text)))
  } catch (e) {
    console.log(`[notify:sms] 실패(무시): ${e instanceof Error ? e.message : e}`)
  }
}
