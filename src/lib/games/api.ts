import { buildGauntletRun, gauntletOptions, gradeGameAnswer, submitGameScore, startHotSeat, probeHotSeat } from '@/actions/games'
import type { GauntletMode } from '@/lib/games/gauntlet'
import type { HotSeatMode } from '@/lib/games/hot-seat'

/**
 * The calls the Gauntlet and Hot Seat components make. The real actions are
 * the default; the guest demo injects adapters over its own actions. Types
 * are read off the real actions so the two cannot drift.
 */
type GradeOpts = { klpIds?: string[] }

export interface GauntletApi {
  buildRun(setId: string, mode: GauntletMode): ReturnType<typeof buildGauntletRun>
  options: typeof gauntletOptions
  grade(cardId: string, answer: string, opts?: GradeOpts): ReturnType<typeof gradeGameAnswer>
  submitScore: typeof submitGameScore
}

export interface HotSeatApi {
  start(setId: string, mode: HotSeatMode): ReturnType<typeof startHotSeat>
  grade(cardId: string, answer: string, opts?: GradeOpts): ReturnType<typeof gradeGameAnswer>
  probe: typeof probeHotSeat
  submitScore: typeof submitGameScore
}

export const realGauntletApi: GauntletApi = {
  buildRun: (setId, mode) => buildGauntletRun(setId, { mode }),
  options: (cardId, ask) => gauntletOptions(cardId, ask),
  grade: (cardId, answer, opts) => (opts ? gradeGameAnswer(cardId, answer, opts) : gradeGameAnswer(cardId, answer)),
  submitScore: (input) => submitGameScore(input),
}

export const realHotSeatApi: HotSeatApi = {
  start: (setId, mode) => startHotSeat(setId, mode),
  grade: (cardId, answer, opts) => (opts ? gradeGameAnswer(cardId, answer, opts) : gradeGameAnswer(cardId, answer)),
  probe: (cardId, klpId, answer, persona) => probeHotSeat(cardId, klpId, answer, persona),
  submitScore: (input) => submitGameScore(input),
}
