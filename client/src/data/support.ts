// 문의·지원 창구 데이터(F18). 본부별 '대표 사용자(챔피언)' 는 도입 시 사람이 채워야 하는
// 값이므로 저장소에는 **빈 칸으로** 둔다 — 실명을 지어내지 않는다. 화면에서는 빈 값이
// '미지정(배포 시 기입)' 으로 표시된다.
//
// 순서·키는 client/src/data/divisions.ts 의 DIVISIONS 에서 그대로 파생한다(본부를 새로
// 만들지 않는다). 같은 표가 docs/Sequence_지원체계_및_도입효과_측정.md 에도 있고,
// 두 곳의 순서는 항상 같아야 한다.

import { DIVISIONS } from './divisions'

/** package.json 의 version 과 맞춰 둔다(진단 정보·문의 창구에 표기). */
export const APP_VERSION = '0.1.0'

export interface SupportContact {
  /** DIVISIONS 의 key. */
  division: string
  /** 본부 대표 사용자 이름. 빈 문자열 = 미지정(배포 시 기입). */
  champion: string
  /** 연락 방법·비고. 빈 문자열 = 미지정(배포 시 기입). */
  note: string
}

export const SUPPORT_CONTACTS: SupportContact[] = DIVISIONS.map((d) => ({
  division: d.key,
  champion: '',
  note: '',
}))

/** 화면 표기용 — 빈 칸을 지어내지 않고 '미지정' 으로 드러낸다. */
export const orUnset = (v: string): string => (v.trim() ? v : '미지정(배포 시 기입)')

/** 문의 전 스스로 확인할 항목(가장 잦은 3가지). */
export const SUPPORT_CHECKS: string[] = [
  '사내망(LAN)에 연결되어 있고 접속 주소·포트가 맞는지 — docs/Sequence_접속_및_사용자등록_안내.md §1',
  '저장은 자동이 아닙니다. 상단 [저장] 또는 Ctrl+S 로 .json 파일에 남겼는지',
  '출력이 이상하면 [도면 출력] 창의 용지·방향·DPI 와 사전 점검 문구를 먼저 확인',
]

/** 문의 전 읽을 문서(저장소 경로 그대로 안내 — 외부 링크·발송 없음). */
export const SUPPORT_DOCS: { path: string; what: string }[] = [
  { path: 'docs/Sequence_15분_교육안내.md', what: '처음 1회 15분 따라하기' },
  { path: 'docs/Sequence_본부별_업무예제.md', what: '본부별 실제 업무 예제' },
  { path: 'docs/Sequence_지원체계_및_도입효과_측정.md', what: '문의 처리 절차 · 효과 측정' },
  { path: 'docs/Sequence_접속_및_사용자등록_안내.md', what: '접속 · 사용자 등록 · 비밀번호' },
]
