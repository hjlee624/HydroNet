// ─────────────────────────────────────────────────────────────────────────────
// Export engine. Single source of truth = the live on-screen <svg> (id
// "sequence-chart"), so exports match the editor exactly. The SVG is vector, so
// rasterising at the paper's DPI yields crisp output from A4 up to A0.
//
//   • SVG  — true vector, infinitely scalable
//   • PNG  — transparent or white raster at paper DPI
//   • JPG  — white-matted raster
//   • PDF  — paper-sized page (jsPDF) with the high-res raster placed to fit
// ─────────────────────────────────────────────────────────────────────────────

import { jsPDF } from 'jspdf'
import { paperPx } from '../engine/paper'
import { logError, logInfo } from '../state/logger'
import { colors } from '../styles/theme'
import type { PaperSettings } from '../types/model'

export type ExportFormat = 'svg' | 'png' | 'jpg' | 'pdf' | 'dxf'

interface ContentSize {
  width: number
  height: number
}

/** Clone the live chart SVG as a standalone, namespaced document string.
 *  출력 대화상자의 미리보기도 같은 함수를 써서 **실제 출력물과 동일한** 그림을 만든다.
 *  opts.stamp 를 주면 우측 하단에 버전 표기(사업명·시트·범위·시각)를 한 줄 얹는다. */
export function buildExportSvgString(
  svg: SVGSVGElement,
  content: ContentSize,
  opts: { background?: string; stamp?: string },
): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  // Drop on-screen-only overlays (selection grips, link anchors, logo handles).
  clone.querySelectorAll('[data-export-hide]').forEach((el) => el.remove())
  // 전체 맞춤 화면은 낮은 배율에서도 읽히도록 글자를 역보정한다. 출력물에는 사용자가 지정한
  // 원래 도면 글자 크기를 복원해 화면 배율이 출력 결과를 바꾸지 않게 한다.
  clone.querySelectorAll('[data-export-font-size]').forEach((el) => {
    const size = el.getAttribute('data-export-font-size')
    if (size) el.setAttribute('font-size', size)
    el.removeAttribute('data-export-font-size')
  })
  // 화면에서만 보장한 최소 막대 폭·높이와 그에 맞춘 라벨 위치도 원래 도면 좌표로 복원한다.
  const exportAttrs = [
    ['x', 'x'],
    ['y', 'y'],
    ['width', 'width'],
    ['height', 'height'],
    ['points', 'points'],
    ['stroke-width', 'stroke-width'],
    ['stroke-dasharray', 'stroke-dasharray'],
    ['marker-width', 'markerWidth'],
    ['marker-height', 'markerHeight'],
  ] as const
  for (const [dataName, svgName] of exportAttrs) {
    clone.querySelectorAll(`[data-export-${dataName}]`).forEach((el) => {
      const value = el.getAttribute(`data-export-${dataName}`)
      if (value != null) el.setAttribute(svgName, value)
      el.removeAttribute(`data-export-${dataName}`)
    })
  }
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  clone.setAttribute('width', String(content.width))
  clone.setAttribute('height', String(content.height))
  clone.setAttribute('viewBox', `0 0 ${content.width} ${content.height}`)

  if (opts.background) {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect.setAttribute('x', '0')
    rect.setAttribute('y', '0')
    rect.setAttribute('width', String(content.width))
    rect.setAttribute('height', String(content.height))
    rect.setAttribute('fill', opts.background)
    clone.insertBefore(rect, clone.firstChild)
  }
  // Default exported text to KoPub Medium; bold elements (title / 공종) carry an
  // inline font-family that overrides this rule.
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  style.textContent = `text{font-family:'KoPubWorld Dotum_Pro Medium','KoPubWorldDotum_Pro Medium','Malgun Gothic',sans-serif;}`
  clone.insertBefore(style, clone.firstChild)

  // 버전 표기(선택) — 우측 하단 한 줄. 미지정이면 출력물은 기존과 완전히 동일하다.
  if (opts.stamp) {
    const stamp = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    stamp.setAttribute('x', String(content.width - 8))
    stamp.setAttribute('y', String(content.height - 8))
    stamp.setAttribute('text-anchor', 'end')
    stamp.setAttribute('font-size', '10')
    stamp.setAttribute('fill', colors.steel)
    stamp.textContent = opts.stamp
    clone.appendChild(stamp)
  }

  return new XMLSerializer().serializeToString(clone)
}

