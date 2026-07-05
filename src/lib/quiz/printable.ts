// Builds a printable test that mirrors the actual quiz: multiple-choice with
// options, short-answer with blank lines, true/false statements, and matching
// columns — plus a sectioned answer key. Media blocks are surfaced so the
// print view can render real images / video frames / file notices.

export type PrintBlockKind = 'text' | 'image' | 'video' | 'file';

export interface PrintBlock {
  kind: PrintBlockKind;
  text?: string; // text content, or the display name for media/files
  assetUrl?: string; // /api/assets/{id} for media & files
}

export interface PrintQuestion {
  number: number; // global question number across the whole test
  cardId: string;
  promptBlocks: PrintBlock[];
  answerBlocks: PrintBlock[];
  answerText: string; // plain-text answer (used in the answer key)
  // multiple-choice
  options?: string[];
  correctOptionIndex?: number;
  // true/false
  statement?: PrintBlock[]; // the definition shown (may be a wrong one)
  tfCorrect?: boolean; // is the shown statement actually correct?
}

export interface PrintMatchItem {
  number: number;
  promptBlocks: PrintBlock[];
  answerLabel: string; // letter of the correct definition in the pool
}

export interface PrintSection {
  mode: 'multiple-choice' | 'short-answer' | 'true-false' | 'matching';
  title: string;
  startNumber: number;
  questions: PrintQuestion[];
  // matching only
  matchItems?: PrintMatchItem[];
  matchPool?: { label: string; text: string }[]; // shuffled definition pool
}

export interface PrintableTest {
  title: string;
  sections: PrintSection[];
}

const MODE_TITLES: Record<string, string> = {
  'multiple-choice': 'Multiple Choice',
  'short-answer': 'Short Answer',
  'true-false': 'True / False',
  matching: 'Matching',
};

function byPos(a: any, b: any) {
  return (a.position ?? 0) - (b.position ?? 0);
}

function sideBlocks(card: any, side: 'term' | 'definition') {
  return (card.contentBlocks ?? []).filter((b: any) => b.side === side).sort(byPos);
}

/** Convert a card side into renderable print blocks (text + media). */
function sideToPrintBlocks(card: any, side: 'term' | 'definition'): PrintBlock[] {
  const blocks = sideBlocks(card, side);
  if (blocks.length === 0) {
    return [{ kind: 'text', text: side === 'term' ? card.term : card.definition }];
  }
  return blocks.map((b: any): PrintBlock => {
    if (b.type === 'text') return { kind: 'text', text: b.text ?? '' };
    const asset = b.asset;
    const url = b.assetId ? `/api/assets/${b.assetId}` : undefined;
    const name = asset?.originalName ?? b.type;
    const kind = asset?.kind;
    if (kind === 'image' || b.type === 'image') return { kind: 'image', assetUrl: url, text: name };
    if (kind === 'video' || b.type === 'video') return { kind: 'video', assetUrl: url, text: name };
    return { kind: 'file', assetUrl: url, text: name };
  });
}

/** Plain-text version of a side, for options / answer keys. */
function sidePlainText(card: any, side: 'term' | 'definition'): string {
  const blocks = sideBlocks(card, side);
  if (blocks.length === 0) return side === 'term' ? card.term : card.definition;
  const text = blocks
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text || '')
    .filter(Boolean)
    .join(' ');
  if (text) return text;
  // Media-only side: describe it rather than leaving the answer key blank.
  const media = blocks.find((b: any) => b.type !== 'text');
  return media ? `[${media.type}]` : side === 'term' ? card.term : card.definition;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

interface BuildArgs {
  title: string;
  cards: any[];
  modes: string[];
  promptSide: 'term' | 'definition' | 'mixed';
  /** Cached MC options keyed by cardId, if available. */
  mcOptions?: Record<string, { options: string[]; correctAnswer: string }>;
}

