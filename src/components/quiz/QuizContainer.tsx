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

export function QuizContainer({ setId, cards: allCards, setup }: { setId: string, cards: Card[], setup?: any }) {
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [selectedCards, setSelectedCards] = useState<Card[]>([]);
  const [isLoadingCards, setIsLoadingCards] = useState(true);
  const [finished, setFinished] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [completedModes, setCompletedModes] = useState<string[]>([]);

  useEffect(() => {
    if (setup && !attemptId) {
      async function startAttempt() {
        setIsLoadingCards(true);
        const modes = setup.questionMode || ['multiple-choice'];
        const result = await startQuizAttempt(setId, modes, setup);
        if (result.success && result.data) {
          setAttemptId(result.data.attemptId);
        } else {
          toast.error(result.error || 'Failed to start quiz');
        }
      }
      startAttempt();
    }
  }, [setup, setId, attemptId]);

  useEffect(() => {
    if (attemptId) {
      async function loadCards() {
        setIsLoadingCards(true);
        const result = await getQuizAttemptCards(attemptId as string);
        if (result.success && result.data) {
          setSelectedCards(result.data.cards);
        }
        setIsLoadingCards(false);
      }
      loadCards();
    }
  }, [attemptId]);

  const handleModeFinish = (mode: string, s: number) => {
    setCompletedModes(prev => [...prev, mode]);
    // In a real mixed quiz, we'd average the scores.
    // For now, we'll just set the latest score or a running average.
    setScore(s);

    if (setup?.questionMode?.length === 1) {
      setFinished(true);
    } else if (completedModes.length + 1 === setup?.questionMode?.length) {
      setFinished(true);
    }
  };

  if (finished) {
    return <QuizSummary score={score || 0} setId={setId} attemptId={attemptId!} />;
  }

  if (isLoadingCards) return <div className="flex justify-center p-10"><Loader2 className="animate-spin w-8 h-8" /></div>;

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
