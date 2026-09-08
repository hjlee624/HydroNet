// 저장 상태 표시 모델(F01) 스모크 — '연결됨'이 '저장됨'으로 새지 않는지 기계적으로 못박는다.
// 여기서 검증하는 규칙:
//   (1) 연결 상태 × 미전송 변경 × 마지막 서버 확정 → 네 가지 라벨 매핑이 정확한가
//   (2) 미전송 변경이 있으면 절대 '서버 동기화 완료'가 되지 않는가
//   (3) 마지막 로컬 편집보다 오래된 확정은 완료로 읽히지 않는가
//   (4) 서버 확정 메시지 파서가 형식 위반 입력을 전부 버리는가
//   (6) 확정이 **내 편집을 담고 있을 때만** 완료로 읽히는가(내용 대조 확정)
//   (7) 조회 전용 입장이 '전송 대기…'로 굳지 않는가
//   (8) 파일 백업 시각이 '실제로 파일이 써졌을 때만' 찍히는가
//   (10) clientID 가 상한을 한참 넘게 쌓여도 확정이 계속 '완료'에 도달하는가(영구 대기 금지)
//   (11) 프로젝트를 갈아타면 이전 프로젝트의 파일 백업 시각이 남지 않는가
// 실행: npm --prefix client run smoke:persist
import assert from 'node:assert/strict'
import { zlibSync } from 'fflate'
import * as Y from 'yjs'
import { resolveDeployMode } from '../src/state/authStore'
import {
  ackCoversLocalChanges,
  deletedClockCount,
  localDocDigest,
  MAX_STATELESS_LENGTH,
  parseServerPersistMessage,
  type ServerPersistAck,
} from '../src/state/collaboration'
import { describeSaveStatus, type SaveStatusInput, type SaveTone } from '../src/state/persistence'

const T0 = Date.UTC(2026, 8, 8, 1, 0, 0) // 기준 시각
const later = (ms: number) => T0 + ms

/** 서버 협업 방(target='server') 기본 사실 — 각 케이스에서 필요한 부분만 덮어쓴다. */
const server = (patch: Partial<SaveStatusInput> = {}): SaveStatusInput => ({
  target: 'server',
  link: 'connected',
  serverConfirmedAt: null,
  localConfirmedAt: null,
  pending: false,
  lastLocalChangeAt: null,
  ...patch,
})

const toneOf = (state: SaveStatusInput): SaveTone => describeSaveStatus(state).tone
const labelOf = (state: SaveStatusInput): string => describeSaveStatus(state).label

// ── (1) 네 가지 상태 매핑 ────────────────────────────────────────────────────
assert.equal(
  toneOf({ ...server(), target: 'local', localConfirmedAt: T0 }),
  'localonly',
  '협업 방 밖 = 로컬만 저장',
)
assert.match(
  labelOf({ ...server(), target: 'local', localConfirmedAt: T0 }),
  /로컬만 저장/,
  '로컬 라벨 문구',
)
assert.equal(toneOf(server({ link: 'offline' })), 'offline', '연결 끊김')
assert.equal(toneOf(server({ link: 'connecting' })), 'offline', '연결 중도 아직 서버 미반영')
assert.equal(toneOf(server({ link: 'error' })), 'error', '인증/연결 오류')
assert.equal(toneOf(server({ pending: true })), 'pending', '미전송 변경 = 전송 대기')
assert.equal(
  toneOf(server({ serverConfirmedAt: T0, lastLocalChangeAt: T0 - 1_000 })),
  'synced',
  '확정이 마지막 편집보다 나중이면 완료',
)
assert.match(
  labelOf(server({ serverConfirmedAt: T0, lastLocalChangeAt: T0 - 1_000 })),
  /^서버 동기화 완료 · \d{2}:\d{2}$/,
  '완료 라벨에 확정 시각이 붙는다',
)

// ── (2) 미전송 변경은 어떤 조합에서도 '완료'가 될 수 없다 ────────────────────
for (const link of ['connected', 'connecting', 'offline', 'error'] as const) {
  for (const confirmed of [null, T0, later(60_000)]) {
    const view = describeSaveStatus(server({ link, pending: true, serverConfirmedAt: confirmed }))
    assert.notEqual(view.tone, 'synced', `pending=true 인데 완료로 표시됨 (link=${link})`)
    assert.ok(
      !view.label.includes('서버 동기화 완료'),
      `pending=true 인데 완료 문구가 나옴 (link=${link})`,
    )
  }
}

// 연결만 되어 있고 확정을 한 번도 못 받은 상태 = 완료 아님(연결≠저장).
assert.equal(
  toneOf(server({ link: 'connected', serverConfirmedAt: null })),
  'pending',
  '연결됨만으로는 완료가 아니다',
)

