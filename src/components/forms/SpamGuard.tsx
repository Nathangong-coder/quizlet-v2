'use client'

import { useEffect, useRef, useState } from 'react'
import { HONEYPOT_FIELD, type SpamSignals } from '@/lib/forms/spam'

/**
 * The client half of `src/lib/forms/spam.ts`: renders the honeypot and
 * remembers when the form appeared. `useSpamSignals()` returns the signals
 * to send with the submission and the field to render inside the form.
 *
 * The honeypot is hidden from PEOPLE (off-screen, not display:none — some
 * fillers skip display:none fields) and from assistive tech (`aria-hidden`,
 * `tabIndex=-1`), and carries `autoComplete="off"` so a browser never fills
 * it for a real user.
 */
export function useSpamSignals(): { signals: () => SpamSignals; field: React.ReactNode } {
  // Stamped once on mount (an effect, so the clock read is not in render).
  // Before mount it is 0, and `checkSpam` treats a missing clock as "no
  // signal" rather than "too fast".
  const renderedAt = useRef<number>(0)
  useEffect(() => {
    if (renderedAt.current === 0) renderedAt.current = Date.now()
  }, [])
  const [honeypot, setHoneypot] = useState('')

  const field = (
    <div aria-hidden="true" className="absolute -left-[9999px] top-0 h-px w-px overflow-hidden" style={{ position: 'absolute' }}>
      <label htmlFor={`${HONEYPOT_FIELD}-hp`}>Website</label>
      <input
        id={`${HONEYPOT_FIELD}-hp`}
        name={HONEYPOT_FIELD}
        type="text"
        tabIndex={-1}
        autoComplete="off"
        value={honeypot}
        onChange={(e) => setHoneypot(e.target.value)}
      />
    </div>
  )

  return {
    signals: () => ({ honeypot, renderedAt: renderedAt.current || undefined }),
    field,
  }
}
