import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Match is a GAME and writes no study memory (owner's decision, 2026-09-13;
 * it had recorded a StudySession + StudyEvents since Stage 1). A source scan
 * is the guard: the moment the component or the page imports any server
 * action other than the leaderboard's `submitGameScore` — the one write a
 * game makes, and not memory — or the old action file comes back, this fails.
 */
const FILES = ['src/components/game/MatchGame.tsx', 'src/components/game/MatchBoard.tsx', 'src/app/sets/[id]/match/page.tsx']

describe('Match writes nothing', () => {
  it.each(FILES)('%s imports no server action beyond the leaderboard, and no memory writer', (file) => {
    const src = readFileSync(join(process.cwd(), file), 'utf8')
    const imports = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@\/actions\/([^'"]+)['"]/g)]
    for (const m of imports) {
      expect(m[2], file).toBe('games')
      expect(m[1].split(',').map((n) => n.trim()).filter(Boolean), file).toEqual(['submitGameScore'])
    }
    expect(src).not.toMatch(/recordStudyEvent|startStudySession|submitMatchSession|finishStudySession/)
  })

  it('the old match-session action is gone', () => {
    expect(existsSync(join(process.cwd(), 'src/actions/match-session.ts'))).toBe(false)
  })

  it('/match is no longer behind the sign-in middleware — nothing to protect', () => {
    const mw = readFileSync(join(process.cwd(), 'src/middleware.ts'), 'utf8')
    expect(mw).not.toContain('/match')
  })
})
