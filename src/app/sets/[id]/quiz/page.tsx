import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { notFound } from 'next/navigation';
import { Separator } from '@/components/ui/separator';
import { QuizClientWrapper } from '@/components/quiz/QuizClientWrapper';

export default async function QuizPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session) return notFound();

  const set = await prisma.set.findUnique({
    where: { id },
    include: {
      cards: {
        include: { contentBlocks: { orderBy: { position: 'asc' } } },
      },
      categories: true,
    },
  });
  if (!set) return notFound();

  // Any enabled credential is enough to offer AI quizzing; which provider it
  // is gets decided per-task at generation time.
  const credential = await prisma.aiCredential.findFirst({
    where: { userId: session.user.id, enabled: true },
    select: { id: true },
  });

  return (
    <div className="container mx-auto py-10">
      <h1 className="text-3xl font-bold mb-8 text-center">{set.title} Quiz</h1>

      {!credential ? (
        <div className="p-6 border rounded-lg bg-yellow-50 text-center space-y-4">
          <p>You need an AI provider API key to access AI quizzing.</p>
          <a href="/settings/ai" className="text-primary font-medium hover:underline">Go to AI Settings</a>
        </div>
      ) : (
        <QuizClientWrapper
          setId={set.id}
          cards={set.cards}
          categories={set.categories.map((c) => ({ id: c.id, name: c.name, color: c.color }))}
        />
      )}
    </div>
  );
}
