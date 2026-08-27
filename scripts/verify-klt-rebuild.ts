/**
 * READ-ONLY verification for Task 6b (the KLT per-set structure rebuild).
 *
 * This script makes NO writes to the database and NO AI calls. It exists so
 * the owner can prove, before and after running `npm run backfill:klts --
 * --direct --force`, that the rebuild only touched `SetKltNode` — never
 * `KlpState`, never `AnswerKlpResult`, never a `CardKlp` — which is the
 * global constraint this whole phase is built around (see
 * `docs/superpowers/plans/2026-08-25-klt-per-set-structure.md`, Task 6).
 *
 * Usage (run from the repo root; needs DATABASE_URL, which `.env` already has):
 *
 *   1. BEFORE the rebuild:
 *        npx tsx --env-file=.env scripts/verify-klt-rebuild.ts baseline
 *      Writes a stable snapshot of every `KlpState` row to
 *      `tmp/klt-rebuild-verify/klp-state-baseline.json` and prints its count
 *      and a sha256 hash of the canonical JSON.
 *
 *   2. Run the rebuild yourself (`npm run backfill:klts -- --direct --force`).
 *      This script does not run it and never will.
 *
 *   3. AFTER the rebuild:
 *        npx tsx --env-file=.env scripts/verify-klt-rebuild.ts verify
 *      Re-reads `KlpState` and reports IDENTICAL/DIFFERS against the saved
 *      baseline (byte-for-byte on the canonical JSON, and a diff of the
 *      first mismatching rows if it differs); runs `checkTreeInvariants`
 *      over every set's `SetKltNode` rows and reports violations PER SET;
 *      and reports every set that has linked concepts (`KlpTopic` rows on
 *      its cards) but zero `SetKltNode` rows — i.e. structure never got
 *      (re)built for it.
 *
 * Exit code is 0 only when the baseline matches AND there are zero invariant
 * violations AND every set with linked concepts has some structure. Any
 * other outcome exits 1, so this is safe to wire into a script the owner
 * runs and reads the exit code of.
 */
import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { checkTreeInvariants, type InvariantViolation } from '../src/lib/klt/invariants'
import type { SetNodeRow } from '../src/lib/klt/tree'

const OUT_DIR = join(process.cwd(), 'tmp', 'klt-rebuild-verify')
const BASELINE_PATH = join(OUT_DIR, 'klp-state-baseline.json')

function client(): PrismaClient {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL environment variable is not set')
  return new PrismaClient({ adapter: new PrismaNeon({ connectionString }) })
}

/**
 * Every `KlpState` row, in a STABLE order (sorted by userId then klpId, the
 * table's own `@@unique`) and with keys in a fixed order, so `JSON.stringify`
 * is deterministic across two runs regardless of what order Postgres happens
 * to return rows in. This determinism is the entire point — a hash over an
 * arbitrarily-ordered read would "differ" on a rebuild that changed nothing.
 */
async function snapshotKlpState(prisma: PrismaClient): Promise<
  { userId: string; klpId: string; pKnown: number; observations: number; lastObservedAt: string }[]
> {
  const rows = await prisma.klpState.findMany({
    select: { userId: true, klpId: true, pKnown: true, observations: true, lastObservedAt: true },
  })
  return rows
    .map((r) => ({
      userId: r.userId,
      klpId: r.klpId,
      pKnown: r.pKnown,
      observations: r.observations,
      lastObservedAt: r.lastObservedAt.toISOString(),
    }))
    .sort((a, b) => (a.userId === b.userId ? a.klpId.localeCompare(b.klpId) : a.userId.localeCompare(b.userId)))
}

function canonicalJson(rows: unknown): string {
  // Fixed key order per row (the object literal shape above never varies),
  // so this is just a stable stringify — no library needed for one shape.
  return JSON.stringify(rows, null, 2)
}

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

async function runBaseline(): Promise<void> {
  const prisma = client()
  try {
    const rows = await snapshotKlpState(prisma)
    const json = canonicalJson(rows)
    mkdirSync(dirname(BASELINE_PATH), { recursive: true })
    writeFileSync(BASELINE_PATH, json, 'utf8')
    console.log(`[verify-klt-rebuild] baseline captured: ${rows.length} KlpState row(s)`)
    console.log(`[verify-klt-rebuild] sha256: ${hash(json)}`)
    console.log(`[verify-klt-rebuild] written to: ${BASELINE_PATH}`)
  } finally {
    await prisma.$disconnect()
  }
}

