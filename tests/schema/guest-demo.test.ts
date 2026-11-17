import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const SCHEMA = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')

function body(model: string): string {
  const start = SCHEMA.indexOf(`model ${model} {`)
  expect(start).toBeGreaterThan(-1)
  return SCHEMA.slice(start, SCHEMA.indexOf('\n}', start))
}

describe('guest demo schema', () => {
  it('DemoTicket is unique per (guestId, feature) and indexed for the IP cap', () => {
    const b = body('DemoTicket')
    expect(b).toMatch(/@@unique\(\[guestId, feature\]\)/)
    expect(b).toMatch(/@@index\(\[ipHash, feature, createdAt\]\)/)
    expect(b).toMatch(/calls\s+Int\s+@default\(0\)/)
  })

  it('DemoTicket carries spent, the never-refunded count the daily cap sums', () => {
    expect(body('DemoTicket')).toMatch(/spent\s+Int\s+@default\(0\)/)
  })

  it('InviteRequest.email is unique', () => {
    expect(body('InviteRequest')).toMatch(/email\s+String\s+@unique/)
  })
})
