// 로그인 화면 좌측 — 각 본부의 상징 이미지와 본부명이 스스로 둥둥 떠다니며 회전 전환한다.
//  · 자동 순환(클릭 불필요). 원형 스테이지가 부유(bob)하고, 이미지는 좌측에서 회전하며 들어오며,
//    주변 오브들이 떠다녀 "살아있는" 인트로가 된다.
//  · 대표 이미지는 Higgsfield 생성 애셋(/divisions/hero/<key>.jpg), 없으면 심볼 PNG로 폴백.
//  · 하단 점은 진행 표시(클릭 시 해당 본부로 이동). 모션 최소화 설정을 존중.
import { useEffect, useState } from 'react'
import { DIVISIONS, divisionIcon } from '../../data/divisions'

const CYCLE_MS = 3600
const heroSrc = (key: string) => `/divisions/hero/${key}.jpg`

// 둥둥 떠다니는 장식 오브(결정론적 배치 — 위치/크기/속도 고정, 애니메이션은 CSS).
const ORBS = [
  { top: 6, left: 80, size: 30, dur: 11, delay: 0 },
  { top: 70, left: 8, size: 44, dur: 15, delay: 1.4 },
  { top: 18, left: 10, size: 18, dur: 9, delay: 0.6 },
  { top: 82, left: 76, size: 34, dur: 13, delay: 2.1 },
  { top: 44, left: 92, size: 22, dur: 10, delay: 1.1 },
  { top: 60, left: 44, size: 14, dur: 8, delay: 0.3 },
]

export function DivisionShowcase() {
  const [idx, setIdx] = useState(0)

  // 대표 이미지 프리로드 — 전환마다 <img>가 remount 돼도 캐시에서 즉시 표시(깜빡임 방지).
  useEffect(() => {
    for (const d of DIVISIONS) {
      const im = new Image()
      im.src = heroSrc(d.key)
    }
  }, [])

  // 항상 자동 전환(마우스 올려도 멈추지 않음).
  useEffect(() => {
    const t = window.setInterval(() => setIdx((i) => (i + 1) % DIVISIONS.length), CYCLE_MS)
    return () => window.clearInterval(t)
  }, [])

  const d = DIVISIONS[idx]
  return (
    <div className="showcase">
      {/* 둥둥 떠다니는 오브 */}
      <div className="showcase__orbs" aria-hidden="true">
        {ORBS.map((o, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: 고정 장식 배열
            key={i}
            className="showcase__orb"
            style={{
              top: `${o.top}%`,
              left: `${o.left}%`,
              width: o.size,
              height: o.size,
              animationDuration: `${o.dur}s`,
              animationDelay: `${o.delay}s`,
            }}
          />
        ))}
      </div>

      <div className="showcase__stage">
        {/* 전체가 부유(bob)하며 살짝 기운다 */}
        <div className="showcase__float">
          <div className="showcase__ring" aria-hidden="true" />
          {/* key={idx} → 전환마다 remount 되어 좌측에서 회전하며 들어오는 애니메이션 재생 */}
          <div className="showcase__card" key={idx}>
            <div className="showcase__imgwrap">
              <img
                className="showcase__img"
                src={heroSrc(d.key)}
                alt=""
                onError={(e) => {
                  const img = e.currentTarget as HTMLImageElement
                  const fb = divisionIcon(d.key)
                  if (fb && img.src.indexOf(fb) === -1) img.src = fb
                }}
              />
            </div>
          </div>
          <div className="showcase__label" key={`l-${idx}`}>
            <span className="showcase__kicker">본부</span>
            <span className="showcase__name">{d.label}</span>
          </div>
        </div>
      </div>

      <div className="showcase__dots" role="tablist" aria-label="본부">
        {DIVISIONS.map((dd, i) => (
          <button
            key={dd.key}
            type="button"
            className={`showcase__dot${i === idx ? ' is-active' : ''}`}
            aria-label={dd.label}
            aria-selected={i === idx}
            onClick={() => setIdx(i)}
          />
        ))}
      </div>
    </div>
  )
}