/** (b) KlpState must be byte-identical to the baseline after the rebuild. */
async function checkKlpStateUnchanged(prisma: PrismaClient): Promise<boolean> {
  if (!existsSync(BASELINE_PATH)) {
    console.error(
      `[verify-klt-rebuild] NO BASELINE FOUND at ${BASELINE_PATH} — run the 'baseline' ` +
        `subcommand BEFORE the rebuild. Cannot verify KlpState is unchanged without one.`,
    )
    return false
  }
  const before = readFileSync(BASELINE_PATH, 'utf8')
  const beforeRows = JSON.parse(before) as Awaited<ReturnType<typeof snapshotKlpState>>
  const afterRows = await snapshotKlpState(prisma)
  const after = canonicalJson(afterRows)

  if (before === after) {
    console.log(`[verify-klt-rebuild] KlpState: IDENTICAL (${afterRows.length} rows, sha256 ${hash(after)})`)
    return true
  }

  console.error(
    `[verify-klt-rebuild] KlpState: DIFFERS — baseline had ${beforeRows.length} row(s), now ${afterRows.length}`,
  )
  const beforeByKey = new Map(beforeRows.map((r) => [`${r.userId}/${r.klpId}`, r]))
  const afterByKey = new Map(afterRows.map((r) => [`${r.userId}/${r.klpId}`, r]))
  let shown = 0
  for (const [key, beforeRow] of beforeByKey) {
    const afterRow = afterByKey.get(key)
    if (!afterRow) {
      console.error(`  REMOVED ${key}: ${JSON.stringify(beforeRow)}`)
      shown++
    } else if (JSON.stringify(beforeRow) !== JSON.stringify(afterRow)) {
      console.error(`  CHANGED ${key}: ${JSON.stringify(beforeRow)} -> ${JSON.stringify(afterRow)}`)
      shown++
    }
    if (shown >= 20) {
      console.error('  ...(further diffs truncated)')
      break
    }
  }
  for (const [key, afterRow] of afterByKey) {
    if (shown >= 20) break
    if (!beforeByKey.has(key)) {
      console.error(`  ADDED ${key}: ${JSON.stringify(afterRow)}`)
      shown++
    }
  }
  return false
}

/** (c) checkTreeInvariants, PER SET, over that set's own SetKltNode rows. */
async function checkInvariantsPerSet(prisma: PrismaClient): Promise<boolean> {
  const sets = await prisma.set.findMany({ select: { id: true, title: true } })
  let ok = true
  let setsWithNodes = 0

  for (const set of sets) {
    const nodes = await prisma.setKltNode.findMany({
      where: { setId: set.id },
      select: { id: true, kltId: true, parentKltId: true, depth: true, ancestorIds: true },
    })
    if (nodes.length === 0) continue
    setsWithNodes++

    const rows: SetNodeRow[] = nodes.map((n) => ({
      id: n.id,
      kltId: n.kltId,
      parentKltId: n.parentKltId,
      depth: n.depth,
      ancestorIds: n.ancestorIds,
    }))
    const violations: InvariantViolation[] = checkTreeInvariants(rows)
    if (violations.length > 0) {
      ok = false
      console.error(`[verify-klt-rebuild] set ${set.id} (${set.title}): ${violations.length} VIOLATION(S)`)
      for (const v of violations.slice(0, 10)) {
        console.error(`  ${v.kind} kltId=${v.kltId} nodeId=${v.nodeId}: ${v.detail}`)
      }
    }
  }

  if (ok) {
    console.log(`[verify-klt-rebuild] invariants: OK across ${setsWithNodes} set(s) with structure`)
  }
  return ok
}

/** (d) every set with linked concepts must have SOME SetKltNode rows. */
async function checkStructureCoverage(prisma: PrismaClient): Promise<boolean> {
  const sets = await prisma.set.findMany({ select: { id: true, title: true } })
  let ok = true
  let checked = 0

  for (const set of sets) {
    const linkedCount = await prisma.klpTopic.count({ where: { klp: { card: { setId: set.id } } } })
    if (linkedCount === 0) continue
    checked++

    const nodeCount = await prisma.setKltNode.count({ where: { setId: set.id } })
    if (nodeCount === 0) {
      ok = false
      console.error(
        `[verify-klt-rebuild] set ${set.id} (${set.title}): ${linkedCount} linked concept(s) but ZERO ` +
          `SetKltNode rows — structure was never (re)built for this set`,
      )
    }
  }

  if (ok) {
    console.log(`[verify-klt-rebuild] structure coverage: OK across ${checked} set(s) with linked concepts`)
  }
  return ok
}

async function runVerify(): Promise<void> {
  const prisma = client()
  try {
    const klpStateOk = await checkKlpStateUnchanged(prisma)
    const invariantsOk = await checkInvariantsPerSet(prisma)
    const coverageOk = await checkStructureCoverage(prisma)

    console.log('')
    console.log(
      `[verify-klt-rebuild] SUMMARY: KlpState ${klpStateOk ? 'unchanged' : 'DIFFERS'}, ` +
        `invariants ${invariantsOk ? 'clean' : 'VIOLATIONS'}, ` +
        `structure coverage ${coverageOk ? 'complete' : 'GAPS'}`,
    )

    if (!klpStateOk || !invariantsOk || !coverageOk) {
      process.exitCode = 1
    }
  } finally {
    await prisma.$disconnect()
  }
}

async function main() {
  const cmd = process.argv[2]
  if (cmd === 'baseline') {
    await runBaseline()
  } else if (cmd === 'verify') {
    await runVerify()
  } else {
    console.error('Usage: verify-klt-rebuild.ts <baseline|verify>')
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error('[verify-klt-rebuild] failed', err)
  process.exitCode = 1
})
