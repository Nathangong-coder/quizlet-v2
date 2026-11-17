// Pure: no Prisma, no next/headers, no auth.
export const DEMO_FEATURES = ['grade', 'klp-extract', 'gauntlet', 'hot-seat', 'autocomplete'] as const
export type DemoFeature = (typeof DEMO_FEATURES)[number]

export const FEATURE_CEILING: Record<DemoFeature, number> = {
  grade: 1,
  'klp-extract': 5,
  gauntlet: 12,
  'hot-seat': 15,
  autocomplete: 1,
}

export const RUN_FEATURES: ReadonlySet<DemoFeature> = new Set<DemoFeature>(['gauntlet', 'hot-seat'])
export const RUN_WINDOW_MS = 30 * 60 * 1000

export const GUEST_LIMITS = { sets: 1, cards: 5, quizzes: 1, questionsPerQuiz: 1 } as const

const DEFAULT_DAILY_CAP = 1000
const DEFAULT_PER_IP_FEATURE_LIMIT = 3

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || !/^\s*\d+\s*$/.test(raw)) return fallback
  const n = Number(raw)
  return Number.isSafeInteger(n) && n > 0 ? n : fallback
}

export function readDemoConfig(env: Record<string, string | undefined> = process.env) {
  const setId = env.DEMO_SET_ID || null
  const aiUserId = env.DEMO_AI_USER_ID || null
  const secret = env.AUTH_SECRET || env.NEXTAUTH_SECRET || null
  return {
    enabled: env.DEMO_ENABLED === 'true' && !!aiUserId && !!setId && !!secret,
    setId,
    aiUserId,
    dailyCap: positiveInt(env.DEMO_DAILY_CAP, DEFAULT_DAILY_CAP),
    perIpFeatureLimit: positiveInt(env.DEMO_PER_IP_FEATURE_LIMIT, DEFAULT_PER_IP_FEATURE_LIMIT),
    secret,
  }
}

export type DemoConfig = ReturnType<typeof readDemoConfig>
