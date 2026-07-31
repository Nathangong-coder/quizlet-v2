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
import { finishStudySession, generateSessionInsight } from '@/actions/study-session';
import { Loader2, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export function QuizContainer({ setId, cards: allCards, setup }: { setId: string, cards: Card[], setup?: any }) {
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
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
        if (result.success) {
          setAttemptId(result.data.attemptId);
          setSessionId(result.data.sessionId);
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
        if (result.success) {
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

      if (sessionId) {
        const finishResult = await finishStudySession({ sessionId });
        if (!finishResult.success) {
          toast.error(finishResult.error || 'Failed to close study session');
        }
        // Fire-and-forget: the summary renders from the computed block
        // immediately, and the AI narrative appears on refresh if it lands.
        // A failed generation must never block the results screen.
        generateSessionInsight({ sessionId }).catch(() => {});
      }
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

  // Build exactly `questionCount` total questions, spread as evenly as possible
  // across the selected sections. A card may be reused across DIFFERENT modes
  // (e.g. tested once as MC and once as True/False) so the requested count is
  // reachable even when the set has few distinct cards — but never repeated
  // within a single mode. This makes "8 questions, 4 sections" give 2 per
  // section instead of 3 total, while still never exceeding what was asked for.
  const pool = selectedCards;
  const nModes = modes.length;
  const requested = Math.max(1, setup?.questionCount ?? pool.length);
  // Ceiling: each mode can hold at most `pool.length` distinct cards.
  const total = Math.min(requested, nModes * pool.length);

  const perMode = modes.map((_, i) => {
    const base = Math.floor(total / nModes);
    return base + (i < total % nModes ? 1 : 0);
  });

  let offset = 0;
  const cardsByMode: Card[][] = modes.map((_, i) => {
    const want = Math.min(perMode[i], pool.length); // no repeats within a mode
    const arr: Card[] = [];
    for (let k = 0; k < want && pool.length > 0; k++) {
      arr.push(pool[(offset + k) % pool.length]);
    }
    offset += want; // rotate so different modes tend to draw different cards
    return arr;
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