// ── (3) 확정 시각이 마지막 로컬 편집보다 오래되면 완료가 아니다 ──────────────
const stale = server({ serverConfirmedAt: T0, lastLocalChangeAt: later(5_000) })
assert.equal(toneOf(stale), 'pending', '오래된 확정은 완료로 읽히면 안 된다')
assert.ok(!describeSaveStatus(stale).label.includes('완료'), '오래된 확정 라벨에 완료 없음')
// 경계: 같은 시각이면(확정 ≥ 편집) 완료로 본다.
assert.equal(
  toneOf(server({ serverConfirmedAt: T0, lastLocalChangeAt: T0 })),
  'synced',
  '확정 == 편집 시각이면 완료',
)
// 로컬 전용도 같은 규칙 — 기록보다 나중의 편집이 있으면 '기록 대기'.
assert.match(
  describeSaveStatus({
    ...server(),
    target: 'local',
    localConfirmedAt: T0,
    lastLocalChangeAt: later(1_000),
  }).detail,
  /기록 대기/,
  '로컬 기록보다 나중의 편집은 대기로 표시',
)

// ── (4) 서버 확정 메시지 파서 — 신뢰 불가 입력 전량 차단 ─────────────────────
const goodIso = '2026-09-08T01:00:00.000Z'
assert.equal(
  parseServerPersistMessage(JSON.stringify({ type: 'sequence:persisted', at: goodIso }))?.at,
  goodIso,
  '정상 확정 메시지는 ISO 를 돌려준다',
)
for (const bad of [
  null,
  undefined,
  42,
  { type: 'sequence:persisted', at: goodIso }, // 객체(문자열 아님)
  'not json',
  JSON.stringify({ type: 'other', at: goodIso }),
  JSON.stringify({ type: 'sequence:persisted' }),
  JSON.stringify({ type: 'sequence:persisted', at: 'yesterday' }),
  JSON.stringify({ type: 'sequence:persisted', at: 12345 }),
  `${'x'.repeat(MAX_STATELESS_LENGTH + 1)}`,
  // payload 상한을 넘는 입력 — 상태벡터를 싣느라 상한을 올렸어도 무제한은 아니다.
  JSON.stringify({
    type: 'sequence:persisted',
    at: goodIso,
    pad: 'y'.repeat(MAX_STATELESS_LENGTH + 1),
  }),
]) {
  assert.equal(
    parseServerPersistMessage(bad),
    null,
    `형식 위반 입력이 통과됨: ${String(bad).slice(0, 40)}`,
  )
}

// ── (5) 배포 모드 해석(F05) — 주입 값이 없으면 서버 대상 배포로 오인하지 않는다 ─
assert.equal(resolveDeployMode('server'), 'server', 'server 플래그')
assert.equal(resolveDeployMode('standalone'), 'standalone', 'standalone 플래그')
assert.equal(resolveDeployMode(null), 'standalone', '주입 없음 = 로컬 전용 실행 환경')
assert.equal(resolveDeployMode(undefined), 'standalone', 'undefined = 로컬 전용 실행 환경')
assert.equal(resolveDeployMode('SERVER'), 'standalone', '알 수 없는 값은 서버 대상이 아니다')

// ── (6) 확정은 '내 편집을 담고 있을 때만' 완료다 ─────────────────────────────
// 재현 상황: t=0 내가 e2 를 친다 → t=10 서버가 e1 까지만 파일에 쓰고 방 전체에 확정을 쏜다
// → t=25 내가 그 확정을 받는다. 시각만 비교하면 이 확정이 '내 e2 까지 저장됨'으로 읽히고,
// 그 창에서 서버가 죽으면 UI 가 저장됐다고 말한 편집이 사라진다.
// 서버(server/src/collab/index.js)가 실제로 만드는 확정과 **같은 방식**으로 조립한다:
// sv = 기록한 state 의 상태벡터, dl = 그 state 의 삭제 총량.
// server/src/collab/index.js 의 buildPersistAck 과 **같은 인코딩**을 재현한다:
//   svz = deflate(zlib)(상태벡터) base64 · svn = 압축 전 원본 길이 · cs/cn = 집계 · dl = 삭제 총량.
// (압축 상한 MAX_ACK_SVZ_B64=32768 를 넘으면 서버는 svz/svn 을 빼고 cs/cn/dl 만 보낸다 —
//  아래 (10)에서 그 경로를 그대로 재현한다.)
const SERVER_MAX_ACK_SVZ_B64 = 32_768
const encodeAckFields = (source: Y.Doc): Record<string, unknown> => {
  const sv = Y.encodeStateVector(source)
  const clocks = Y.decodeStateVector(sv)
  let cs = 0
  for (const clock of clocks.values()) cs += clock
  const svz = Buffer.from(zlibSync(sv)).toString('base64')
  return {
    dl: deletedClockCount(source),
    cs,
    cn: clocks.size,
    ...(svz.length <= SERVER_MAX_ACK_SVZ_B64 ? { svz, svn: sv.length } : {}),
  }
}
const ackFor = (source: Y.Doc | null, at = goodIso): ServerPersistAck | null =>
  parseServerPersistMessage(
    JSON.stringify({
      type: 'sequence:persisted',
      at,
      ...(source ? encodeAckFields(source) : {}),
    }),
  )
