import { redirect } from 'next/navigation';

// The printable test now lives at /sets/[id]/print (it accepts an optional
// ?attemptId= or setup params). Keep this legacy path working by redirecting.
export default async function QuizPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === 'string') qs.set(k, v);
  }
  const suffix = qs.toString();
  redirect(`/sets/${id}/print${suffix ? `?${suffix}` : ''}`);
}
