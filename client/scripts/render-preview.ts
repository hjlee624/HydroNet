// Dev-only: render the real ChartSvg component headlessly and rasterize to PNG,
// so the milestone output can be visually compared against
// DESIGN/milestone sample.png without opening a browser.
// Run: npx tsx scripts/render-preview.ts
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { writeFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'
import { createSampleProject } from '../src/data/sampleProject'
import { migrateSubNameToParentId } from '../src/state/store'
import { computeSchedule } from '../src/engine/scheduling'
import { computeLayout } from '../src/engine/layout'
import { routeLinks } from '../src/engine/routing'
import { ChartSvg } from '../src/components/ChartSvg'

const noop = () => {}
const project = createSampleProject()
project.tasks = migrateSubNameToParentId(project.tasks) // 앱과 동일하게 subName→parentId 이관
const sched = computeSchedule(project.tasks, project.links)
// HN_FONTSCALE lets us eyeball that bigger fonts grow their boxes (no clipping).
const fontScale = Number(process.env.HN_FONTSCALE) || 1
// HN_YEARLINE lets us eyeball the 연도 구분선 두께(세로선 + 제목↔연도 가로선) at any px.
const yearLineWidth = Number(process.env.HN_YEARLINE) || project.view.yearLineWidth
const sp = { ...project, tasks: sched.tasks, view: { ...project.view, fontScale, yearLineWidth } }
const model = computeLayout(sp)
const routed = routeLinks(model, sp.links)

let svg = renderToStaticMarkup(
  createElement(ChartSvg, {
    model,
    routed,
    project: sp,
    selectedTaskId: process.env.HN_SELECT || null,
    selectedTaskIds: process.env.HN_SELECT ? [process.env.HN_SELECT] : [],
    selectedLinkId: null,
    selectedTextRole: null,
    showCriticalPath: true,
    showGrid: true,
    linkingGhost: null,
    onTaskPointerDown: noop,
    onAnchorPointerDown: noop,
    onBarResizePointerDown: noop,
    onLogoResizePointerDown: noop,
    onTaskClick: noop,
    onTaskDoubleClick: noop,
    onTaskContextMenu: noop,
    onLinkClick: noop,
    onTextClick: noop,
    onRainyResizePointerDown: noop,
    onBackgroundClick: noop,
  }),
)
if (!svg.includes('xmlns')) svg = svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')

writeFileSync('preview.svg', svg)
const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: Math.round(model.contentWidth) },
  font: { loadSystemFonts: true, defaultFontFamily: 'Malgun Gothic' },
  background: 'white',
})
writeFileSync('preview.png', resvg.render().asPng())
console.log(
  `wrote preview.png (${Math.round(model.contentWidth)}×${Math.round(model.contentHeight)})`,
)