/** 서버가 기록했다고 주장하는 내용을 그 시점 그대로 얼려 둔다(= 확정 브로드캐스트). */
const freeze = (source: Y.Doc): Y.Doc => {
  const copy = new Y.Doc()
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(source))
  return copy
}

const doc = new Y.Doc()
assert.equal(localDocDigest(doc).clocks.size, 0, '편집이 없으면 로컬 상태벡터가 비어 있다')
assert.equal(localDocDigest(doc).deleted, 0, '편집이 없으면 삭제 총량은 0')

// 편집이 하나도 없는 클라이언트도 정상 상태에 도달해야 한다(증명할 것이 없으므로).
const emptyAck = ackFor(doc)
assert.ok(emptyAck, '상태벡터를 실은 확정이 파싱된다')
assert.equal(
  ackCoversLocalChanges(emptyAck, localDocDigest(doc)),
  true,
  '빈 문서 클라이언트는 확정을 그대로 인정한다',
)

doc.getMap('root/meta').set('e1', '1')
const serverAfterE1 = freeze(doc) // 서버가 e1 까지만 기록한 시점
const digestAfterE1 = localDocDigest(doc)
doc.getMap('root/meta').set('e2', '2') // 내가 방금 친 편집(아직 서버 RAM 에만)
const digestAfterE2 = localDocDigest(doc)
assert.ok(
  (digestAfterE2.clocks.get(doc.clientID) ?? 0) > (digestAfterE1.clocks.get(doc.clientID) ?? 0),
  '편집하면 내 clock 이 전진한다',
)

const staleAck = ackFor(serverAfterE1)
assert.ok(staleAck, 'e1 시점 확정이 파싱된다')
assert.equal(
  ackCoversLocalChanges(staleAck, digestAfterE2),
  false,
  '내 편집(e2)이 빠진 확정은 완료로 인정되면 안 된다',
)
assert.equal(
  ackCoversLocalChanges(staleAck, digestAfterE1),
  true,
  '그 확정은 e1 까지에 대해서는 유효하다',
)
const freshAck = ackFor(doc)
assert.ok(freshAck, 'e2 포함 확정이 파싱된다')
assert.equal(
  ackCoversLocalChanges(freshAck, digestAfterE2),
  true,
  'e2 까지 담은 확정은 완료로 인정된다',
)

// 남의 편집만 담은 확정(= 내 clientID 가 아예 없는 상태벡터)도 완료가 아니다.
const otherDoc = new Y.Doc()
otherDoc.getMap('root/meta').set('theirs', 'x')
const othersAck = ackFor(otherDoc)
assert.ok(othersAck, '남의 상태벡터 확정이 파싱된다')
assert.equal(
  ackCoversLocalChanges(othersAck, digestAfterE2),
  false,
  '내 clientID 가 없는 확정은 내 편집을 담고 있지 않다',
)

// 내용 증명이 없는 확정(구서버·형식 위반 sv)은 편집이 있는 동안 완료로 쓰지 않는다.
const noSvAck = ackFor(null)
assert.ok(noSvAck, '상태벡터 없는 확정도 파싱은 된다(시각은 유효)')
assert.equal(noSvAck.clocks, null, '상태벡터가 없으면 clocks 는 null')
assert.equal(noSvAck.deleted, null, '삭제 총량이 없으면 deleted 는 null')
assert.equal(
  ackCoversLocalChanges(noSvAck, digestAfterE2),
  false,
  '무엇을 기록했는지 증명 없는 확정은 완료로 쓰지 않는다',
)
for (const badSv of ['!!not-base64!!', 'AAAAAAAAAAAAAAAAAAAA', '']) {
  const parsed = parseServerPersistMessage(
    JSON.stringify({ type: 'sequence:persisted', at: goodIso, sv: badSv, dl: 0 }),
  )
  assert.ok(parsed, `형식 위반 sv 라도 시각은 파싱된다: ${badSv}`)
  assert.equal(
    ackCoversLocalChanges(parsed, digestAfterE2),
    false,
    `형식 위반 sv 가 완료로 통과됨: ${badSv}`,
  )
}

