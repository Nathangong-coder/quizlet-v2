import Link from 'next/link'

export function DemoUnavailable() {
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <p className="text-base font-semibold">The demo isn&apos;t available right now.</p>
      <p className="mt-2 text-sm text-muted-foreground">
        <Link href="/browse" className="text-primary underline-offset-4 hover:underline">
          Browse published sets →
        </Link>
      </p>
    </div>
  )
}
