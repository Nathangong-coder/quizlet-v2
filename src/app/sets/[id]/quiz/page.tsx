import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { notFound } from 'next/navigation';
import { QuizContainer } from '@/components/quiz/QuizContainer';
import { TrainingPlanPanel } from '@/components/quiz/TrainingPlanPanel';
import { Separator } from '@/components/ui/separator';
import { QuizSetupScreen } from '@/components/quiz/QuizSetupScreen';
import { useState } from 'react';

export default async function QuizPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session) return notFound();

  const set = await prisma.set.findUnique({
    where: { id },
    include: {
      cards: true,
      categories: true,
    },
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
        <QuizClientWrapper
          setId={set.id}
          cards={set.cards}
          categories={set.categories}
        />
      )}
    </div>
  );
}

function QuizClientWrapper({ setId, cards, categories }: { setId: string; cards: any[]; categories: any[] }) {
  const [setup, setSetup] = useState<any>(null);

  if (!setup) {
    return (
      <QuizSetupScreen
        setId={setId}
        availableCategories={categories.map(c => ({ id: c.id, name: c.name }))}
        onStart={(s) => setSetup(s)}
      />
    );
  }

  return (
    <div className="space-y-8">
        <QuizContainer setId={setId} cards={cards} setup={setup} />
        <Separator />
        <TrainingPlanPanel setId={setId} />
    </div>
  );
}
