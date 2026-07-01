'use client';

import React, { useState, useEffect } from 'react';
import { MultipleChoiceQuiz } from './MultipleChoiceQuiz';
import { ShortAnswerQuiz } from './ShortAnswerQuiz';
import { TrueFalseQuiz } from './TrueFalseQuiz';
import { MatchingQuiz } from './MatchingQuiz';
import { QuizSummary } from './QuizSummary';
import { Card } from '@prisma/client';
import { getQuizAttemptCards, startQuizAttempt } from '@/actions/quiz';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export function QuizContainer({ setId, cards: allCards, setup }: { setId: string, cards: Card[], setup?: any }) {
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [selectedCards, setSelectedCards] = useState<Card[]>([]);
  const [isLoadingCards, setIsLoadingCards] = useState(true);
  const [finished, setFinished] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [completedModes, setCompletedModes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (setup && !attemptId && !error) {
      async function startAttempt() {
        setIsLoadingCards(true);
        const modes = setup.questionMode || ['multiple-choice'];
        const result = await startQuizAttempt(setId, modes, setup);
        if (result.success && result.data) {
          setAttemptId(result.data.attemptId);
        } else {
          setError(result.error || 'Failed to start quiz');
          setIsLoadingCards(false);
          toast.error(result.error || 'Failed to start quiz');
        }
      }
      startAttempt();
    }
  }, [setup, setId, attemptId, error]);

  useEffect(() => {
    if (attemptId) {
      async function loadCards() {
        setIsLoadingCards(true);
        const result = await getQuizAttemptCards(attemptId as string);
        if (result.success && result.data) {
          setSelectedCards(result.data.cards);
        } else {
          setError(result.error || 'Failed to load cards');
        }
        setIsLoadingCards(false);
      }
      loadCards();
    }
  }, [attemptId]);

  const handleModeFinish = (mode: string, s: number) => {
    if (completedModes.includes(mode)) return;

    const nextCompleted = [...completedModes, mode];
    setCompletedModes(nextCompleted);
    setScore(s);

    const totalModes = setup?.questionMode?.length || 1;
    if (nextCompleted.length >= totalModes) {
      setFinished(true);
    }
  };

  if (error) {
    return (
      <div className="max-w-md mx-auto py-20 text-center space-y-6">
        <div className="bg-destructive/10 p-6 rounded-xl border border-destructive/20">
          <h2 className="text-xl font-bold text-destructive mb-2">Quiz Error</h2>
          <p className="text-muted-foreground">{error}</p>
        </div>
        <Button onClick={() => window.location.reload()} variant="outline">
          Try Again / Change Settings
        </Button>
      </div>
    );
  }

  if (finished) {
    return <QuizSummary score={score || 0} setId={setId} attemptId={attemptId!} />;
  }

  if (isLoadingCards) return <div className="flex flex-col items-center justify-center p-20 gap-4">
    <Loader2 className="animate-spin w-12 h-12 text-primary" />
    <p className="text-muted-foreground animate-pulse">Building your personalized quiz...</p>
  </div>;

  const modes = setup?.questionMode || ['multiple-choice'];

  // Partition cards among modes
  const cardsPerMode = Math.ceil(selectedCards.length / modes.length);

  return (
    <div className="max-w-4xl mx-auto space-y-12 py-8 px-4">
      <div className="text-center space-y-2 mb-8">
        <h1 className="text-3xl font-bold">Your Quiz</h1>
        <p className="text-muted-foreground">Complete all sections to finish</p>
      </div>

      <div className="space-y-16">
        {modes.map((mode: string, index: number) => {
          const modeCards = selectedCards.slice(
            index * cardsPerMode,
            (index + 1) * cardsPerMode
          );

          if (modeCards.length === 0) return null;

          return (
            <section key={mode} className="space-y-4">
              <div className="flex items-center gap-4 border-b pb-2">
                <h2 className="text-xl font-semibold capitalize">
                  {mode.replace('-', ' ')} Section
                </h2>
                {completedModes.includes(mode) && (
                  <span className="text-green-500 text-sm font-medium">Completed ✓</span>
                )}
              </div>

              <div className="bg-card rounded-xl p-1">
                {mode === 'multiple-choice' && (
                  <MultipleChoiceQuiz
                    cards={modeCards}
                    attemptId={attemptId!}
                    onFinish={(s) => handleModeFinish(mode, s)}
                  />
                )}
                {mode === 'short-answer' && (
                  <ShortAnswerQuiz
                    cards={modeCards}
                    attemptId={attemptId!}
                    onFinish={(s) => handleModeFinish(mode, s)}
                  />
                )}
                {mode === 'true-false' && (
                  <TrueFalseQuiz
                    cards={modeCards}
                    attemptId={attemptId!}
                    onFinish={(s) => handleModeFinish(mode, s)}
                  />
                )}
                {mode === 'matching' && (
                  <MatchingQuiz
                    cards={modeCards}
                    attemptId={attemptId!}
                    onFinish={(s) => handleModeFinish(mode, s)}
                  />
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
