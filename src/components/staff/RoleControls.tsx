'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { grantRole, revokeRole, searchUsers } from '@/actions/staff-roles'
import { USER_ROLES } from '@/lib/auth/roles'

export function RoleControls({ selfId }: { selfId: string }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<{ id: string; label: string; role: string }[]>([])
  const [pending, start] = useTransition()

  function find() {
    start(async () => {
      const res = await searchUsers({ q })
      if (!res.success) {
        toast.error(res.error)
        return
      }
      setResults(res.data)
      if (res.data.length === 0) toast.message('No match.')
    })
  }

  function assign(userId: string, role: string) {
    start(async () => {
      const res = await grantRole({ userId, role })
      toast[res.success ? 'success' : 'error'](res.success ? `Now a ${role}.` : res.error)
    })
  }

  function drop(userId: string) {
    start(async () => {
      const res = await revokeRole({ userId })
      toast[res.success ? 'success' : 'error'](res.success ? 'Revoked.' : res.error)
    })
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find by handle, name or email"
          className="flex-1 rounded-md border px-2 py-1.5 text-sm"
        />
        <button onClick={find} disabled={pending} className="rounded-md border px-3 py-1.5 text-sm">
          Search
        </button>
      </div>

      <ul className="divide-y">
        {results.map((u) => (
          <li key={u.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span>
              {u.label} <span className="font-mono text-xs text-muted-foreground">{u.role}</span>
            </span>
            <span className="flex gap-1">
              {USER_ROLES.filter((r) => r !== u.role).map((r) => (
                <button
                  key={r}
                  onClick={() => (r === 'learner' ? drop(u.id) : assign(u.id, r))}
                  disabled={pending || (u.id === selfId)}
                  title={u.id === selfId ? 'You cannot change your own role here' : undefined}
                  className="rounded border px-2 py-1 text-xs disabled:opacity-40"
                >
                  {r === 'learner' ? 'revoke' : r}
                </button>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
