import type { ComponentType } from 'react'
import {
  Layers,
  BookOpenCheck,
  ScrollText,
  NotebookPen,
  GraduationCap,
  RotateCcw,
  Gamepad2,
} from 'lucide-react'
import type { MockId } from '@/components/marketing/mock-ids'

/**
 * The seven features the signed-out surfaces advertise, in the order the owner
 * gave. One registry feeds the landing showcase tabs, `/features`, and every
 * `/features/<slug>` page, so the three can never disagree about what exists.
 *
 * PUBLIC-FACING COPY, and the rules the landing page already follows apply to
 * every string here: WHAT the app does, never HOW (no pipeline, no scoring
 * model, no vocabularies, no model names); nothing unbuilt presented as live
 * (`status: 'coming'` renders a badge wherever the feature is shown); and
 * nothing about voice, which is a later stage.
 *
 * Mocks are referenced by id so this file stays plain data — a test resolves
 * every id against the drawn panels, and the panels themselves live in
 * `src/components/marketing/mocks.tsx`.
 */

export type FeatureStatus = 'live' | 'coming'

export interface FeatureBenefit {
  title: string
  body: string
}

export interface FeatureSection {
  title: string
  body: string
  mock: MockId
  /** An in-app place that shows the thing, when one exists without an account. */
  link?: { href: string; label: string }
}

export interface Feature {
  slug: string
  label: string
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  status: FeatureStatus
  /** Overrides the status badge text (Games: partly live). */
  badge?: string
  /** The headline. Also the showcase tab's claim. */
  claim: string
  /** The lede under it. Also the showcase tab's body. */
  body: string
  benefits: [FeatureBenefit, FeatureBenefit, FeatureBenefit]
  heroMock: MockId
  sections: FeatureSection[]
}

