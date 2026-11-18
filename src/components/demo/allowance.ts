import { DEMO_FEATURES, GUEST_LIMITS, type DemoFeature } from '@/lib/demo/config'
import type { GuestState } from '@/lib/demo/store'

export const FEATURE_LABEL: Record<DemoFeature, string> = {
  grade: 'Graded answer',
  'klp-extract': 'Key-point check',
  gauntlet: 'Gauntlet',
  'hot-seat': 'Hot Seat',
  autocomplete: 'AI suggest',
}

export function triesUsed(state: GuestState): number {
  return DEMO_FEATURES.filter((f) => state.used[f]).length
}

export function allowanceRows(state: GuestState): { label: string; status: string }[] {
  return [
    ...DEMO_FEATURES.map((f) => ({ label: FEATURE_LABEL[f], status: state.used[f] ? 'used' : '1 left' })),
    {
      label: 'Quiz',
      status: state.quizzesStarted >= GUEST_LIMITS.quizzes ? 'used' : `${GUEST_LIMITS.quizzes - state.quizzesStarted} left`,
    },
  ]
}
