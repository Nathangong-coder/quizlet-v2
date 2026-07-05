import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { notFound } from 'next/navigation';
import { PrintableQuiz } from '@/components/quiz/PrintableQuiz';
import { buildPrintableTest } from '@/lib/quiz/printable';
import { DEFAULT_AI_MODEL } from '@/lib/ai/model-routing';
import { MultipleChoiceOptionsSchema } from '@/lib/ai/schemas';

const cardInclude = {
  contentBlocks: { include: { asset: true }, orderBy: { position: 'asc' as const } },
};

export default async function PrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ attemptId?: string; modes?: string; side?: string; count?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const session = await auth();
  if (!session?.user?.id) return notFound();

  const set = await prisma.set.findUnique({ where: { id } });
  if (!set) return notFound();

  let cards: any[];
  let modes: string[];
  let promptSide: 'term' | 'definition' | 'mixed' = 'term';

  if (sp.attemptId) {
    // Mirror an actual attempt: same cards, modes, prompt side, and MC options.
    const attempt = await prisma.quizAttempt.findUnique({ where: { id: sp.attemptId } });
    if (!attempt || attempt.setId !== id) return notFound();

    const cardIds = (attempt.selectedCardIds as string[]) || [];
    const found = await prisma.card.findMany({ where: { id: { in: cardIds } }, include: cardInclude });
    // preserve attempt order so the printed sections match the quiz
    cards = cardIds.map((cid) => found.find((c) => c.id === cid)).filter(Boolean);
    modes = ((attempt.questionMode as string[]) || [attempt.mode]).filter(Boolean);
    promptSide = (attempt.promptSide as any) || 'term';
  } else {
    const all = await prisma.card.findMany({
      where: { setId: id },
      include: cardInclude,
      orderBy: { position: 'asc' },
    });
    const count = sp.count ? parseInt(sp.count, 10) : all.length;
    cards = all.slice(0, Number.isFinite(count) && count > 0 ? count : all.length);
    modes = sp.modes ? sp.modes.split(',').filter(Boolean) : ['multiple-choice'];
    promptSide = (sp.side as any) || 'term';
  }

  // Cached MC options (only present after the MC section has run at least once).
  const mcOptions: Record<string, { options: string[]; correctAnswer: string }> = {};
  if (modes.includes('multiple-choice') && cards.length > 0) {
    const caches = await prisma.quizOptionCache.findMany({
      where: { cardId: { in: cards.map((c) => c.id) }, model: DEFAULT_AI_MODEL },
    });
    for (const c of caches) {
      try {
        const parsed = MultipleChoiceOptionsSchema.parse(c.options);
        mcOptions[c.cardId] = { options: parsed.options, correctAnswer: parsed.correctAnswer };
      } catch {
        // ignore malformed cache entries; distractors are built offline instead
      }
    }
  }

  const test = buildPrintableTest({ title: set.title, cards, modes, promptSide, mcOptions });

  return (
    <div className="py-6">
      <PrintableQuiz test={test} />
    </div>
  );
}
