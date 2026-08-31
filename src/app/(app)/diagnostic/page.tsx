import { redirect } from 'next/navigation'
import { getDiagnosticSetOptions } from '@/actions/diagnostic'
import { DiagnosticClient } from '@/components/diagnostic/DiagnosticClient'

export default async function DiagnosticPage() {
  const result = await getDiagnosticSetOptions()
  if (!result.success) redirect('/login?callbackUrl=%2Fdiagnostic')
  return <DiagnosticClient sets={result.data} />
}
