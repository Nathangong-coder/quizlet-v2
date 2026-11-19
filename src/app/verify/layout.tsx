import { AuthFrame } from '@/components/auth/AuthFrame'

/** Account pages get a header with a way back home — see AuthFrame. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <AuthFrame>{children}</AuthFrame>
}
