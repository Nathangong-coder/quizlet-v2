import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { getDiagnosticSetOptions, getDiagnosticHistory } from '@/actions/diagnostic'
import { DiagnosticClient } from '@/components/diagnostic/DiagnosticClient'

/**
 * Open to everyone as of 2026-09-06.
 *
 * It was gated to admins behind a "coming soon" screen because the feature
 * worked and was WIRED TO NOTHING: `DiagnosticQuestion.learningPoint` was free
 * text with no `CardKlp` behind it, so a completed run moved card confidence
 * and not one number at key-point grain. Someone finished a 12-question run
 * scoring 75 and the engine learned nothing from it.
 *
 * Every question is now anchored to a live `CardKlp`, and a submitted run
 * writes `QuizAnswer` -> `AnswerKlpResult` -> `KlpState` through the same path
 * the quiz uses, so a diagnostic moves the learner model like any other graded
 * mode.
 *
 * See docs/superpowers/specs/2026-09-05-diagnostic-key-point-wiring-design.md.
 */
export default async function DiagnosticPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login?callbackUrl=%2Fdiagnostic')

  const [sets, history] = await Promise.all([
    getDiagnosticSetOptions(),
    getDiagnosticHistory(),
  ])
  if (!sets.success) redirect('/login?callbackUrl=%2Fdiagnostic')

  // A failed history read must not block starting a new diagnostic — it is a
  // convenience list, not a precondition.
  return <DiagnosticClient sets={sets.data} history={history.success ? history.data : []} />
}
