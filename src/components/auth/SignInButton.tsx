import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function SignInButton({ className }: { className?: string }) {
  return (
    <Link href="/login" className={cn(buttonVariants({ variant: 'outline' }), className)}>
      Sign In
    </Link>
  )
}
