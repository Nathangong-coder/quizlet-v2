'use client';

import React, { useState, useEffect, useRef } from 'react';
import { MultipleChoiceQuiz } from './MultipleChoiceQuiz';
import { ShortAnswerQuiz } from './ShortAnswerQuiz';
import { TrueFalseQuiz } from './TrueFalseQuiz';
import { MatchingQuiz } from './MatchingQuiz';
import { QuizSummary } from './QuizSummary';
import { QuizSectionHandle } from './section';
import { Card } from '@prisma/client';
import { getQuizAttemptCards, startQuizAttempt } from '@/actions/quiz';
import { Loader2, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export function QuizContainer({ setId, cards: allCards, setup }: { setId: string, cards: Card[], setup?: any }) {
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [selectedCards, setSelectedCards] = useState<Card[]>([]);
  const [isLoadingCards, setIsLoadingCards] = useState(true);
  const [finished, setFinished] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One imperative handle per rendered section, so the single overall-submit
  // button can flush every section's currently-visible answer at once.
  const sectionRefs = useRef<(QuizSectionHandle | null)[]>([]);

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

  async function handleSubmitQuiz() {
    setIsSubmitting(true);
    try {
      // Grade every section's answers exactly once, here at submit time.
      // Sections run in parallel; each grades its answered questions.
      await Promise.all(
        sectionRefs.current.map((r) => (r ? r.commitAll() : Promise.resolve())),
      );
    } catch (e) {
      toast.error('Something went wrong grading your answers');
    } finally {
      setIsSubmitting(false);
      setFinished(true);
    }
  }

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
    return <QuizSummary score={0} setId={setId} attemptId={attemptId!} />;
  }

  if (isSubmitting) return <div className="flex flex-col items-center justify-center p-20 gap-4">
    <Loader2 className="animate-spin w-12 h-12 text-primary" />
    <p className="text-lg font-medium">Grading your quiz...</p>
    <p className="text-muted-foreground animate-pulse text-sm">Scoring answers and generating feedback. This can take a moment.</p>
  </div>;

  if (isLoadingCards) return <div className="flex flex-col items-center justify-center p-20 gap-4">
    <Loader2 className="animate-spin w-12 h-12 text-primary" />
    <p className="text-muted-foreground animate-pulse">Building your personalized quiz...</p>
  </div>;

  const modes: string[] = setup?.questionMode || ['multiple-choice'];

  // Deal the selected cards round-robin across the modes so that the TOTAL
  // number of questions equals the number of selected cards (never more).
  // Each card is tested in exactly one mode. If there are fewer cards than
  // modes, the trailing modes simply get none (and are dropped below) — this
  // is what prevents "asked for 9, got 12" when cards < modes.
  const cardsByMode: Card[][] = modes.map(() => [] as Card[]);
  selectedCards.forEach((card, i) => {
    cardsByMode[i % modes.length].push(card);
  });

  const registerRef = (el: QuizSectionHandle | null, index: number) => {
    sectionRefs.current[index] = el;
  };

  return (
    <div className="max-w-4xl mx-auto space-y-12 py-8 px-4">
      <div className="text-center space-y-2 mb-8">
        <h1 className="text-3xl font-bold">Your Quiz</h1>
        <p className="text-muted-foreground">Answer what you can, then submit whenever you're ready.</p>
        <div className="flex justify-center pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.open(`/sets/${setId}/print?attemptId=${attemptId}`, '_blank')}
          >
            <Printer className="w-4 h-4 mr-2" /> Print this test (PDF)
          </Button>
        </div>
      </div>

      <div className="space-y-16">
        {modes.map((mode: string, index: number) => {
          const modeCards = cardsByMode[index];

          if (modeCards.length === 0) return null;

          return (
            <section key={mode} className="space-y-4">
              <div className="flex items-center gap-4 border-b pb-2">
                <h2 className="text-xl font-semibold capitalize">
                  {mode.replace('-', ' ')} Section
                </h2>
              </div>

              <div className="bg-card rounded-xl p-1">
                {mode === 'multiple-choice' && (
                  <MultipleChoiceQuiz
                    ref={(el) => registerRef(el, index)}
                    cards={modeCards}
                    attemptId={attemptId!}
                  />
                )}
                {mode === 'short-answer' && (
                  <ShortAnswerQuiz
                    ref={(el) => registerRef(el, index)}
                    cards={modeCards}
                    attemptId={attemptId!}
                  />
                )}
                {mode === 'true-false' && (
                  <TrueFalseQuiz
                    ref={(el) => registerRef(el, index)}
                    cards={modeCards}
                    attemptId={attemptId!}
                  />
                )}
                {mode === 'matching' && (
                  <MatchingQuiz
                    ref={(el) => registerRef(el, index)}
                    cards={modeCards}
                    attemptId={attemptId!}
                  />
                )}
              </div>
            </section>
          );
        })}
      </div>

      <div className="flex flex-col items-center justify-center py-8 space-y-4">
        <Button
          onClick={handleSubmitQuiz}
          disabled={isSubmitting}
          size="lg"
          className="px-12 py-6 text-xl font-bold bg-primary hover:bg-primary/90 transition-all hover:scale-105 active:scale-95 shadow-xl"
        >
          {isSubmitting && <Loader2 className="animate-spin w-5 h-5 mr-2" />}
          Submit Overall Quiz
        </Button>
        <p className="text-xs text-muted-foreground text-center max-w-sm">
          You can submit at any time. Unanswered questions simply score zero.
        </p>
      </div>
    </div>
  );
}
