// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AuthFrame } from '@/components/auth/AuthFrame'

afterEach(cleanup)

describe('AuthFrame', () => {
  it('gives the account pages a way back to the homepage', () => {
    render(<AuthFrame><p>form</p></AuthFrame>)
    expect(screen.getByRole('link', { name: /synapsehq home/i })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: /back to home/i })).toHaveAttribute('href', '/')
    expect(screen.getByText('form')).toBeInTheDocument()
  })

  // Each account route is its own top-level directory, so the frame comes
  // from a layout in each. A new account route without one has no way home.
  it.each(['login', 'signup', 'forgot', 'reset', 'verify'])('src/app/%s/layout.tsx wraps the page in AuthFrame', (dir) => {
    const source = readFileSync(join(process.cwd(), 'src/app', dir, 'layout.tsx'), 'utf8')
    expect(source).toMatch(/<AuthFrame>\{children\}<\/AuthFrame>/)
  })
})
