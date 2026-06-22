// src/components/Navbar.tsx
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export default function Navbar() {
  return (
    <nav className="border-b bg-background">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/sets" className="font-bold text-lg tracking-tight">
          Quizlet v2
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/sets" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
            My Sets
          </Link>
          <Link href="/sets/new" className={cn(buttonVariants({ size: 'sm' }))}>
            + New Set
          </Link>
        </div>
      </div>
    </nav>
  )
}
