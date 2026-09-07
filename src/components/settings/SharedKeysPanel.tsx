import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { loadBorrowableCredentials, loadSpendByCredential } from '@/lib/ai/shared-budget'
import { PROVIDER_META, type ProviderId } from '@/lib/ai/providers'

/**
 * What this learner can use WITHOUT their own API key, and how much of it is
 * left.
 *
 * Two things belong on one panel because they answer one question: "can I keep
 * studying, and for how long?" Splitting the allowance from the usage would let
 * someone read either half and draw the wrong conclusion.
 *
 * A server component: it reads credentials and the call log directly, and both
 * are already owner-scoped by the queries. Nothing here exposes a key, a hint,
 * or its owner's identity — a borrower needs to know a key exists and what it
 * costs them, not whose it is.
 */
export default async function SharedKeysPanel() {
  const session = await auth()
  if (!session?.user?.id) return null
  const userId = session.user.id

  const [borrowable, own, spend] = await Promise.all([
    loadBorrowableCredentials(prisma, userId),
    prisma.aiCredential.findMany({
      where: { userId },
      select: { id: true, label: true, provider: true, enabled: true },
    }),
    loadSpendByCredential(prisma, userId),
  ])

  const ownTokens = own.reduce((sum, c) => sum + (spend.get(c.id) ?? 0), 0)
  const hasOwnKey = own.some((c) => c.enabled)

  return (
    <section className="space-y-4 rounded-lg border border-border p-5">
      <div>
        <h2 className="font-semibold">Included access</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Keys shared with everyone on this install, so you can study without setting one up. Your
          own keys are always tried first — these are the fallback, and they have a limit.
        </p>
      </div>

      {borrowable.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          No shared keys are available right now. Add your own above to use AI features.
        </p>
      ) : (
        <ul className="space-y-3">
          {borrowable.map((c) => {
            const pct =
              c.budget === null ? 0 : Math.min(100, Math.round((c.used / c.budget) * 100))
            return (
              <li key={c.credentialId} className="space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">
                    {PROVIDER_META[c.provider as ProviderId]?.label ?? c.provider}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {c.budget === null
                      ? `${c.used.toLocaleString()} tokens used`
                      : `${c.used.toLocaleString()} / ${c.budget.toLocaleString()} tokens`}
                  </span>
                </div>
                {c.budget !== null && (
                  <div
                    className="h-1.5 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Included ${c.provider} allowance used`}
                  >
                    <div
                      className={`h-full rounded-full ${c.exhausted ? 'bg-destructive' : 'bg-primary'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
                {c.exhausted ? (
                  <p className="text-xs leading-5 text-destructive">
                    Allowance used up. AI features need your own key from here — add one above.
                    Nothing you have already studied is affected.
                  </p>
                ) : (
                  c.remaining !== null && (
                    <p className="text-xs text-muted-foreground">
                      {c.remaining.toLocaleString()} tokens left
                      {!hasOwnKey && ' · add your own key to stop using this allowance'}
                    </p>
                  )
                )}
              </li>
            )
          })}
        </ul>
      )}

      {own.length > 0 && (
        <div className="border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">
            {/*
              Shown separately and WITHOUT a limit bar, because there is none:
              a user's own key is metered by their provider, not by this app.
              Putting it under the same progress bar would imply we cap it.
            */}
            On your own keys you have used{' '}
            <span className="font-mono tabular-nums">{ownTokens.toLocaleString()}</span> tokens.
            Your own keys are not limited here — your provider bills them directly.
          </p>
        </div>
      )}
    </section>
  )
}
