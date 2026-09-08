// ─────────────────────────────────────────────────────────────────────────────
// 단위(치수) 정규화·차원 검사 — 공기 적정성 엔진의 **입력 게이트**. 순수·무의존.
//
// 법정 산정식의 작업일수 = 작업수량 ÷ 1일 작업량(부록4)은 두 값의 단위가 같을 때에만
// 성립한다. 단위를 확인하지 않으면 520 ton 을 520㎥/일로 나눠 '이론 1일'이라는 그럴듯한
// 오답이 나오고, 그 숫자가 판정·검토요청서·AI 프롬프트까지 그대로 흘러간다.
//
// 이 모듈의 원칙:
//  · 정규화(표기 통일)만 한다 — ㎥·m3·m³·루베는 같은 단위, ㎡·m2 는 같은 단위.
//  · **환산은 하지 않는다.** ton↔㎥ 는 재료 단위중량·다짐률에 따라 달라지므로 근거 없는
//    계수를 코드에 심지 않는다(무근거 환산 차단). 근거 있는 계수는 호출자가 출처와 함께
//    명시 전달한다(engine/adequacy.ts 의 AdequacyOptions.unitConversion).
//  · 미등록·불일치 단위는 그럴듯한 숫자 대신 '판정불가'로 되돌린다.
//
// 정규화 규칙: NFKC(㎥→m3, ㎡→m2, 전각→반각) → 괄호 한정어 분리(span(15m)→span) →
// 공백·마침표·가운뎃점 제거 → 소문자 → 동의표기 테이블 조회. 미등록이면 정리된 문자열 그대로.
// ─────────────────────────────────────────────────────────────────────────────

/** 단위 검사 결과 상태. */
export type UnitStatus =
  /** 공정 단위 = 표준 일작업량 단위(동의표기 포함). */
  | 'match'
  /** 공정에 단위가 없음 — 표준 단위로 간주(가정)한다. */
  | 'missing'
  /** 단위가 서로 다름 — 물량÷생산성이 성립하지 않는다(판정불가). */
  | 'mismatch'
  /** 비교 대상(표준 일작업량)이 없음 — 단위 검사 자체가 불가. */
  | 'no-rate'

/** 단위의 물리 차원. 서로 다른 차원은 환산계수 없이 절대 교차하지 않는다. */
export type UnitDimension = 'volume' | 'area' | 'length' | 'mass' | 'count'

export interface UnitCheck {
  status: UnitStatus
  /** 공정에 입력된 원문 단위. */
  taskUnit?: string
  /** 표준 일작업량(부록4)의 원문 단위. */
  rateUnit?: string
  /** 정규화된 공정 단위(정본 표기). */
  canonical?: string
  /** 정규화된 표준 단위(정본 표기). */
  rateCanonical?: string
  /** 정규화된 공정 단위의 차원(미등록 단위면 undefined). */
  dimension?: UnitDimension
  /** 정규화된 표준 단위의 차원. */
  rateDimension?: UnitDimension
  /** 사용자에게 그대로 보여줄 한국어 안내(불일치 사유·조치). */
  message?: string
}

/**
 * 동의표기 테이블 — **STANDARD_RATES 에 실제로 등장하는 단위**만 등록한다(㎥·㎡·m·ton·본·
 * 개소·span·Lot·경간). 키는 정본 표기, 값은 현장·내역서에서 쓰이는 표기들이다.
 * 서로 다른 차원(질량↔부피 등)은 여기서 절대 같은 묶음에 넣지 않는다.
 */
export const UNIT_SYNONYMS: Record<string, string[]> = {
  '㎥': ['㎥', 'm3', 'm³', 'cum', 'cbm', '루베', '입방미터', '세제곱미터'],
  '㎡': ['㎡', 'm2', 'm²', 'sqm', '헤베', '제곱미터', '평방미터'],
  m: ['m', 'ｍ', 'lm', 'meter', '미터'],
  ton: ['ton', 't', 'mt', 'tonne', '톤'],
  본: ['본', '본수'],
  개소: ['개소', '개', 'ea', 'each', '개수'],
  span: ['span', '경간', '스팬'],
  lot: ['lot', '로트'],
}

/** 정본 단위 → 차원. 계수(count)형은 표기별로 서로 다른 대상을 세므로 정본이 달라도 차원만 같다. */
const UNIT_DIMENSION: Record<string, UnitDimension> = {
  '㎥': 'volume',
  '㎡': 'area',
  m: 'length',
  ton: 'mass',
  본: 'count',
  개소: 'count',
  span: 'count',
  lot: 'count',
}

/** 차원의 한국어 표기 — 안내문에 그대로 쓴다. */
const DIMENSION_LABEL: Record<UnitDimension, string> = {
  volume: '부피',
  area: '면적',
  length: '길이',
  mass: '질량',
  count: '개수',
}