// ── (6a) 삭제·되돌리기는 clock 을 전진시키지 않는다 ─────────────────────────
// Yjs 삭제는 새 struct 를 만들지 않는다. 그래서 '내 clientID clock 하나'만 비교하면
// 삭제 **이전**에 서버가 만든 확정이 그대로 통과하고, 칩은 아직 파일에 남아 있는
// 공정에 대해 '서버 동기화 완료 · 서버가 이 내용을 기록했습니다'라고 말한다.
const delDoc = new Y.Doc()
const delTasks = delDoc.getMap('root/tasks')
delTasks.set('t1', 'seed')
delTasks.set('t2', 'added-by-me') // 방금 추가한 공정
const serverBeforeDelete = freeze(delDoc) // 서버가 t2 까지 기록하고 확정을 쏨
const digestBeforeDelete = localDocDigest(delDoc)
const rawDeletedBefore = deletedClockCount(delDoc)
const ackBeforeDelete = ackFor(serverBeforeDelete)
assert.ok(ackBeforeDelete, '삭제 직전 확정이 파싱된다')
assert.equal(
  ackCoversLocalChanges(ackBeforeDelete, digestBeforeDelete),
  true,
  '삭제 전이라면 그 확정은 정당하다(전제)',
)

delTasks.delete('t2') // Ctrl+Z 로 방금 추가를 되돌린 것과 같은 결과
const digestAfterDelete = localDocDigest(delDoc)
assert.deepEqual(
  [...digestAfterDelete.clocks],
  [...digestBeforeDelete.clocks],
  '삭제는 상태벡터를 전혀 바꾸지 않는다(옛 판정이 뚫린 지점)',
)
// 전제는 판정 대상(localDocDigest)이 아니라 원시 계산으로 확인한다 — 판정을 옛 방식으로
// 되돌려도 전제가 먼저 깨져서 진짜 실패 지점을 가리지 않도록.
assert.ok(
  deletedClockCount(delDoc) > rawDeletedBefore,
  '삭제하면 문서의 삭제 총량이 늘어난다(전제)',
)
assert.equal(
  ackCoversLocalChanges(ackBeforeDelete, digestAfterDelete),
  false,
  '삭제 이전의 확정이 삭제 이후의 문서를 담고 있다고 인정되면 안 된다',
)
// 거짓 완료를 영구 미완료로 바꾸지 않는다 — 삭제를 담은 다음 확정은 즉시 완료가 된다.
const ackAfterDelete = ackFor(freeze(delDoc))
assert.ok(ackAfterDelete, '삭제 이후 확정이 파싱된다')
assert.equal(
  ackCoversLocalChanges(ackAfterDelete, digestAfterDelete),
  true,
  '삭제를 담은 확정은 곧바로 완료로 인정된다(영구 대기 금지)',
)
// 삭제 총량을 싣지 않는 확정(구서버)은 삭제가 있는 문서를 증명하지 못한다.
const delSv = Y.encodeStateVector(delDoc)
const noDlAck = parseServerPersistMessage(
  JSON.stringify({
    type: 'sequence:persisted',
    at: goodIso,
    svz: Buffer.from(zlibSync(delSv)).toString('base64'),
    svn: delSv.length,
  }),
)
assert.ok(noDlAck, 'dl 없는 확정도 파싱은 된다')
assert.equal(
  ackCoversLocalChanges(noDlAck, digestAfterDelete),
  false,
  '삭제 총량 증명이 없는 확정은 삭제가 있는 문서를 완료로 만들 수 없다',
)

// ── (6b) 새로고침(clientID 재발급) 뒤에도 판정이 무너지지 않는다 ────────────
// 재접속하면 Y.Doc 은 새 clientID 를 받는다. '내 clientID 의 clock' 만 보던 판정은
// 복원된 내용이 전부 옛 clientID 아래 있으므로 0 을 읽고 **무조건 통과**로 무너졌다.
// 삭제가 **없는** 문서로 검증해야 이 경로만 따로 잡을 수 있다 — 삭제가 섞이면 (6a)의
// 삭제 총량 비교가 대신 막아 주어, 상태벡터 쪽 회귀가 테스트를 통과해 버린다.
const offlineDoc = new Y.Doc()
offlineDoc.getMap('root/tasks').set('t1', '오프라인에서 만든 공정')
offlineDoc.getMap('root/tasks').set('t2', '오프라인에서 만든 공정 2')
assert.equal(deletedClockCount(offlineDoc), 0, '이 문서에는 삭제가 없다(경로 분리 전제)')

