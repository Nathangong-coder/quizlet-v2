'use client'

import { signIn } from 'next-auth/react'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function SignInButton({ className }: { className?: string }) {
  return (
    <Button
      variant="outline"
      className={cn(className)}
      onClick={() => signIn('github', { callbackUrl: '/sets' })}
    >
      Sign In
    </Button>
  )
}
