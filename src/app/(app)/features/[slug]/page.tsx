import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { FEATURE_SLUGS, getFeature } from '@/lib/marketing/features'
import { FeaturePage } from '@/components/marketing/FeaturePage'

/**
 * `/features/<slug>` — one static page per advertised feature.
 *
 * Statically generated over the registry: there is no data behind these pages
 * and no reason to render them per request. An unknown slug is a 404, never a
 * fallback page, so a mistyped link from a share card cannot render an empty
 * feature.
 */
export const dynamicParams = false

export async function generateStaticParams() {
  return FEATURE_SLUGS.map((slug) => ({ slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const feature = getFeature((await params).slug)
  if (!feature) return {}
  return { title: `${feature.label} · synapseHQ`, description: feature.claim }
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const feature = getFeature((await params).slug)
  if (!feature) notFound()
  return <FeaturePage feature={feature} />
}
