import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { notFound } from 'next/navigation';
import { PrintableQuiz } from '@/components/quiz/PrintableQuiz';
import { assemblePrintableQuiz } from '@/lib/quiz/printable';

export default async function PrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session) return notFound();

  const set = await prisma.set.findUnique({
    where: { id },
    include: { cards: true },
  });
  if (!set) return notFound();

  // In a real app, we would fetch the latest QuizAttempt setup.
  // For now, we use a default setup.
  const defaultSetup = {
    promptSide: "term",
    categoryIds: [],
  };

  const printableData = assemblePrintableQuiz(set.cards, defaultSetup);

  return (
    <div className="py-10">
      <PrintableQuiz title={set.title} questions={printableData.questions} />
    </div>
  );
}
