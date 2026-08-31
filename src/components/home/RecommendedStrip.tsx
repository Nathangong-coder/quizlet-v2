import Link from 'next/link'
import { Layers } from 'lucide-react'
import { RECOMMEND_EMPTY_COPY, type Recommendation, type RecommendReason } from '@/lib/sets/recommend'

/** Quiet, all-gray set cards modeled on the reference library shelf. */
export function RecommendedStrip({ recommendations, emptyReason }: { recommendations: Recommendation[]; emptyReason: RecommendReason | null }) {
  if (recommendations.length === 0) {
    if (emptyReason === null) return null
    return <p className="py-2 text-sm text-muted-foreground">{RECOMMEND_EMPTY_COPY[emptyReason]}</p>
  }

  return <ul className="-mx-1 flex gap-5 overflow-x-auto px-1 pb-3">{recommendations.map((recommendation) => <li key={recommendation.setId} className="w-64 min-w-64"><Link href={`/sets/${recommendation.setId}`} className="group flex min-h-56 flex-col rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-sm)] transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-muted-foreground/40 hover:shadow-[var(--shadow-md)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Layers className="h-6 w-6" aria-hidden="true" /></div><h3 className="mt-8 line-clamp-3 text-lg font-semibold leading-snug tracking-tight group-hover:text-foreground">{recommendation.title}</h3><p className="mt-auto pt-6 text-sm text-muted-foreground">{recommendation.cardCount} {recommendation.cardCount === 1 ? 'card' : 'cards'} <span aria-hidden="true">·</span> by {recommendation.ownerHandle ?? 'the creator'}</p></Link></li>)}</ul>
}
