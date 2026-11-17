import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Spec 5 Phase A §6: the live-generation uniqueness of an answer's analysis
 * rows is an invariant that lives in SQL ONLY.
 *
 * `npm run regrade` holds two rows for the same (answer, key point) at once —
 * the superseded generation and the live one — so the whole-table
 * `@@unique([quizAnswerId, X])` constraints had to go. What replaced them is a
 * PARTIAL unique index `WHERE "supersededAt" IS NULL` on each of the three
 * tables: the same "one live verdict per answer per key point" rule, scoped
 * to rows nothing has superseded. Prisma cannot declare a partial index, so
 * `migrate diff` cannot see it — a migration regenerated from the schema
 * would silently drop the invariant, and a `@@unique` re-added to the schema
 * would silently make the first regrade roll back. This test is the guard
 * for both directions, in the same posture `tests/schema/klt-schema.test.ts`
 * takes with the GIN index: read the SQL by path, read the schema by path.
 */
const SQL = readFileSync(
  join(process.cwd(), 'prisma/migrations/20260917103000_regrade_generations/migration.sql'),
  'utf8',
)
const SCHEMA = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')

const LIVE_KEYS: [table: string, column: string][] = [
  ['AnswerKlpResult', 'klpId'],
  ['AnswerRelationResult', 'relationId'],
  ['AnswerFormResult', 'formRequirementId'],
]

describe('regrade generations — the live-key partial uniques', () => {
  for (const [table, column] of LIVE_KEYS) {
    it(`${table}: the migration creates the partial unique on (quizAnswerId, ${column}) WHERE supersededAt IS NULL`, () => {
      const re = new RegExp(
        `CREATE UNIQUE INDEX "${table}_live_key" ON "${table}"\\("quizAnswerId", "${column}"\\) WHERE "supersededAt" IS NULL;`,
      )
      expect(SQL).toMatch(re)
    })

    it(`${table}: the schema declares NO whole-table @@unique([quizAnswerId, ${column}])`, () => {
      // Re-adding it is one autocomplete away and would make the first regrade
      // violate it and roll back — exactly the failure the partial index exists
      // to prevent.
      expect(SCHEMA).not.toMatch(new RegExp(`@@unique\\(\\[quizAnswerId,\\s*${column}\\]\\)`))
    })

    it(`${table}: the model documents the SQL-only invariant and points at this test`, () => {
      const start = SCHEMA.indexOf(`model ${table} {`)
      expect(start).toBeGreaterThan(-1)
      const body = SCHEMA.slice(start, SCHEMA.indexOf('\n}', start))
      expect(body).toMatch(/supersededAt\s+DateTime\?/)
      expect(body).toContain('tests/schema/regrade-generations')
    })
  }

  it('the migration drops the three whole-table uniques it replaces', () => {
    for (const [table, column] of LIVE_KEYS) {
      expect(SQL).toContain(`DROP INDEX "${table}_quizAnswerId_${column}_key";`)
    }
  })

  it('every analysis table and QuizAnswer.regradedAt gained the generation columns', () => {
    for (const table of [
      'AnswerKlpResult', 'AnswerErrorTag', 'AnswerRelationResult', 'AnswerFormResult', 'AnswerUnwarrantedClaim',
    ]) {
      expect(SQL).toMatch(new RegExp(`ALTER TABLE "${table}" ADD COLUMN\\s+"supersededAt" TIMESTAMP\\(3\\);`))
    }
    expect(SQL).toMatch(/ALTER TABLE "QuizAnswer" ADD COLUMN\s+"regradedAt" TIMESTAMP\(3\);/)
  })

  it('adds the Task 6 unique on CardFormRequirement (cardId, klpVersion, index)', () => {
    expect(SQL).toContain(
      'CREATE UNIQUE INDEX "CardFormRequirement_cardId_klpVersion_index_key" ON "CardFormRequirement"("cardId", "klpVersion", "index");',
    )
    expect(SCHEMA).toMatch(/@@unique\(\[cardId, klpVersion, index\]\)/)
  })
})
