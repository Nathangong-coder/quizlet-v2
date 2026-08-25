import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')

function model(name: string): string {
  const body = schema.split(`model ${name} {`)[1]
  if (body === undefined) throw new Error(`model ${name} not found`)
  return body.split('\n}')[0]
}

describe('KLT schema', () => {
  it('makes Klt.normalizedName globally unique', () => {
    // This single constraint is what makes "WACC" one node for every learner
    // rather than one per account — the precondition for cross-user comparison.
    expect(model('Klt')).toMatch(/normalizedName\s+String\s+@unique/)
  })

  it('does not scope Klt to a set or a user', () => {
    const body = model('Klt')
    expect(body).not.toMatch(/setId/)
    expect(body).not.toMatch(/userId/)
  })

  it('keeps CardKlp.label nullable so an unsummarized KLP still renders', () => {
    expect(model('CardKlp')).toMatch(/label\s+String\?/)
  })

  it('uniquely constrains a KLP/KLT pair so a rerun cannot duplicate links', () => {
    expect(model('KlpTopic')).toMatch(/@@unique\(\[klpId, kltId\]\)/)
  })

  it('gives Card its own kltStatus, separate from klpStatus', () => {
    // The two passes fail independently: a card can have good KLPs and no
    // topics. One shared column would make a topic failure look like a KLP
    // failure and offer the wrong retry.
    const body = model('Card')
    expect(body).toMatch(/kltStatus\s+String\s+@default\("pending"\)/)
    expect(body).toMatch(/klpStatus\s+String\s+@default\("pending"\)/)
  })

  it('cascades KlpTopic from both parents so no link outlives its endpoints', () => {
    const body = model('KlpTopic')
    expect(body).toMatch(/klp\s+CardKlp\s+@relation\(.*onDelete: Cascade\)/)
    expect(body).toMatch(/klt\s+Klt\s+@relation\(.*onDelete: Cascade\)/)
  })
})
