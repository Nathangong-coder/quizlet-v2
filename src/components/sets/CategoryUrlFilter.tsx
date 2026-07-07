'use client'

import React from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { CategoryFilterBar } from './CategoryFilterBar'

export function CategoryUrlFilter({
  categories,
}: {
  categories: { id: string; name: string; color?: string | null }[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const value = params.get('cat')?.split(',').filter(Boolean) ?? []

  const onChange = (ids: string[]) => {
    const qs = new URLSearchParams(Array.from(params.entries()))
    if (ids.length) qs.set('cat', ids.join(','))
    else qs.delete('cat')
    router.push(`${pathname}?${qs.toString()}`)
  }

  return <CategoryFilterBar categories={categories} value={value} onChange={onChange} />
}
