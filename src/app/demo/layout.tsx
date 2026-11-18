import { DemoShell } from '@/components/demo/DemoShell'

// Deliberately outside src/middleware.ts's matcher and the (app)/(marketing)
// groups: a visitor reaches /demo signed out.
export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return <DemoShell>{children}</DemoShell>
}
