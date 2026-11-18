import type { DemoResult } from '@/actions/demo'
import { demoGauntletOptions, demoGauntletRun, demoGradeGameAnswer, demoProbeHotSeat, demoStartHotSeat } from '@/actions/demo'
import type { GauntletApi, HotSeatApi } from '@/lib/games/api'
import type { DemoRefusal } from '@/lib/demo/guard'

/**
 * Adapters that let the real Gauntlet and Hot Seat components run on the demo
 * actions. A `DemoResult` becomes the games' `{ success, data | error }`
 * result; a refusal that means "the guest has used their allowance" (or the
 * demo is full, or the guest's network hit its daily limit) also reaches
 * `onRefused` so the page can open the waitlist — and, for quota_used only,
 * remember the feature as spent.
 * Other failures just carry their message — the games already toast errors.
 */
const noScore = async () => ({ success: true as const, data: { saved: false } })

function adapt(onRefused: (r: DemoRefusal) => void) {
  return async function run<T>(call: () => Promise<DemoResult<T>>): Promise<{ success: true; data: T } | { success: false; error: string }> {
    const res = await call()
    if (res.ok) return { success: true, data: res.data }
    if (res.reason === 'quota_used' || res.reason === 'demo_cap' || res.reason === 'ip_limit') onRefused(res.reason)
    return { success: false, error: res.message }
  }
}

export function makeDemoGauntletApi(onRefused: (r: DemoRefusal) => void): GauntletApi {
  const run = adapt(onRefused)
  return {
    buildRun: () => run(() => demoGauntletRun()),
    options: (cardId, ask) => run(() => demoGauntletOptions(cardId, ask)),
    grade: (cardId, answer, opts) => run(() => demoGradeGameAnswer(cardId, answer, opts)),
    submitScore: noScore as GauntletApi['submitScore'],
  }
}

export function makeDemoHotSeatApi(onRefused: (r: DemoRefusal) => void): HotSeatApi {
  const run = adapt(onRefused)
  return {
    start: () => run(() => demoStartHotSeat()),
    grade: (cardId, answer, opts) => run(() => demoGradeGameAnswer(cardId, answer, opts)),
    probe: (cardId, klpId, answer, persona) => run(() => demoProbeHotSeat(cardId, klpId, answer, persona)),
    submitScore: noScore as HotSeatApi['submitScore'],
  }
}