const restored = new Y.Doc()
Y.applyUpdate(restored, Y.encodeStateAsUpdate(offlineDoc)) // IndexedDB 복원과 같은 경로
assert.notEqual(restored.clientID, offlineDoc.clientID, '새 문서는 다른 clientID 를 갖는다')
assert.equal(
  restored.getMap('root/tasks').size,
  offlineDoc.getMap('root/tasks').size,
  '복원된 문서는 내용을 그대로 들고 있다',
)
const restoredDigest = localDocDigest(restored)
assert.equal(
  restoredDigest.clocks.get(restored.clientID) ?? 0,
  0,
  '복원 직후 내 새 clientID 의 clock 은 0 이다(옛 판정이 무조건 통과하던 지점)',
)
const emptyServerAck = ackFor(new Y.Doc())
assert.ok(emptyServerAck, '빈 서버 상태 확정이 파싱된다')
assert.equal(
  ackCoversLocalChanges(emptyServerAck, restoredDigest),
  false,
  '아무것도 기록하지 않은 확정이 복원된 오프라인 작업을 서버 확정으로 둔갑시키면 안 된다',
)
assert.equal(
  ackCoversLocalChanges(ackFor(freeze(restored)) as ServerPersistAck, restoredDigest),
  true,
  '복원된 내용을 실제로 담은 확정은 정상적으로 완료가 된다',
)

// ── (6c) 상태벡터 인코딩 — 압축 경로·구서버 호환·압축폭탄 방어 ───────────────
const svDoc = new Y.Doc()
svDoc.getMap('root/meta').set('k', 'v')
const svBytes = Y.encodeStateVector(svDoc)
// 구서버(비압축 sv)도 계속 읽어 준다 — 서버만 먼저 롤백돼도 칩이 죽지 않게.
const legacyAck = parseServerPersistMessage(
  JSON.stringify({
    type: 'sequence:persisted',
    at: goodIso,
    sv: Buffer.from(svBytes).toString('base64'),
    dl: 0,
  }),
)
assert.ok(legacyAck, '구서버의 비압축 sv 확정도 파싱된다')
assert.equal(
  ackCoversLocalChanges(legacyAck, localDocDigest(svDoc)),
  true,
  '구서버 확정도 내용을 담고 있으면 완료로 인정된다(하위 호환)',
)
// svn(선언 길이)이 실제 해제 길이와 다르면 통째로 버린다 — 잘린 벡터를 진짜인 척 통과시키거나
// 압축폭탄으로 메모리를 먹이는 경로를 여기서 끊는다.
const packedSv = Buffer.from(zlibSync(svBytes)).toString('base64')
for (const badSvn of [svBytes.length + 1, svBytes.length - 1, 0, -1, 1.5, 1_000_000, '12']) {
  const parsed = parseServerPersistMessage(
    JSON.stringify({ type: 'sequence:persisted', at: goodIso, svz: packedSv, svn: badSvn }),
  )
  assert.ok(parsed, `svn 이 틀려도 시각은 파싱된다: ${badSvn}`)
  assert.equal(parsed.clocks, null, `선언 길이(svn=${badSvn})가 맞지 않는 상태벡터가 통과됨`)
}
const bomb = parseServerPersistMessage(
  JSON.stringify({
    type: 'sequence:persisted',
    at: goodIso,
    // 1MB 짜리 0 바이트는 아주 잘 압축된다 — 선언 길이를 작게 속여도 해제 결과 길이가 달라
    // 거부돼야 한다(할당 자체가 선언 길이+1 로 묶여 있다).
    svz: Buffer.from(zlibSync(new Uint8Array(1_000_000))).toString('base64'),
    svn: 8,
  }),
)
assert.ok(bomb, '압축폭탄 payload 도 시각은 파싱된다')
assert.equal(bomb.clocks, null, '압축폭탄이 상태벡터로 통과됨')