export const FEATURES: readonly Feature[] = [
  {
    slug: 'flashcards',
    label: 'Flashcards',
    icon: Layers,
    status: 'live',
    claim: 'Cards that hold more than two lines of text.',
    body: 'Build a set by hand, paste a term|definition list, or copy a published one. Each side can carry images, files and formatting, and every card can wear the coloured categories you define for the set.',
    benefits: [
      { title: 'Import in one paste', body: 'Term and definition separated by a pipe, cards by a semicolon. Commas, dollar signs and quotes inside a definition survive intact.' },
      { title: 'Rich sides', body: 'Images, files and formatted text on either side of a card — not only a line of text.' },
      { title: 'Your own categories', body: 'Tag cards with coloured labels of your own — talking, accounting, vocabulary — and every study mode can filter on them.' },
    ],
    heroMock: 'carousel',
    sections: [
      {
        title: 'Flip through, then drill down',
        body: 'A carousel above the list shows one card at a time; click to flip it. Below, the full list with its categories, stars and the confidence you have earned on each card.',
        mock: 'terms-list',
      },
      {
        title: 'Copy a published set and make it yours',
        body: 'Find a set someone has published, copy it, and study it as your own. The copy is private, your progress on it is yours, and the original author stays credited.',
        mock: 'fork',
        link: { href: '/browse', label: 'Browse published sets' },
      },
      {
        title: 'Each card knows what it teaches',
        body: 'Open any card to see its key points — the handful of ideas a good answer has to contain, with the ones that matter most marked. This is what every mode grades against.',
        mock: 'key-points',
      },
    ],
  },
  {
    slug: 'learn',
    label: 'Learn',
    icon: BookOpenCheck,
    status: 'coming',
    claim: 'A lesson written for the gap you actually have.',
    body: 'Learn starts from what your memory says you are missing. It explains that idea, works an example, then checks you on it with cards it writes for the purpose — and keeps going until the check comes back clean.',
    benefits: [
      { title: 'Personalised lessons', body: 'An explanation and a worked example for the exact idea you missed, not the chapter it lives in.' },
      { title: 'New cards, written for you', body: 'Every lesson ends with cards that did not exist before, aimed at the gap it just taught.' },
      { title: 'Iterative testing', body: 'Answer, get read point by point, learn again from what is still missing. The loop ends when the evidence says so, not after a fixed number of rounds.' },
    ],
    heroMock: 'lesson',
    sections: [
      {
        title: 'It starts from the evidence',
        body: 'Learn does not ask what you want to study. It reads what keeps going wrong — the pair of ideas you confuse, the topic that fades fastest — and writes the lesson for that.',
        mock: 'insights',
      },
      {
        title: 'Teach, check, teach again',
        body: 'Each round is a short explanation, a worked example, and a check in your own words. What you still miss becomes the next round; what you have shown you know drops out.',
        mock: 'lesson-loop',
      },
      {
        title: 'Memory that only moves when you earn it',
        body: 'A lesson you passed changes what the app believes about that idea, just as a quiz would — and a check you failed does not get rounded up to knowing.',
        mock: 'memory',
      },
    ],
  },
  {
    slug: 'study-guides',
    label: 'Study guides',
    icon: ScrollText,
    status: 'coming',
    claim: 'The whole subject on one page, with your weak spots marked.',
    body: 'A guide is built from the set itself: the concepts in the order they depend on each other, the key points under each one, and shading that shows where you are solid and where you are not.',
    benefits: [
      { title: 'Concepts in order', body: 'Not the order the cards were typed in — the order the ideas depend on each other, so the guide reads front to back.' },
      { title: 'Key points, not paragraphs', body: 'Each concept lists the ideas a good answer has to contain, with the ones that matter most marked.' },
      { title: 'Printable', body: 'A guide is a page. Print it, take it on paper, mark it up.' },
    ],
    heroMock: 'guide',
    sections: [
      {
        title: 'Mastery by topic, not by card',
        body: 'The guide is shaded by what you have shown you know, so the dark patch is a concept — "non-cash adjustments" — not card 37.',
        mock: 'concept-tree',
      },
      {
        title: 'Every card, reduced to what it teaches',
        body: 'Under each concept, the key points of the cards that belong to it. A long definition becomes four or five ideas you can check off.',
        mock: 'key-points',
      },
      {
        title: 'Take it to paper',
        body: 'The print view drops the shading if you want a clean copy, or keeps it so the weak spots are marked on the page in front of you.',
        mock: 'guide-print',
      },
    ],
  },
  {
    slug: 'postmortems',
    label: 'Postmortems',
    icon: NotebookPen,
    status: 'live',
    claim: 'What happened in the room becomes part of your record.',
    body: 'After a paper test, a mock interview or the real thing, write down what came up, what went well and what did not. Link it to a set and the gaps become things you can study, not things you remember badly a week later.',
    benefits: [
      { title: 'Six formats', body: 'Paper test, mock interview, real interview, case study, technical test, or anything else — each with the fields that matter for it.' },
      { title: 'Gaps you can act on', body: 'The gaps you write down sit beside the set they came from, so the next session can start there.' },
      { title: 'Folders keep it together', body: 'Sets, notes and postmortems for one goal live in one preparation folder, so the trail for an interview is in one place.' },
    ],
    heroMock: 'postmortem',
    sections: [
      {
        title: 'Ten minutes after, while it is fresh',
        body: 'What came up, what went well, what did not, what to do next — and how you felt walking out. Short fields, written once, kept forever.',
        mock: 'postmortem',
      },
      {
        title: 'A trail your future self can read',
        body: 'Every postmortem is dated and linked to its set. Before the next interview, read the last three and see what keeps coming up.',
        mock: 'postmortem-trail',
      },
      {
        title: 'Notes beside it',
        body: 'Keep your own notes in the same folder, with a summary drawn from them when you want one and your original text kept untouched underneath.',
        mock: 'note',
      },
    ],
  },
  {
    slug: 'test',
    label: 'Test',
    icon: GraduationCap,
    status: 'live',
    claim: 'Write the answer. Get told exactly which idea you missed.',
    body: 'Multiple choice, true/false, matching and written answers, from any subset of a set. A written answer is read against the card’s key points and comes back with the sentence that earned or lost each one — not a bare score.',
    benefits: [
      { title: 'Questions formatted your way', body: 'Multiple choice, true/false, matching, written — and which side of the card is asked: term, definition, or mixed.' },
      { title: 'Focus filters', body: 'Starred cards only. Cards you got wrong last time. One category. A test of exactly the part you are worried about.' },
      { title: 'Print it', body: 'A print-ready test with an answer key you can show or hide, and PDF export straight from the browser.' },
    ],
    heroMock: 'quiz-setup',
    sections: [
      {
        title: 'Read point by point',
        body: 'Your written answer is checked against each idea the card teaches. You see which you had, which you half had, and which was missing — with the words that decided it.',
        mock: 'short-answer',
      },
      {
        title: 'Wrong options that tell you something',
        body: 'Every wrong choice is wrong in a particular way — a sign flipped, a condition swapped, two ideas run together. Picking it tells you what you confused, not only that you were wrong.',
        mock: 'distractors',
      },
      {
        title: 'Start with a diagnostic',
        body: 'A short written diagnostic across a subject seeds your memory on day one, so your first real session already targets the gaps instead of walking you through what you know.',
        mock: 'diagnostic',
      },
    ],
  },
  {
    slug: 'review',
    label: 'Review',
    icon: RotateCcw,
    status: 'live',
    claim: 'Know it or don’t — and the deck remembers which.',
    body: 'Flip each card and say whether you knew it. What you did not know comes back until you do; what you were already confident about gets one more look and then retires for the session.',
    benefits: [
      { title: 'Confidence from 1 to 10', body: 'Every answer moves your confidence on that card by one step, and the number is yours to see on every card, in every mode.' },
      { title: 'Star the important ones', body: 'Star a card you keep missing and pull only the starred ones into a review or a test.' },
      { title: 'Filter by category', body: 'Review one category at a time — talking points before an interview, vocabulary before a test.' },
    ],
    heroMock: 'review-card',
    sections: [
      {
        title: 'The deck adapts as you go',
        body: 'A card you did not know goes to the back of the deck. A card you already knew well gets at most one more look. You end the session on the cards that needed it.',
        mock: 'review-queue',
      },
      {
        title: 'Confidence that only moves when you earn it',
        body: 'Every answer, in every mode, updates what the app believes you know about each idea — and it knows a lucky multiple-choice pick proves less than a written answer.',
        mock: 'memory',
      },
      {
        title: 'Your memory, in one place',
        body: 'Everything you have ever answered, filterable by set, category or period. Forget a card and the evidence is erased, not only the estimate.',
        mock: 'memory-history',
      },
    ],
  },
  {
    slug: 'games',
    label: 'Learning games',
    icon: Gamepad2,
    status: 'live',
    badge: 'Match today · four more coming',
    claim: 'Games built from your set, not from a word list.',
    body: 'Match is here today. Coming next: Gauntlet, a run through the cards you are weakest on; Hot Seat, a simulated interview that probes what you miss; and Blitz and Crossword, built from the short key points inside long cards.',
    benefits: [
      { title: 'Just for fun', body: 'Nothing a game sees goes into your record. Play as badly as you like; your memory is untouched.' },
      { title: 'Made from key points', body: 'A long definition becomes a short prompt — "WACC stands for ___" — so arcade formats work on cards that are paragraphs.' },
      { title: 'Tuned to the subject', body: 'Hot Seat’s interviewer for a finance set is a superday panel; for a history set, an oral examiner; for a language set, someone to talk to.' },
    ],
    heroMock: 'games-hub',
    sections: [
      {
        title: 'Gauntlet — a run through what you are weakest on',
        body: 'Corridors for the cards you know, locked doors for the ones you half know, and your three worst cards as bosses at the end. Three lives. The one game that reads your memory — and it only reads.',
        mock: 'gauntlet',
      },
      {
        title: 'Hot Seat — the interview, before the interview',
        body: 'Five questions, a soft clock, an interviewer whose mood you can see. Miss a point and they probe it; recover and the mood comes back. Callback or no callback at the end.',
        mock: 'hot-seat',
      },
      {
        title: 'Blitz and Crossword — short prompts, fast hands',
        body: 'Prompts fall in lanes and you tap the answer before they land. Or take the same prompts as crossword clues and fill the grid. Both work on any set with enough short answers inside it.',
        mock: 'blitz',
      },
      {
        title: 'Match — playable now',
        body: 'Tiles for terms and definitions, a timer, and a best time to beat. On sets with long definitions it can use the short key points instead.',
        mock: 'match',
      },
    ],
  },
]

export const FEATURE_SLUGS: readonly string[] = FEATURES.map((f) => f.slug)

export function getFeature(slug: string): Feature | null {
  return FEATURES.find((f) => f.slug === slug) ?? null
}
