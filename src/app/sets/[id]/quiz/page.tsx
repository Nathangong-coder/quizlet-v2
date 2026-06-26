import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { notFound } from 'next/navigation';
import { QuizContainer } from '@/components/quiz/QuizContainer';
import { TrainingPlanPanel } from '@/components/quiz/TrainingPlanPanel';
import { Separator } from '@/components/ui/separator';

export default async function QuizPage({ params }: { params: { id: string } }) {
  const session = await auth();
  if (!session) return notFound();

  const set = await prisma.set.findUnique({
    where: { id: params.id },
    include: { cards: true },
  });
  if (!set) return notFound();

  // Check if user has an AI credential
  const credential = await prisma.aiCredential.findUnique({
    where: { userId: session.user.id },
  });

  return (
    <div className="container mx-auto py-10">
      <h1 className="text-3xl font-bold mb-8 text-center">{set.title} Quiz</h1>

      {!credential ? (
        <div className="p-6 border rounded-lg bg-yellow-50 text-center space-y-4">
          <p>You need a Google API key to access AI quizzing.</p>
          <a href="/settings/ai" className="text-primary font-medium hover:underline">Go to AI Settings</a>
        </div>
      ) : (
        <div className="space-y-8">
            <QuizContainer setId={set.id} cards={set.cards} />
            <Separator />
            <TrainingPlanPanel setId={set.id} />
        </div>
      )}
    </div>
  );
}