// ── (10) clientID 가 상한을 한참 넘어도 확정은 계속 '완료'에 도달한다 ─────────
// 상태벡터는 '이 문서에 한 번이라도 쓴 clientID' 마다 한 항목이고, 새로고침·새 탭마다
// clientID 가 새로 발급된다 → 항목 수는 접속자 수가 아니라 **누적 세션 수**로 늘어난다.
// 예전(비압축 sv · payload 상한 4096B)에는 세션 508개에서 payload 가 4100B 가 되어
// parseServerPersistMessage 가 그때부터 **모든** 확정을 버렸고, 칩은 영원히 '서버 확정 대기…'
// 였다. 아래는 그 지점을 한참 지나(세션 12,000개) 서버가 상태벡터를 아예 싣지 못하는
// **집계 증명 경로**까지 밀어 넣고, 그래도 칩이 '서버 동기화 완료'에 도달하는지 확인한다.
const SESSIONS = 12_000
// 실제 clientID 는 32비트 난수다(연속 정수면 압축이 너무 잘 돼 이 경로를 재현하지 못한다).
// 재현 가능해야 하므로 결정적 LCG 로 만든다.
let lcg = 0x2545f491
const nextClientId = () => {
  lcg = (Math.imul(lcg, 1103515245) + 12345) >>> 0
  return lcg
}
const manySessions = new Y.Doc()
const manyMap = manySessions.getMap('root/tasks')
for (let index = 0; index < SESSIONS; index += 1) {
  manySessions.clientID = nextClientId()
  manyMap.set(`t${index}`, index)
}
const manyDigest = localDocDigest(manySessions)
assert.ok(
  manyDigest.clocks.size > 10_000,
  `전제: 누적 세션이 상한을 한참 넘는다 (clientID ${manyDigest.clocks.size}개)`,
)
const manyPayload = JSON.stringify({
  type: 'sequence:persisted',
  at: goodIso,
  ...encodeAckFields(manySessions),
})
const rawSvB64 = Buffer.from(Y.encodeStateVector(manySessions)).toString('base64')
assert.ok(
  rawSvB64.length > 4096,
  `전제: 옛 방식(비압축 sv)이라면 payload 가 옛 상한 4096B 를 넘는다 (sv ${rawSvB64.length}B)`,
)
assert.ok(
  manyPayload.length <= MAX_STATELESS_LENGTH,
  `서버가 만든 확정 payload 가 클라이언트 상한을 넘는다 (${manyPayload.length}B > ${MAX_STATELESS_LENGTH}B)`,
)
assert.equal(
  JSON.parse(manyPayload).svz,
  undefined,
  `전제: 세션 ${SESSIONS}개면 압축본도 서버 상한을 넘어 **집계 증명 경로**로 내려앉는다`,
)
const manyAck = parseServerPersistMessage(manyPayload)
assert.ok(manyAck, 'clientID 가 아무리 많아도 확정 자체는 파싱된다(옛 버그: 여기서 null)')
assert.equal(manyAck.clocks, null, '전제: 이 확정에는 상태벡터가 실려 있지 않다')
assert.ok(
  manyAck.clockSum !== null && manyAck.clientCount !== null,
  '상태벡터를 못 실을 때는 집계 증명(cs/cn)이 반드시 실려야 한다',
)
assert.equal(
  ackCoversLocalChanges(manyAck, manyDigest),
  true,
  'clientID 가 많다는 이유로 확정이 거부되면 칩이 영구히 대기로 굳는다',
)

// 옛 상한(4096B)이 무너지던 지점(세션 508개)을 한참 지나서도 **강한 증명**(상태벡터)이
// 그대로 실린다 — 집계 강등은 정말 극단적인 경우에만 쓰이는 최후 수단이라는 뜻이다.
const midDoc = new Y.Doc()
const midMap = midDoc.getMap('root/tasks')
lcg = 0x2545f491
for (let index = 0; index < 5_000; index += 1) {
  midDoc.clientID = nextClientId()
  midMap.set(`t${index}`, index)
}
const midPayload = JSON.stringify({
  type: 'sequence:persisted',
  at: goodIso,
  ...encodeAckFields(midDoc),
})
const midAck = parseServerPersistMessage(midPayload)
assert.ok(midAck, '세션 5,000개 확정이 파싱된다(옛 방식이라면 500개 언저리에서 이미 null)')
assert.ok(midAck.clocks !== null, '세션 5,000개까지는 상태벡터가 그대로 실린다(강한 증명)')
assert.equal(
  ackCoversLocalChanges(midAck, localDocDigest(midDoc)),
  true,
  '세션 5,000개 문서도 정상적으로 완료에 도달한다',
)
// 그리고 그 확정이 실제로 칩을 '완료'까지 데려가는지 — 표시 모델까지 이어서 확인한다.
assert.match(
  labelOf(server({ serverConfirmedAt: T0, lastLocalChangeAt: T0 - 1_000 })),
  /서버 동기화 완료/,
  '전제: 확정이 인정되면 칩은 완료 라벨이 된다',
)
// 집계 증명 경로라도 '내 편집이 빠진 확정'은 여전히 거부된다(약해졌지 무력해진 게 아니다).
const behindDoc = new Y.Doc()
Y.applyUpdate(behindDoc, Y.encodeStateAsUpdate(manySessions))
behindDoc.clientID = nextClientId()
behindDoc.getMap('root/tasks').set('mine', 'not-yet-persisted')
assert.equal(
  ackCoversLocalChanges(manyAck, localDocDigest(behindDoc)),
  false,
  '집계 증명 경로에서도 내 최신 편집이 빠진 확정은 완료가 아니다',
)