function svgToDataUrl(svgString: string): string {
  // encodeURIComponent handles the Korean text & '#' colour chars safely.
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString)
}

function triggerDownload(blobOrUrl: Blob | string, filename: string): void {
  const url = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  if (typeof blobOrUrl !== 'string') setTimeout(() => URL.revokeObjectURL(url), 4000)
}

async function rasterize(
  svgString: string,
  content: ContentSize,
  targetW: number,
  targetH: number,
  background: string | null,
): Promise<HTMLCanvasElement> {
  const img = new Image()
  img.decoding = 'sync'
  const url = svgToDataUrl(svgString)
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('SVG 이미지를 로드하지 못했습니다.'))
    img.src = url
  })

  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d')!
  if (background) {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, targetW, targetH)
  }
  // Fit content into the page preserving aspect ratio (letterbox), centred.
  const scale = Math.min(targetW / content.width, targetH / content.height)
  const drawW = content.width * scale
  const drawH = content.height * scale
  const dx = (targetW - drawW) / 2
  const dy = (targetH - drawH) / 2
  ctx.drawImage(img, dx, dy, drawW, drawH)
  return canvas
}

export interface ExportOptions {
  svg: SVGSVGElement
  content: ContentSize
  paper: PaperSettings
  filename: string
  format: ExportFormat
  /** PNG transparency; ignored for JPG/PDF which always matte white. */
  transparent?: boolean
  /** 우측 하단 버전 표기 한 줄(사업명·시트·출력 범위·시각). 미지정이면 표기 없음. */
  stamp?: string
}

export async function exportChart(opts: ExportOptions): Promise<{ clamped: boolean }> {
  const { svg, content, paper, filename, format } = opts
  try {
    if (format === 'svg') {
      const str = buildExportSvgString(svg, content, {
        background: opts.transparent ? undefined : colors.canvas,
        stamp: opts.stamp,
      })
      triggerDownload(new Blob([str], { type: 'image/svg+xml' }), `${filename}.svg`)
      logInfo(`SVG 내보내기 완료: ${filename}.svg`)
      return { clamped: false }
    }

    const px = paperPx(paper)
    const whiteBg = colors.canvas
    const wantWhite = format !== 'png' || !opts.transparent
    const bg = wantWhite ? whiteBg : null
    const svgString = buildExportSvgString(svg, content, {
      background: bg ?? undefined,
      stamp: opts.stamp,
    })

    const canvas = await rasterize(svgString, content, px.wPx, px.hPx, bg)

    if (format === 'png' || format === 'jpg') {
      const mime = format === 'png' ? 'image/png' : 'image/jpeg'
      const quality = format === 'jpg' ? 0.94 : undefined
      await new Promise<void>((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(
                new Error(
                  '캔버스를 이미지로 변환하지 못했습니다. 해상도(DPI)를 낮춰 다시 시도하세요.',
                ),
              )
              return
            }
            triggerDownload(blob, `${filename}.${format}`)
            resolve()
          },
          mime,
          quality,
        )
      })
      logInfo(`${format.toUpperCase()} 내보내기 완료 (${px.effectiveDpi}dpi): ${filename}`)
      return { clamped: px.clamped }
    }

    // PDF — page sized to the chosen paper, raster placed full-bleed.
    const dataUrl = canvas.toDataURL('image/jpeg', 0.94)
    const orientation = px.wMm >= px.hMm ? 'landscape' : 'portrait'
    const pdf = new jsPDF({ orientation, unit: 'mm', format: [px.wMm, px.hMm], compress: true })
    pdf.addImage(dataUrl, 'JPEG', 0, 0, px.wMm, px.hMm, undefined, 'FAST')
    pdf.save(`${filename}.pdf`)
    logInfo(`PDF 내보내기 완료 (${paper.size}, ${px.effectiveDpi}dpi): ${filename}`)
    return { clamped: px.clamped }
  } catch (e) {
    logError('내보내기 실패', e)
    throw e
  }
}
