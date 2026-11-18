import { Badge } from '@/components/ui/badge'
import { STATUS_CREDIT, isKlpStatus } from '@/lib/errors/klp-credit'
import { labelForKlpStatus } from '@/lib/errors/labels'

export type DemoVerdictRow = { text: string; status: string; evidence?: string }

// Colour by CREDIT, text by label (same rule as the results page): a status is
// a token from a closed vocabulary, not a display string.
export function DemoVerdicts({ rows }: { rows: DemoVerdictRow[] }) {
  return (
    <ul aria-label="Key points" className="divide-y divide-border rounded-lg border border-border bg-card text-sm">
      {rows.map((r, i) => {
        const status = isKlpStatus(r.status) ? r.status : null
        const credit = status ? STATUS_CREDIT[status] : 0
        return (
          <li key={i} className="space-y-1 px-3 py-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <span>{r.text}</span>
              <Badge variant={credit === 0 ? 'destructive' : credit === 1 ? 'default' : 'secondary'}>
                {status ? labelForKlpStatus(status) : r.status.replace(/_/g, ' ')}
              </Badge>
            </div>
            {r.evidence && <p className="break-words text-xs text-muted-foreground">&ldquo;{r.evidence}&rdquo;</p>}
          </li>
        )
      })}
    </ul>
  )
}
