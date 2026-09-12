// 로그인 화면 — 본부 상징 이미지를 **전면(full-bleed)** 으로 깔고 그 위에 에디토리얼 제목을 얹는다.
//  · 삼안 CI 톤(samaneng.co.kr): 검은 캔버스 · 시네마틱 풀블리드 · 오렌지 포인트 · 와이드 트래킹 대문자.
//    예전의 원형 크롭 스테이지는 이 톤과 맞지 않아 걷어냈다.
//  · 모든 프레임을 마운트해 두고 opacity 로 교차 전환한다(remount 하면 캐시가 있어도 깜빡인다).
//  · 대표 이미지는 Higgsfield 생성 애셋(/divisions/hero/<key>.jpg), 없으면 심볼 PNG로 폴백.
//  · 하단 레일은 진행 표시 + 이동 버튼. 모션 최소화 설정을 존중한다(CSS).
import { useEffect, useState } from 'react'
import { DIVISIONS, divisionIcon } from '../../data/divisions'

const CYCLE_MS = 4200
const heroSrc = (key: string) => `/divisions/hero/${key}.jpg`

/** 본부별 영문 키커 — 에디토리얼 위계를 만드는 용도(삼안 사이트의 대문자 디스플레이와 같은 역할). */
const KICKER: Record<string, string> = {
  strategy: 'STRATEGY',
  'water-env': 'WATER ENVIRONMENT',
  'water-res': 'WATER RESOURCES',
  land: 'LAND DEVELOPMENT',
  railway: 'RAILWAY',
  road: 'ROAD',
  plant: 'PLANT',
  cm: 'CONSTRUCTION MANAGEMENT',
  overseas: 'OVERSEAS',
  bizdev: 'BUSINESS DEVELOPMENT',
  safety: 'SAFETY & QUALITY',
}

export function DivisionShowcase() {
  const [idx, setIdx] = useState(0)

  // 자동 순환. 사용자가 점을 누르면 그 지점부터 다시 센다(setIdx 가 타이머를 재설정).
  useEffect(() => {
    const t = window.setInterval(() => setIdx((i) => (i + 1) % DIVISIONS.length), CYCLE_MS)
    return () => window.clearInterval(t)
  }, [])

  const d = DIVISIONS[idx]
  return (
    <div className="showcase">
      <div className="showcase__media" aria-hidden="true">
        {DIVISIONS.map((dd, i) => (
          <img
            key={dd.key}
            className={`showcase__frame${i === idx ? ' is-active' : ''}`}
            src={heroSrc(dd.key)}
            alt=""
            loading={i === 0 ? 'eager' : 'lazy'}
            onError={(e) => {
              const img = e.currentTarget as HTMLImageElement
              const fb = divisionIcon(dd.key)
              if (fb && img.src.indexOf(fb) === -1) img.src = fb
            }}
          />
        ))}
        <div className="showcase__grade" />
        <div className="showcase__grain" />
      </div>

      <div className="showcase__copy">
        <span className="showcase__eyebrow">
          <i className="showcase__spark" aria-hidden="true" />
          (주)삼안 · 본부
        </span>
        {/* key={idx} → 전환마다 재생되는 슬라이드업 애니메이션 */}
        <span className="showcase__kicker" key={`k-${idx}`}>
          {KICKER[d.key] ?? 'SAMAN'}
        </span>
        <h2 className="showcase__name" key={`n-${idx}`}>
          {d.label}
        </h2>
      </div>

      <div className="showcase__rail" role="tablist" aria-label="본부">
        {DIVISIONS.map((dd, i) => (
          <button
            key={dd.key}
            type="button"
            className={`showcase__seg${i === idx ? ' is-active' : ''}`}
            aria-label={dd.label}
            aria-selected={i === idx}
            role="tab"
            onClick={() => setIdx(i)}
          >
            <span className="showcase__segfill" />
          </button>
        ))}
      </div>
    </div>
  )
}
