import { assessConstructionPeriod, assessTaskAdequacy } from '../../client/src/engine/adequacy'
import type { Task } from '../../client/src/types/model'
const task = (id: string): Task => ({ id, categoryId: 'c', name: id, start: 0, duration: 10, isMilestone: false })
const parallel = assessConstructionPeriod({ tasks: [task('A'), task('B')], links: [], prepDays: 0, cleanupDays: 0 })
const wrongUnit = assessTaskAdequacy({ ...task('U'), quantity: 520, unit: 'ton', workCode: 'earthwork-cut-soil' })
console.log(JSON.stringify({ parallel: { calendarSpan: parallel.actualSpan, summedWork: parallel.parts.work, criticalCount: parallel.criticalCount }, wrongUnit: { inputUnit: 'ton', rateUnit: wrongUnit.rate?.unit, theoretical: wrongUnit.theoretical, verdict: wrongUnit.verdict } }, null, 2))
