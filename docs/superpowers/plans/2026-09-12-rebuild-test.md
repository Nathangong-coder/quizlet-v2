# Rebuild test — implementation plan

Spec: `docs/superpowers/specs/2026-09-12-rebuild-test-design.md`. Owner's rulings folded in
(2026-09-12): writer and grader MAY share a family; the adversary writer and the rebuilder
must not share the writer's family; the grader must not be the adversary writer.

## Tasks, in order

1. **Prompts** (`src/lib/ai/prompts/`), version 1 each, tests pin the isolation:
   - `WRITE_REBUILD_PROMPT` — question + key points → `rebuiltAnswer`. Must never
     receive the definition or the reference (test asserts neither string appears).
   - `GRADE_COVERAGE_PROMPT` — rebuilt answer + the card's definition points → per-point
     `correct | partial | missing`, plus `disputes[]` `{ point, cardSays, answerSays, reason }`
     where the grader judges the answer right and the card wrong.
   - `GRADE_PARITY_PROMPT` — rebuilt answer + the writer's reference → the reference's
     claims, each `present | partial | absent` in the rebuild.
2. **Scores** (`src/lib/klp/rebuild.ts`, pure, tested): `rebuildScores(coverage, parity)` →
   `cardCoverage` (mean of 1 / 0.5 / 0 over definition points), `referenceParity` (same
   over reference claims), `extractionLoss = 1 − referenceParity`. Empty inputs → null,
   never NaN.
3. **Pipeline** (`authoring.ts`): optional generator methods `rebuild`, `gradeCoverage`,
   `gradeParity`. After the revision loop and before `relate`: rebuild from the FINAL key
   points, grade twice, attach `rebuiltAnswer`, `cardCoverage`, `referenceParity`,
   `cardDisputes`, `coverageVerdicts`, `parityVerdicts` to the outcome. A generator without
   the methods produces an outcome without them — nothing existing changes.
   `REBUILD_COVERAGE_BAR` (0.8) is reported on the card and in the run summary; wiring it
   into the revise loop is a follow-up (it would put three calls inside every round).
4. **Persistence**: migration adding `rebuiltAnswer TEXT`, `cardCoverage DOUBLE`,
   `referenceParity DOUBLE`, `cardDisputes JSONB`, `rebuildVerdicts JSONB` to
   `CardAuthoring`, all nullable, no backfill (old rows keep `referenceScore` as history;
   new rows write both while the two coexist). `persistAuthoring` writes them.
5. **Operator wiring** (`author-klps`): `--rotate` → rebuilder = adversary combo, grader
   grades coverage and parity; role split → rebuilder = grader combo (documented
   compromise: no third family configured). Summary prints coverage / parity / disputes and
   flags any dispute loudly. `--json` carries everything.
6. **Rotation rule relaxed** (`rotation.ts`): grader may share the writer's family; must
   differ from the adversary's. Tests updated.
7. **Run** on the three bench cards under `--rotate` (dry-run, `--force`) and record the
   numbers beside the reference scores they carry today. Staff UI display is a follow-up.