/**
 * Deal the cards across the selected modes round-robin — the SAME distribution
 * QuizContainer uses — so the printed test matches what the quiz would show.
 */
export function buildPrintableTest({ title, cards, modes, promptSide, mcOptions = {} }: BuildArgs): PrintableTest {
  const activeModes = modes.length > 0 ? modes : ['multiple-choice'];
  const cardsByMode: any[][] = activeModes.map(() => []);
  cards.forEach((card, i) => {
    cardsByMode[i % activeModes.length].push(card);
  });

  const promptFor = (card: any): 'term' | 'definition' =>
    promptSide === 'mixed' ? (Math.random() > 0.5 ? 'term' : 'definition') : promptSide;

  let counter = 0;
  const sections: PrintSection[] = [];

  activeModes.forEach((mode, index) => {
    const modeCards = cardsByMode[index];
    if (!modeCards || modeCards.length === 0) return;

    const startNumber = counter + 1;

    if (mode === 'matching') {
      // Terms in order; definitions shuffled into a lettered pool.
      const pairs = modeCards.map((card: any) => {
        const pSide = promptFor(card);
        const aSide = pSide === 'term' ? 'definition' : 'term';
        return {
          card,
          promptBlocks: sideToPrintBlocks(card, pSide),
          answerText: sidePlainText(card, aSide),
        };
      });
      const pool = shuffle(pairs.map((p) => p.answerText)).map((text, i) => ({
        label: LETTERS[i] ?? String(i + 1),
        text,
      }));
      const matchItems: PrintMatchItem[] = pairs.map((p) => {
        counter += 1;
        const label = pool.find((pl) => pl.text === p.answerText)?.label ?? '?';
        return { number: counter, promptBlocks: p.promptBlocks, answerLabel: label };
      });
      sections.push({
        mode,
        title: MODE_TITLES[mode],
        startNumber,
        questions: [],
        matchItems,
        matchPool: pool,
      });
      return;
    }

    const questions: PrintQuestion[] = modeCards.map((card: any) => {
      counter += 1;
      const pSide = promptFor(card);
      const aSide = pSide === 'term' ? 'definition' : 'term';
      const q: PrintQuestion = {
        number: counter,
        cardId: card.id,
        promptBlocks: sideToPrintBlocks(card, pSide),
        answerBlocks: sideToPrintBlocks(card, aSide),
        answerText: sidePlainText(card, aSide),
      };

      if (mode === 'multiple-choice') {
        const cached = mcOptions[card.id];
        if (cached) {
          q.options = cached.options;
          q.correctOptionIndex = cached.options.findIndex(
            (o) => o.trim().toLowerCase() === cached.correctAnswer.trim().toLowerCase(),
          );
        } else {
          // Build offline distractors from other cards' answers (no AI needed).
          const correct = q.answerText;
          const distractorPool = cards
            .filter((c) => c.id !== card.id)
            .map((c) => sidePlainText(c, aSide))
            .filter((t) => t && t !== correct);
          const distractors = shuffle(distractorPool).slice(0, 3);
          const opts = shuffle([correct, ...distractors]);
          q.options = opts;
          q.correctOptionIndex = opts.indexOf(correct);
        }
      }

      if (mode === 'true-false') {
        // Half the time show a wrong definition so the printed T/F is a real test.
        const showWrong = Math.random() > 0.5;
        const otherAnswers = cards
          .filter((c) => c.id !== card.id)
          .map((c) => sideToPrintBlocks(c, aSide));
        if (showWrong && otherAnswers.length > 0) {
          q.statement = otherAnswers[Math.floor(Math.random() * otherAnswers.length)];
          q.tfCorrect = false;
        } else {
          q.statement = q.answerBlocks;
          q.tfCorrect = true;
        }
      }

      return q;
    });

    sections.push({ mode: mode as any, title: MODE_TITLES[mode] ?? mode, startNumber, questions });
  });

  return { title, sections };
}
