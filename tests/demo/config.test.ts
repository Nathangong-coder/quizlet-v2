import { describe, expect, it } from 'vitest'
import { readDemoConfig } from '@/lib/demo/config'

const full = {
  DEMO_ENABLED: 'true',
  DEMO_AI_USER_ID: 'u1',
  DEMO_SET_ID: 's1',
  AUTH_SECRET: 'sec',
}

describe('readDemoConfig', () => {
  it('is disabled with an empty env', () => {
    expect(readDemoConfig({}).enabled).toBe(false)
  })
  it('enables only with the exact string true and all ids', () => {
    expect(readDemoConfig(full).enabled).toBe(true)
    expect(readDemoConfig({ ...full, DEMO_ENABLED: 'TRUE' }).enabled).toBe(false)
    expect(readDemoConfig({ ...full, DEMO_SET_ID: undefined }).enabled).toBe(false)
    expect(readDemoConfig({ ...full, DEMO_AI_USER_ID: undefined }).enabled).toBe(false)
    expect(readDemoConfig({ ...full, AUTH_SECRET: undefined }).enabled).toBe(false)
  })
  it('falls back to NEXTAUTH_SECRET', () => {
    const c = readDemoConfig({ ...full, AUTH_SECRET: undefined, NEXTAUTH_SECRET: 'n' })
    expect(c.secret).toBe('n')
    expect(c.enabled).toBe(true)
  })
  it('defaults bad or non-positive numbers', () => {
    expect(readDemoConfig({ ...full, DEMO_DAILY_CAP: 'abc' }).dailyCap).toBe(1000)
    expect(readDemoConfig({ ...full, DEMO_PER_IP_FEATURE_LIMIT: '0' }).perIpFeatureLimit).toBe(3)
    expect(readDemoConfig({ ...full, DEMO_DAILY_CAP: '50' }).dailyCap).toBe(50)
  })
})
