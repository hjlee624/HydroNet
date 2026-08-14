// 로그인·프로젝트 선택 화면의 동적 배경.
//  · Higgsfield로 생성한 모션그래픽 영상(/auth/hydro-loop.mp4)을 은은하게 재생하고,
//  · 영상 위/아래로 CSS 그라디언트 메시·흐르는 SVG 파도·떠오르는 입자를 얹고,
//  · 마우스 움직임에 따라 각 레이어가 서로 다른 깊이(패럴랙스)로 따라 움직여 UI가
//    커서에 반응하는 살아있는 배경을 만든다(커서 글로우 포함).
// 영상이 없거나(오프라인·미지원) 로드 실패해도, 또는 모션 최소화 설정이면 CSS 레이어만으로
// 자연스럽게 동작한다(그레이스풀). 좌표는 CSS 변수(--mx,--my: -0.5~0.5 / --px,--py: px)로
// 넘겨 각 레이어가 `translate`(keyframe transform 과 독립 합성)로 소비한다.
import { useEffect, useRef, useState } from 'react'

// 입자(물방울) — index로 위치/크기/속도를 결정론적으로 배치(Math.random 미사용).
const DOTS = Array.from({ length: 16 }, (_, i) => {
  const left = (i * 61.8) % 100 // 황금비 간격으로 고르게 흩뿌림
  const size = 4 + ((i * 7) % 12)
  const delay = (i * 0.73) % 9
  const duration = 11 + ((i * 5) % 9)
  const drift = i % 2 === 0 ? 26 : -22
  return { left, size, delay, duration, drift, key: i }
})

export function AuthBackground() {
  const [videoReady, setVideoReady] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // 마우스 패럴랙스 — 포인터 이동을 rAF로 스로틀해 CSS 변수로 전달. 모션 최소화면 미동작.
  useEffect(() => {
    const reduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) return
    let raf = 0
    const onMove = (e: PointerEvent) => {
      if (raf) return
      raf = window.requestAnimationFrame(() => {
        raf = 0
        const el = rootRef.current
        if (!el) return
        const w = window.innerWidth || 1
        const h = window.innerHeight || 1
        el.style.setProperty('--mx', (e.clientX / w - 0.5).toFixed(4))
        el.style.setProperty('--my', (e.clientY / h - 0.5).toFixed(4))
        el.style.setProperty('--px', `${e.clientX}px`)
        el.style.setProperty('--py', `${e.clientY}px`)
      })
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      if (raf) window.cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div className="auth-bg" ref={rootRef} aria-hidden="true">
      <div className="auth-bg__mesh" />
      <video
        className={`auth-bg__video${videoReady ? ' is-ready' : ''}`}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        onCanPlay={() => setVideoReady(true)}
      >
        <source src="/auth/hydro-loop.mp4" type="video/mp4" />
      </video>
      <div className="auth-bg__tint" />
      {/* 커서를 따라다니는 부드러운 광원 — 마우스가 곧 조명원이 된다. */}
      <div className="auth-bg__glow" />
      <svg
        className="auth-bg__waves"
        viewBox="0 0 1440 360"
        preserveAspectRatio="none"
        role="presentation"
      >
        <path
          className="auth-bg__wave auth-bg__wave--3"
          d="M0,220 C240,180 420,300 720,250 C1020,200 1200,300 1440,240 L1440,360 L0,360 Z"
        />
        <path
          className="auth-bg__wave auth-bg__wave--2"
          d="M0,250 C260,300 460,200 720,250 C980,300 1200,210 1440,270 L1440,360 L0,360 Z"
        />
        <path
          className="auth-bg__wave auth-bg__wave--1"
          d="M0,290 C220,250 480,330 720,290 C960,250 1220,330 1440,290 L1440,360 L0,360 Z"
        />
      </svg>
      <div className="auth-bg__particles">
        {DOTS.map((d) => (
          <span
            key={d.key}
            className="auth-bg__dot"
            style={{
              left: `${d.left}%`,
              width: d.size,
              height: d.size,
              animationDelay: `${d.delay}s`,
              animationDuration: `${d.duration}s`,
              // 좌우 흔들림 폭(px) — 키프레임에서 var(--drift)로 사용.
              ['--drift' as string]: `${d.drift}px`,
            }}
          />
        ))}
      </div>
    </div>
  )
}
