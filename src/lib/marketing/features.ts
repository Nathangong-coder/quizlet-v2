import type { ComponentType } from 'react'
import {
  Layers,
  BookOpenCheck,
  ScrollText,
  NotebookPen,
  GraduationCap,
  RotateCcw,
  Gamepad2,
  Users,
} from 'lucide-react'
import type { MockId } from '@/components/marketing/mock-ids'

/**
 * The eight features the signed-out surfaces advertise, in the order the owner
 * gave (study groups joined the list 2026-09-14). One registry feeds the landing showcase tabs, `/features`, and every
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
    status: 'live',
    claim: 'The whole set on one page, with your weak spots marked.',
    body: 'A guide is built from the set itself: your categories as its sections, every card as a heading, and under each the key points a good answer has to contain — shaded by what you have shown you know, and printable as it stands.',
    benefits: [
      { title: 'Sections you chose', body: 'The guide reads in the order of the categories you gave the set, so "Valuation" is a chapter and not a scatter of cards.' },
      { title: 'Key points, not paragraphs', body: 'Each card lists the ideas a good answer has to contain, with the ones that matter most marked.' },
      { title: 'Printable', body: 'A guide is a page. Print it with the shading, or without it for a clean copy.' },
    ],
    heroMock: 'guide',
    sections: [
      {
        title: 'Mastery, card by card',
        body: 'The Mastery tab on every set is the live version of the guide: each card, each of its key points, and how well you have shown you know it. Filter to the weak ones and that is your next session.',
        mock: 'mastery',
      },
      {
        title: 'Every card, reduced to what it teaches',
        body: 'Under each heading, the key points of the card. A long definition becomes four or five ideas you can check off.',
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
    claim: 'Five games built from your set, not from a word list.',
    body: 'A knight who strikes when you answer right. An interviewer whose face tells you how it is going. Prompts that fall, a crossword, and sixteen tiles against the clock. Every game is open to anyone on a public set; the two that grade your writing use your own AI keys.',
    benefits: [
      { title: 'Just for fun', body: 'Nothing a game sees goes into your record. Play as badly as you like; your memory is untouched. The only thing saved is your place on the set’s leaderboard.' },
      { title: 'Made from key points', body: 'A long definition becomes a short prompt — "WACC stands for ___" — so arcade formats work on cards that are paragraphs.' },
      { title: 'Leaderboards per set', body: 'Every game keeps a board for every set: best score, best mood, fastest time. Sign in with a handle to appear on it.' },
    ],
    heroMock: 'games-hub',
    sections: [
      {
        title: 'Gauntlet — a knight, 100 HP, twelve enemies',
        body: 'Each right answer is a strike; each wrong one is a hit you take, harder the deeper you go. Miss a card and you see it in full before the enemy asks a different one. Every third kill a magician offers a heal or a curse for the next foe. Multiple choice, or type the answer and let your accuracy be your chance to hit.',
        mock: 'gauntlet',
      },
      {
        title: 'Hot Seat — the interview, before the interview',
        body: 'An interviewer dressed for the subject, a soft clock, and a face that reacts to every answer. Miss a point and they probe it — you never see the point itself, only the follow-up. Three difficulties; the hard one has more questions and less patience.',
        mock: 'hot-seat',
      },
      {
        title: 'Blitz and Crossword — short prompts, fast hands',
        body: 'Prompts fall in lanes and you tap the answer before they land. Or take the same prompts as crossword clues and fill the grid. Both work on any set with enough short answers inside it.',
        mock: 'blitz',
      },
      {
        title: 'Match — eight pairs, one screen',
        body: 'Sixteen tiles of short key points, a timer, and the fastest time on the set’s board. Never a paragraph on a tile.',
        mock: 'match',
        link: { href: '/browse', label: 'Find a public set and play' },
      },
    ],
  },
  {
    slug: 'groups',
    label: 'Study groups',
    icon: Users,
    status: 'live',
    claim: 'Study with people who can see which cards you have down.',
    body: 'Make a group, share the link, add the sets you are all working on. The group sees, per set, who has mastered what — so the cards nobody has down are where you study next. Everyone who joins is told exactly what the group will see, and says yes first.',
    benefits: [
      { title: 'An invite link, nothing else', body: 'No requests, no approvals. Whoever has the link can join; the owner can turn the link over at any time.' },
      { title: 'Consent before visibility', body: 'Joining shows you what members will see — mastery and confidence on the group’s sets, nothing outside them — and asks. Leave, and it stops.' },
      { title: 'A leaderboard that means something', body: 'Cards mastered, not points. Card by card, who knows what, so the group can split the work.' },
    ],
    heroMock: 'group-board',
    sections: [
      {
        title: 'What a member sees, said before they join',
        body: 'The join page is the privacy contract: the group’s sets, the three things members will see about you on them, and the promise that nothing outside those sets is shared.',
        mock: 'group-consent',
      },
      {
        title: 'Card by card',
        body: 'For every set in the group, a grid of cards against members. The column with the gaps is the person who needs help; the row with the gaps is the card the group should do next.',
        mock: 'group-cards',
      },
      {
        title: 'Your progress stays yours',
        body: 'A group reads your memory; it never writes it. Studying a group’s set is the same as studying any set — the group only watches the result.',
        mock: 'memory',
        link: { href: '/groups', label: 'Your groups' },
      },
    ],
  },
]

export const FEATURE_SLUGS: readonly string[] = FEATURES.map((f) => f.slug)

export function getFeature(slug: string): Feature | null {
  return FEATURES.find((f) => f.slug === slug) ?? null
}
