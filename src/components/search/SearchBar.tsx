"use client"

import * as React from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { Input } from "@/components/ui/input"
import { useTransition } from "react"
import { Search } from "lucide-react"

export function SearchBar() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const query = searchParams.get("q") || ""

  const handleSearch = (term: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (term) {
      params.set("q", term)
    } else {
      params.delete("q")
    }

    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`)
    })
  }

  return (
    <div className="relative w-full max-w-sm">
      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        type="search"
        placeholder="Search sets, terms, definitions..."
        className="pl-9"
        defaultValue={query}
        onChange={(e) => handleSearch(e.target.value)}
        disabled={isPending}
      />
      {isPending && (
        <div className="absolute right-2.5 top-2.5">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}
    </div>
  )
}
