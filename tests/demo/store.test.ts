import { describe, expect, it } from 'vitest'
import {
  DEMO_STORE_KEY, addGuestCard, clearActiveQuestion, createGuestSet, editGuestCard, emptyGuestState,
  loadGuestState, markUsed, saveGuestState, startGuestQuiz, type GuestState,
} from '@/lib/demo/store'

function fakeStorage(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() { return m.size },
  } as Storage
}
const throwing = (): Storage =>
  ({ getItem() { throw new Error('x') }, setItem() { throw new Error('x') } }) as unknown as Storage

function withSet(n = 0): GuestState {
  let s = (createGuestSet(emptyGuestState(), 'T') as { ok: true; state: GuestState }).state
  for (let i = 0; i < n; i++) {
    s = (addGuestCard(s, { term: `t${i}`, definition: `d${i}` }) as { ok: true; state: GuestState }).state
  }
  return s
}

describe('guest store', () => {
  it('refuses a 6th card, a 2nd set and a 2nd quiz', () => {
    expect(addGuestCard(withSet(5), { term: 'a', definition: 'b' })).toEqual({ ok: false, limit: 'cards' })
    expect(createGuestSet(withSet(), 'U')).toEqual({ ok: false, limit: 'sets' })
    const q = startGuestQuiz(emptyGuestState(), { kind: 'demo', cardId: 'c1' })
    expect(q.ok && startGuestQuiz(q.state, { kind: 'demo', cardId: 'c2' })).toEqual({ ok: false, limit: 'quizzes' })
  })
  it('starting a quiz records its question in the same state; clearing it keeps the count', () => {
    expect(emptyGuestState().activeQuestion).toBeNull()
    const q = startGuestQuiz(emptyGuestState(), { kind: 'guest', cardId: 'g1' })
    expect(q.ok && q.state).toMatchObject({ quizzesStarted: 1, activeQuestion: { kind: 'guest', cardId: 'g1' } })
    const cleared = q.ok ? clearActiveQuestion(q.state) : null
    expect(cleared).toMatchObject({ quizzesStarted: 1, activeQuestion: null })
  })
  it('loads a stored state from before activeQuestion existed, with activeQuestion null', () => {
    const st = fakeStorage()
    st.setItem(DEMO_STORE_KEY, JSON.stringify({ set: null, quizzesStarted: 1, used: { grade: true } }))
    expect(loadGuestState(st)).toEqual({ set: null, quizzesStarted: 1, used: { grade: true }, activeQuestion: null })
  })
  it.each([
    ['a wrong kind', { kind: 'other', cardId: 'c1' }],
    ['a missing cardId', { kind: 'demo' }],
    ['a non-string cardId', { kind: 'guest', cardId: 7 }],
    ['an over-long cardId', { kind: 'demo', cardId: 'x'.repeat(200) }],
    ['a non-object', 'demo:c1'],
  ])('sanitises %s to a null activeQuestion and keeps the rest', (_label, activeQuestion) => {
    const st = fakeStorage()
    st.setItem(DEMO_STORE_KEY, JSON.stringify({ set: null, quizzesStarted: 1, used: {}, activeQuestion }))
    expect(loadGuestState(st)).toEqual({ set: null, quizzesStarted: 1, used: {}, activeQuestion: null })
  })
  it('refuses blank terms and definitions', () => {
    expect(addGuestCard(withSet(), { term: ' ', definition: 'b' })).toEqual({ ok: false, invalid: true })
    expect(addGuestCard(withSet(), { term: 'a', definition: '' })).toEqual({ ok: false, invalid: true })
  })
  it('editing a card keeps its points when the text is unchanged and clears them when it changes', () => {
    const points = { cardHash: 'h', points: [], sig: 's' }
    const s = withSet(1)
    s.set!.cards[0].points = points
    const id = s.set!.cards[0].id
    const same = editGuestCard(s, id, { definition: 'd0' })
    expect(same.ok && same.state.set!.cards[0].points).toEqual(points)
    const term = editGuestCard(s, id, { term: 'new' })
    expect(term.ok && term.state.set!.cards[0]).toMatchObject({ term: 'new', definition: 'd0' })
    expect(term.ok && term.state.set!.cards[0].points).toBeUndefined()
    const def = editGuestCard(s, id, { definition: 'other' })
    expect(def.ok && def.state.set!.cards[0].points).toBeUndefined()
  })
  it('survives throwing storage', () => {
    expect(loadGuestState(throwing())).toEqual(emptyGuestState())
    expect(() => saveGuestState(emptyGuestState(), throwing())).not.toThrow()
  })
  it('returns empty on bad JSON or wrong shape', () => {
    const st = fakeStorage()
    st.setItem(DEMO_STORE_KEY, '{nope')
    expect(loadGuestState(st)).toEqual(emptyGuestState())
    st.setItem(DEMO_STORE_KEY, JSON.stringify({ set: { title: 1 }, quizzesStarted: 0, used: {} }))
    expect(loadGuestState(st)).toEqual(emptyGuestState())
  })
  it('round-trips through storage', () => {
    const st = fakeStorage()
    const started = startGuestQuiz(markUsed(withSet(2), 'grade'), { kind: 'demo', cardId: 'c1' })
    if (!started.ok) throw new Error('expected a started quiz')
    const s = started.state
    saveGuestState(s, st)
    expect(loadGuestState(st)).toEqual(s)
  })
})
