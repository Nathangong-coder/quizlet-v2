/**
 * What is coming, stated plainly.
 *
 * NOT A DIMMED FAKE CHART, and that is the whole design of this component. A
 * greyed-out rendering of invented bands is indistinguishable from real data at
 * a glance — a learner who screenshots it, or who simply glances at it while
 * tired, takes away a number nobody computed. This codebase's standing rule is
 * that degradation never fabricates: a fake row is indistinguishable from a
 * real one and would promote fictional findings.
 *
 * So this says what will appear and what it needs, on the same hatched ground
 * `mastery-shade` uses for `unknown` — the visual language for "not measured"
 * is already established, and reusing it means a reader who has learned it once
 * reads this correctly without being told.
 */
export function InProgressBlock({
  title,
  children,
  needs,
}: {
  title: string
  children: React.ReactNode
  /** The concrete precondition. Vague "coming soon" teaches nobody anything. */
  needs?: string
}) {
  return (
    <div className="rounded-lg border border-dashed border-muted-foreground/40 p-5">
      <div className="flex items-baseline gap-3">
        <h3 className="font-heading text-lg tracking-tight">{title}</h3>
        <span className="label rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">
          In progress
        </span>
      </div>
      <div className="text-sm text-muted-foreground mt-2 space-y-2 max-w-prose">{children}</div>
      {needs && (
        <p className="text-sm text-muted-foreground mt-3">
          <span className="font-medium text-foreground">Needs:</span> {needs}
        </p>
      )}
    </div>
  )
}