/** 표기 정리(NFKC·괄호 한정어 분리·공백/구두점 제거·소문자). 동의표기 조회 전 단계. */
function cleanUnit(u: string): string {
  const nfkc = u.normalize('NFKC').trim()
  // 'span(15m)' · 'Lot(3.0m)' 처럼 괄호로 한정 조건이 붙은 표기는 앞부분만 단위로 본다.
  const base = nfkc.replace(/[([{].*$/, '')
  return base.replace(/[\s.·・,/]/g, '').toLowerCase()
}

/** 동의표기 → 정본 색인(정리된 키 기준). 모듈 로드 시 1회 구성. */
const SYNONYM_INDEX = new Map<string, string>()
for (const [canonical, forms] of Object.entries(UNIT_SYNONYMS)) {
  for (const f of forms) {
    const key = cleanUnit(f)
    if (key) SYNONYM_INDEX.set(key, canonical)
  }
}

/**
 * 단위를 정본 표기로 정규화. 빈 값이면 undefined, 미등록 단위면 정리된 문자열을 그대로
 * 돌려준다(임의로 다른 단위에 붙이지 않는다 — 미등록은 미등록으로 남겨 비교에서 걸린다).
 */
export function normalizeUnit(u?: string): string | undefined {
  if (u == null) return undefined
  const key = cleanUnit(String(u))
  if (!key) return undefined
  return SYNONYM_INDEX.get(key) ?? key
}

/** 정규화된 단위의 차원(미등록 단위는 undefined). */
export function unitDimension(u?: string): UnitDimension | undefined {
  const c = normalizeUnit(u)
  return c ? UNIT_DIMENSION[c] : undefined
}

/** 괄호 한정어('span(15m)' → '15m'). 없으면 undefined. */
function unitQualifier(u?: string): string | undefined {
  if (!u) return undefined
  const m = u.normalize('NFKC').match(/[([{]([^)\]}]+)[)\]}]/)
  return m ? m[1].trim() || undefined : undefined
}

/**
 * 공정 단위 vs 표준 일작업량 단위 비교(환산 없음).
 *  · 표준 단위 없음 → 'no-rate'  · 공정 단위 없음 → 'missing'(표준 단위로 간주하는 가정)
 *  · 정규화 동일 → 'match'       · 그 외 → 'mismatch'(판정불가 사유)
 */
export function compareUnits(taskUnit?: string, rateUnit?: string): UnitCheck {
  const rateCanonical = normalizeUnit(rateUnit)
  const canonical = normalizeUnit(taskUnit)
  if (rateCanonical == null) {
    return {
      status: 'no-rate',
      ...(taskUnit ? { taskUnit } : {}),
      ...(canonical
        ? {
            canonical,
            ...(unitDimension(canonical) ? { dimension: unitDimension(canonical) } : {}),
          }
        : {}),
    }
  }
  const rateDimension = UNIT_DIMENSION[rateCanonical]
  const common = {
    ...(taskUnit ? { taskUnit } : {}),
    ...(rateUnit ? { rateUnit } : {}),
    ...(canonical ? { canonical } : {}),
    rateCanonical,
    ...(unitDimension(canonical) ? { dimension: unitDimension(canonical) } : {}),
    ...(rateDimension ? { rateDimension } : {}),
  }
  if (canonical == null) {
    return {
      ...common,
      status: 'missing',
      message: `단위 미입력 · 표준 단위 «${rateUnit}» 기준으로 간주(가정) — 공정 속성에서 단위를 확인하세요.`,
    }
  }
  if (canonical === rateCanonical) {
    const q = unitQualifier(rateUnit)
    return {
      ...common,
      status: 'match',
      ...(q
        ? {
            message: `1${rateCanonical} = ${q} 기준(표준 일작업량) — 물량 산출 기준이 같은지 확인하세요.`,
          }
        : {}),
    }
  }
  const dimNote =
    rateDimension && common.dimension && rateDimension !== common.dimension
      ? `차원이 다릅니다(${DIMENSION_LABEL[common.dimension]} ↔ ${DIMENSION_LABEL[rateDimension]})`
      : common.dimension == null
        ? '등록되지 않은 단위 표기입니다'
        : '같은 차원이지만 세는 대상이 다른 단위입니다'
  return {
    ...common,
    status: 'mismatch',
    message:
      `단위 불일치 · 입력 «${taskUnit}» vs 표준 «${rateUnit}» — ${dimNote}. ` +
      '물량 단위를 표준 단위로 맞추거나, 환산계수와 그 출처를 지정해야 산정할 수 있습니다(임의 환산 없음).',
  }
}

/** 호출자가 **출처와 함께** 명시 전달하는 단위 환산. 내장 계수는 없다. */
export interface UnitConversion {
  from: string
  to: string
  /** 곱하는 계수(from → to). 0 이하면 무시. */
  factor: number
  /** 계수의 출처(설계기준·시방서·시험성적서 등). 비어 있으면 환산하지 않는다. */
  source: string
}

/** 이 환산이 해당 단위 검사(입력 단위 → 표준 단위)에 실제로 적용 가능한가. */
export function conversionApplies(conv: UnitConversion | undefined, check: UnitCheck): boolean {
  if (!conv) return false
  if (!Number.isFinite(conv.factor) || conv.factor <= 0) return false
  if (!conv.source?.trim()) return false
  const from = normalizeUnit(conv.from)
  const to = normalizeUnit(conv.to)
  return from != null && to != null && from === check.canonical && to === check.rateCanonical
}