// ── (7) 조회 전용 입장은 '전송 대기…'로 굳지 않는다 ──────────────────────────
// hocuspocus 는 readOnly 연결의 업데이트에도 SyncStatus(false) 로 답하고 provider 는
// 적용된 것만 미전송 카운터에서 뺀다 → 조회 전용 사용자의 pending 은 영원히 true 다.
const readOnlyView = describeSaveStatus(server({ pending: true, readOnly: true }))
assert.equal(readOnlyView.tone, 'readonly', '조회 전용은 전용 표시를 쓴다')
assert.ok(!readOnlyView.label.includes('전송 대기'), '조회 전용이 전송 대기로 굳지 않는다')
assert.equal(
  describeSaveStatus(server({ pending: true })).tone,
  'pending',
  '대조군: 편집 권한이 있으면 미전송 변경은 그대로 전송 대기',
)
assert.equal(
  describeSaveStatus(server({ link: 'offline', readOnly: true })).tone,
  'offline',
  '조회 전용이어도 연결 끊김이 먼저다(전송로 사실이 우선)',
)

// ── (8) 파일 백업 시각은 '실제로 파일이 써졌을 때만' 찍힌다 ──────────────────
// 예전에는 `await save(); if (!dirty) markFileBackup()` 로 추론했다. dirty=false 는
// '보류 중 변경 없음'일 뿐이라, 편집 없이 저장을 눌러 OS 대화상자를 취소해도 없는 파일의
// 백업 시각이 찍혔다.
const { usePersistence } = await import('../src/state/persistence')
const { backupProjectToFile, useEditor } = await import('../src/state/store')

usePersistence.setState({ fileBackupAt: null })
useEditor.setState({ dirty: false, save: async () => false }) // 대화상자 취소 = 파일 미기록
assert.equal(await backupProjectToFile(), false, '취소하면 백업은 실패로 보고된다')
assert.equal(
  usePersistence.getState().fileBackupAt,
  null,
  '파일이 써지지 않았는데 백업 시각이 찍혔다(dirty 로 추론하던 옛 버그)',
)

useEditor.setState({ save: async () => true }) // 실제로 파일이 써진 경우
assert.equal(await backupProjectToFile(), true, '성공하면 true 를 돌려준다')
assert.ok(
  usePersistence.getState().fileBackupAt !== null,
  '실제로 저장했는데 백업 시각이 남지 않았다(Ctrl+S 가 칩을 갱신하지 않던 옛 버그)',
)

// ── (11) 프로젝트를 갈아타면 이전 프로젝트의 파일 백업 시각도 함께 사라진다 ───
// 재현: projA 를 파일로 백업 → projB 협업 방에 접속(connectProjectCollaboration 이 프로젝트
// 전환마다 setTarget 을 부른다). 예전에는 서버 확정 시각만 지워서, 한 번도 백업한 적 없는
// projB 에 대해 칩이 '파일 백업 15:04 · 마지막 파일 백업 이후 변경 없음'이라고 말했다.
usePersistence.getState().markFileBackup()
assert.ok(usePersistence.getState().fileBackupAt !== null, '전제: projA 백업 시각이 찍혀 있다')
usePersistence.getState().setTarget('server', '서버 협업 방 · projB')
assert.equal(
  usePersistence.getState().serverConfirmedAt,
  null,
  '프로젝트가 바뀌면 서버 확정 시각은 지워진다(기존 규칙)',
)
assert.equal(
  usePersistence.getState().fileBackupAt,
  null,
  'projA 의 파일 백업 시각이 projB 의 사실로 둔갑했다(칩이 없는 백업을 단언)',
)
// 로컬 단독 편집으로 되돌아갈 때도 같다.
usePersistence.getState().markFileBackup()
usePersistence.getState().setTarget('local', '이 브라우저(로컬 저장소)')
assert.equal(
  usePersistence.getState().fileBackupAt,
  null,
  '로컬 전환에서도 이전 대상의 파일 백업 시각이 남으면 안 된다',
)
// 같은 저장 위치를 다시 지정하는 것(재연결·리렌더)은 사실을 바꾸지 않는다 — 지우지 않는다.
usePersistence.getState().markFileBackup()
const keptBackupAt = usePersistence.getState().fileBackupAt
usePersistence.getState().setTarget('local', '이 브라우저(로컬 저장소)')
assert.equal(
  usePersistence.getState().fileBackupAt,
  keptBackupAt,
  '같은 프로젝트에 재연결했을 뿐인데 백업 시각이 사라지면 안 된다(반대 방향 거짓말)',
)

