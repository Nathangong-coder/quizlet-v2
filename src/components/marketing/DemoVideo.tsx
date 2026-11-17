'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { DEMO_CHAPTERS, chapterAt } from '@/lib/marketing/demo-video'

/**
 * The landing page's demo video with a clickable chapter list. Plays on
 * click only (no autoplay), preloads metadata only. The chapters are also a
 * WebVTT track and a hidden text list for screen readers.
 */
export function DemoVideo({ linksEnabled }: { linksEnabled: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [active, setActive] = useState(0)

  function seek(start: number) {
    const v = ref.current
    if (!v) return
    v.currentTime = start
    setActive(chapterAt(start))
    void v.play()
  }

  return (
    <section className="mx-auto mt-12 max-w-6xl" aria-label="Product demo video">
      <div className="grid gap-4 md:grid-cols-3 md:items-start">
        <div className="md:col-span-2">
          <video
            ref={ref}
            src="/demo/synapseHQ_demo.mp4"
            poster="/demo/poster.jpg"
            preload="metadata"
            controls
            playsInline
            className="aspect-video w-full rounded-2xl bg-black"
            onTimeUpdate={(e) => setActive(chapterAt(e.currentTarget.currentTime))}
          >
            <track kind="chapters" src="/demo/chapters.vtt" srcLang="en" label="Chapters" default />
          </video>
          {linksEnabled && (
            <p className="mt-3 text-sm">
              <Link href="/demo" className="text-primary underline-offset-4 hover:underline">
                Try the demo
              </Link>
            </p>
          )}
        </div>
        <ol className="flex flex-col gap-1">
          {DEMO_CHAPTERS.map((c, i) => (
            <li
              key={c.start}
              aria-current={i === active ? 'true' : undefined}
              className={cn('rounded-xl px-3 py-2 text-left', i === active ? 'bg-accent' : 'hover:bg-accent/50')}
            >
              <button type="button" onClick={() => seek(c.start)} className="block w-full text-left">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {Math.floor(c.start / 60)}:{String(c.start % 60).padStart(2, '0')}
                </span>
                <span className="block text-sm font-semibold">{c.title}</span>
                <span className="block text-xs text-muted-foreground">{c.caption}</span>
              </button>
              {linksEnabled && c.tryHref && (
                <Link
                  href={c.tryHref}
                  onClick={() => ref.current?.pause()}
                  className="mt-1 inline-block text-xs font-semibold text-primary underline-offset-4 hover:underline"
                >
                  Try it →
                </Link>
              )}
            </li>
          ))}
        </ol>
      </div>
      <ol className="sr-only" aria-label="Video chapters, as text">
        {DEMO_CHAPTERS.map((c) => (
          <li key={c.start}>{c.title}. {c.caption}</li>
        ))}
      </ol>
    </section>
  )
}
