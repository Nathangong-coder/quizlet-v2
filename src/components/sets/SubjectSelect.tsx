'use client'

import { SUBJECTS } from '@/lib/subjects/taxonomy'

/**
 * The subject picker: one native `<select>` with an optgroup per top-level
 * subject. Native on purpose — 47 options across nine groups is exactly what
 * a select with optgroups is for, it is keyboard-complete for free, and a
 * custom combobox would be the third dropdown implementation in this form.
 *
 * `''` is "no subject"; the caller stores it as null.
 */
export function SubjectSelect({
  id = 'subject',
  value,
  onChange,
  className,
}: {
  id?: string
  value: string
  onChange: (slug: string) => void
  className?: string
}) {
  return (
    <select
      id={id}
      name="subject"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={
        className ??
        'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50'
      }
    >
      <option value="">No subject</option>
      {SUBJECTS.map((g) => (
        <optgroup key={g.slug} label={g.label}>
          {g.leaves.map((l) => (
            <option key={l.slug} value={l.slug}>
              {l.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}
