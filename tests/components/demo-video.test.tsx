// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

afterEach(cleanup)

import { DEMO_CHAPTERS, chapterAt, isDemoLinkEnabled } from '@/lib/marketing/demo-video'
import { DemoVideo } from '@/components/marketing/DemoVideo'

describe('DEMO_CHAPTERS', () => {
  it('has the eight chapters in order', () => {
    expect(DEMO_CHAPTERS.map((c) => [c.start, c.title, c.tryHref])).toEqual([
      [0, 'Built for finance interview prep', '/demo'],
      [9, '82 M&A questions, tagged', '/demo/set'],
      [16, 'Build a written test', '/demo/quiz'],
      [21, 'Write the answer in your own words', '/demo/quiz'],
      [29, 'Graded point by point', '/demo/quiz'],
      [37, 'Scored on clarity, concision and correctness', '/demo/quiz'],
      [46, 'Confidence from 1 to 10', '/demo/review'],
      [50, 'Games built from your set', '/demo/games'],
    ])
  })
})

describe('chapterAt', () => {
  it('finds the active chapter', () => {
    expect(chapterAt(0)).toBe(0)
    expect(chapterAt(8.9)).toBe(0)
    expect(chapterAt(9)).toBe(1)
    expect(chapterAt(59)).toBe(7)
  })
})

describe('isDemoLinkEnabled', () => {
  const full = { DEMO_ENABLED: 'true', DEMO_SET_ID: 's', DEMO_AI_USER_ID: 'u', AUTH_SECRET: 'x' }
  it('is true only with the switch exactly "true" and the demo fully configured', () => {
    expect(isDemoLinkEnabled(full)).toBe(true)
    expect(isDemoLinkEnabled({ ...full, DEMO_ENABLED: '1' })).toBe(false)
    expect(isDemoLinkEnabled({ ...full, DEMO_SET_ID: undefined })).toBe(false)
    expect(isDemoLinkEnabled({ ...full, DEMO_AI_USER_ID: undefined })).toBe(false)
    expect(isDemoLinkEnabled({ ...full, AUTH_SECRET: undefined })).toBe(false)
    expect(isDemoLinkEnabled({})).toBe(false)
  })
})

describe('DemoVideo', () => {
  const play = vi.fn()
  const pause = vi.fn()
  HTMLMediaElement.prototype.play = play as never
  HTMLMediaElement.prototype.pause = pause as never

  it('renders a click-to-play video with metadata preload only', () => {
    const { container } = render(<DemoVideo linksEnabled={false} />)
    const v = container.querySelector('video')!
    expect(v.getAttribute('src')).toBe('/demo/synapseHQ_demo.mp4')
    expect(v.getAttribute('poster')).toBe('/demo/poster.jpg')
    expect(v.getAttribute('preload')).toBe('metadata')
    expect(v.hasAttribute('autoplay')).toBe(false)
  })

  it('seeks and plays when a chapter is clicked', () => {
    const { container } = render(<DemoVideo linksEnabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: /Graded point by point/ }))
    const v = container.querySelector('video')!
    expect(v.currentTime).toBe(29)
    expect(play).toHaveBeenCalled()
  })

  it('swallows a refused play() (autoplay policy, no media) instead of an unhandled rejection', async () => {
    const rejected = Promise.reject(new DOMException('blocked', 'NotAllowedError'))
    const caught = vi.spyOn(rejected, 'catch')
    play.mockReturnValueOnce(rejected)
    render(<DemoVideo linksEnabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: /Graded point by point/ }))
    expect(caught).toHaveBeenCalled()
    await rejected.catch(() => {})
  })

  it('marks the active chapter from timeupdate', () => {
    const { container } = render(<DemoVideo linksEnabled={false} />)
    const v = container.querySelector('video')!
    v.currentTime = 40
    fireEvent.timeUpdate(v)
    const row = screen.getByRole('button', { name: /Scored on clarity/ }).closest('li')!
    expect(row.getAttribute('aria-current')).toBe('true')
  })

  it('hides Try it links unless enabled, and links Games to /demo/games when enabled', () => {
    render(<DemoVideo linksEnabled={false} />)
    expect(screen.queryAllByRole('link', { name: /Try/ })).toHaveLength(0)
    cleanup()
    render(<DemoVideo linksEnabled />)
    const links = screen.getAllByRole('link', { name: /Try it/ })
    expect(links.map((l) => l.getAttribute('href'))).toContain('/demo/games')
  })

  it('pauses the video when a Try it link is followed', () => {
    render(<DemoVideo linksEnabled />)
    pause.mockClear()
    fireEvent.click(screen.getAllByRole('link', { name: /Try it/ })[0])
    expect(pause).toHaveBeenCalled()
  })
})
