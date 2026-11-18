'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { inviteFromWaitlist } from '@/actions/waitlist'

export interface WaitlistTableRow {
  id: string
  email: string
  note: string | null
  requestedAt: string
  lastRequestedAt: string
  invitedAt: string | null
  inviteCode: string | null
}

export function WaitlistTable({ rows }: { rows: WaitlistTableRow[] }) {
  const [pending, start] = useTransition()
  // Codes minted in this page view. Kept here, not derived from `rows`, because the
  // refreshed Pending list no longer contains an invited row.
  const [minted, setMinted] = useState<Record<string, { email: string; code: string; emailed: boolean }>>({})

  function invite(id: string, email: string) {
    start(async () => {
      const res = await inviteFromWaitlist(id)
      if (!res.success) {
        toast.error(res.error)
        return
      }
      setMinted((m) => ({ ...m, [id]: { email, ...res.data } }))
      toast.success(res.data.emailed ? 'Invite emailed.' : 'Invite created. Copy the code and send it.')
    })
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code)
      toast.success('Copied.')
    } catch {
      toast.error('Could not copy. Select the code and copy it by hand.')
    }
  }

  const justInvited = Object.entries(minted)
  const panel =
    justInvited.length > 0 ? (
      <section aria-label="Just invited" className="space-y-2 rounded-lg border p-3 text-sm">
        <h2 className="font-medium">Just invited</h2>
        <ul className="space-y-1">
          {justInvited.map(([id, m]) => (
            <li key={id} className="flex flex-wrap items-center gap-2">
              <span>{m.email}</span>
              <code className="font-mono">{m.code}</code>
              <button type="button" onClick={() => copy(m.code)} className="rounded-md border px-2 py-1 text-xs">
                Copy
              </button>
              <span className="text-xs text-muted-foreground">{m.emailed ? 'emailed' : 'not emailed'}</span>
            </li>
          ))}
        </ul>
      </section>
    ) : null

  if (rows.length === 0) {
    return <div className="space-y-4">{panel}<p className="rounded-lg border p-3 text-sm text-muted-foreground">Nobody here.</p></div>
  }

  return (
    <div className="space-y-4">
    {panel}
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="p-3 font-medium">Email</th>
            <th className="p-3 font-medium">Note</th>
            <th className="p-3 font-medium">Requested</th>
            <th className="p-3 font-medium">Last requested</th>
            <th className="p-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => {
            const fresh = minted[r.id]
            return (
              <tr key={r.id}>
                <td className="p-3">{r.email}</td>
                <td className="p-3 text-muted-foreground">{r.note ?? ''}</td>
                <td className="p-3 tabular-nums">{r.requestedAt}</td>
                <td className="p-3 tabular-nums">{r.lastRequestedAt}</td>
                <td className="p-3">
                  {fresh ? (
                    <span className="text-muted-foreground">Invited just now</span>
                  ) : r.invitedAt ? (
                    <span className="text-muted-foreground">
                      Invited {r.invitedAt}
                      {r.inviteCode && <code className="ml-2 font-mono text-xs">{r.inviteCode}</code>}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => invite(r.id, r.email)}
                      disabled={pending}
                      className="rounded-md border px-3 py-1 text-xs"
                    >
                      Invite
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
    </div>
  )
}