// ── (9) '오프라인으로 계속' 동의는 그 장애 한 번짜리다 ───────────────────────
// 표식을 지우지 않으면 이후의 **진짜** 장애가 매번 조용히 로컬 단독 모드로 새고
// (장애 안내 화면 없이), 사용자는 공유 프로젝트라 믿는 로컬 파일에서 하루를 보낸다.
const OFFLINE_ACK_KEY = 'sequence:offline-ack'
const fakeStorage: Record<string, string> = { [OFFLINE_ACK_KEY]: '1' }
const globals = globalThis as unknown as {
  localStorage?: unknown
  fetch?: unknown
}
globals.localStorage = {
  getItem: (key: string) => fakeStorage[key] ?? null,
  setItem: (key: string, value: string) => {
    fakeStorage[key] = value
  },
  removeItem: (key: string) => {
    delete fakeStorage[key]
  },
  clear: () => {
    for (const key of Object.keys(fakeStorage)) delete fakeStorage[key]
  },
  key: () => null,
  length: 0,
}
globals.fetch = async () =>
  new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const { useAuth } = await import('../src/state/authStore')
useAuth.setState({ deployMode: 'server', mode: 'checking', serverUnreachable: true })
await useAuth.getState().init()
assert.equal(useAuth.getState().mode, 'server', '서버가 응답하면 서버 모드로 들어간다')
assert.equal(
  fakeStorage[OFFLINE_ACK_KEY],
  undefined,
  '서버가 돌아왔는데 오프라인 동의 표식이 남아 있다(이후 장애가 조용히 로컬 모드로 샌다)',
)

// ── (12) 저장 파일은 자기 내용과 **같은** 스키마 버전을 선언한다 ──────────────
// v2 파일을 열어 v4 전용 필드(extId·owner·실적일자·changeLog·baselineVersions)를 얹고 다시
// 저장했는데 선언만 v2 로 남으면, 버전으로 분기하는 코드가 있는 필드를 없다고 판단한다.
// normalize() 가 SCHEMA_VERSION 을 찍는지 실제 로드→저장 경로로 확인한다.
{
  const { useEditor } = await import('../src/state/store')
  const { canonicalProjectSnapshot } = await import('../src/state/crdt')
  const { SCHEMA_VERSION } = await import('../src/types/model')
  const v2Fixture = {
    id: 'proj-schema-v2',
    name: '구버전 저장 파일',
    startDate: '2024-01-01',
    paper: { size: 'A3', orientation: 'landscape', marginMm: 10, dpi: 150, fitToPage: true },
    view: {
      pxPerDay: 1.5,
      rowHeight: 46,
      labelWidth: 150,
      headerHeight: 56,
      scale: 'month',
      showCriticalPath: true,
      showFloat: false,
      showGrid: true,
      showTitle: true,
    },
    categories: [{ id: 'c1', name: '토공', color: '#7c93a8', collapsed: false, order: 0 }],
    tasks: [{ id: 't1', categoryId: 'c1', name: '터파기', start: 0, duration: 10 }],
    links: [],
    rainySeasons: [],
    branding: { logos: [] },
    palette: [],
    commissioningEnabled: true,
    meta: {
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      schemaVersion: 2,
    },
  }
  // parseProject(fileIO) 는 tasks/categories 배열 유무만 보므로 파일 로드 경로와 동치.
  useEditor.getState().setProject(v2Fixture as never)
  const loaded = useEditor.getState().project
  assert.equal(
    loaded.meta.schemaVersion,
    SCHEMA_VERSION,
    'v2 파일을 열면 선언 스키마 버전이 현재 버전으로 갱신되어야 한다',
  )
  assert.equal(
    loaded.meta.createdAt,
    '2024-01-01T00:00:00.000Z',
    '스키마 버전을 갱신해도 생성 시각은 보존한다',
  )
  // 실제 저장 경로(fileIO.saveProjectToFile = canonicalProjectSnapshot → JSON.stringify).
  const resaved = JSON.parse(JSON.stringify(canonicalProjectSnapshot(loaded)))
  assert.equal(
    resaved.meta.schemaVersion,
    SCHEMA_VERSION,
    `다시 저장한 파일이 v${SCHEMA_VERSION} 를 선언해야 한다(내용과 선언 불일치 금지)`,
  )
}

console.log(
  'persist smoke passed: 저장 표시 모델·내용 대조 확정·상태벡터 압축/집계 강등' +
    `(세션 ${SESSIONS.toLocaleString()}개)·조회 전용 표시·파일 백업 정직성(프로젝트 전환 포함)` +
    '·오프라인 동의 만료·배포 모드 해석·저장 파일 스키마 버전 정합 검증 완료',
)
