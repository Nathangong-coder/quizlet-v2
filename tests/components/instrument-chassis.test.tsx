// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Section, SectionHeader, SectionBody } from '@/components/ui/section'
import { Metric } from '@/components/ui/metric'

describe('Section', () => {
  it('renders a titled, ruled section with its body', () => {
    render(
      <Section>
        <SectionHeader title="Jump back in" hint="3 sets" />
        <SectionBody>content</SectionBody>
      </Section>,
    )
    expect(screen.getByRole('heading', { name: 'Jump back in' })).toBeInTheDocument()
    expect(screen.getByText('3 sets')).toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('renders an action slot when given one', () => {
    // An absolute href, not `/sets`: an internal path in a bare <a> trips
    // @next/next/no-html-link-for-pages, and this task must not add to the
    // repo's 175 existing lint problems. Real callers pass a <Link>.
    render(
      <Section>
        <SectionHeader
          title="Your sets"
          action={<a href="https://example.com/sets">See all</a>}
        />
        <SectionBody>x</SectionBody>
      </Section>,
    )
    expect(screen.getByRole('link', { name: 'See all' })).toBeInTheDocument()
  })
})

describe('Metric', () => {
  it('renders a value with its unit and label', () => {
    render(<Metric value={12} unit="cards" label="Due" />)
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('cards')).toBeInTheDocument()
    expect(screen.getByText('Due')).toBeInTheDocument()
  })

  it('renders an em dash for null, NEVER a zero', () => {
    // Null-is-not-zero, the rule `SetStudySummary.averageConfidence` and
    // `LearnerTopicProfile.knowledge` already follow: 0 reads as "you know
    // none of this" on a set nobody has opened, which is a different and
    // false claim from "no evidence yet".
    render(<Metric value={null} label="Confidence" />)
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('uses an overridable empty label', () => {
    render(<Metric value={null} label="Confidence" emptyLabel="not studied" />)
    expect(screen.getByText('not studied')).toBeInTheDocument()
  })

  it('carries tabular figures so columns do not reflow', () => {
    const { container } = render(<Metric value={1234} label="Cards" />)
    expect(container.querySelector('.metric')).not.toBeNull()
  })
})
