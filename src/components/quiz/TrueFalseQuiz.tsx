'use client';

import React, { useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { Card as CardUI, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Card as PrismaCard } from '@prisma/client';
import { submitTrueFalseAnswer, getTrueFalseQuestion } from '@/actions/quiz';
import { cn } from '@/lib/utils';
import { ContentBlock } from '@/lib/cards/content';
import { QuizCardPrompt } from './QuizCardPrompt';
import { QuizSectionHandle, SectionNav } from './section';
import { useErrorToast } from '@/components/errors/useErrorToast';
import { useQuestionTimer } from './useQuestionTimer';
import { QuestionTimerDisplay } from './QuestionTimer';

type QuizCard = PrismaCard & { contentBlocks?: ContentBlock[] };

interface TrueFalseQuizProps {
  cards: QuizCard[];
  attemptId: string;
}

export const TrueFalseQuiz = forwardRef<QuizSectionHandle, TrueFalseQuizProps>(
  function TrueFalseQuiz({ cards, attemptId }, ref) {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [selectedAnswers, setSelectedAnswers] = useState<{ [cardId: string]: string }>({});
    const { show: showError, dialog: errorDialog } = useErrorToast();
    const timer = useQuestionTimer();
    const [statements, setStatements] = useState<{ [cardId: string]: string }>({});
    const [loadingId, setLoadingId] = useState<string | null>(null);

    // Starts (or confirms) this question's clock whenever it becomes the
    // visible one in this one-question-at-a-time carousel. `timer.start` is
    // first-write-wins, so navigating back to an already-seen question does
    // not restart its clock.
    useEffect(() => {
      const activeId = cards[currentIndex]?.id;
      if (activeId) timer.start(activeId);
    }, [cards, currentIndex, timer]);

    // The statement is generated server-side and may be a KLP-corrupted
    // variant, so it CANNOT be derived from the card on the client.
    useEffect(() => {
      const activeId = cards[currentIndex]?.id;
      if (!activeId || statements[activeId]) return;

      let cancelled = false;
      setLoadingId(activeId);
      getTrueFalseQuestion(attemptId, activeId).then((res) => {
        if (cancelled) return;
        setLoadingId(null);
        if (!res.success) {
          showError(res.error || 'Failed to load question');
          return;
        }
        setStatements((prev) => ({ ...prev, [activeId]: res.data.statement }));
      });
      return () => {
        cancelled = true;
      };
    }, [cards, currentIndex, attemptId, statements, showError]);

    async function commitAll() {
      for (const card of cards) {
        const selected = selectedAnswers[card.id];
        if (!selected) continue;
        timer.stop(card.id);
        const res = await submitTrueFalseAnswer({
          attemptId,
          cardId: card.id,
          selectedOption: selected,
          latencyMs: timer.elapsed(card.id),
        });
        if (!res.success) showError(res.error || 'Failed to save answer', res.detail);
      }
    }

    // The one expression for "how many did they answer" in this section: read
    // both by SectionNav's progress badge below and by the imperative handle
    // the container sums at submit. Kept as a single function rather than
    // duplicated, because a second copy could drift and make a skipped-quiz
    // discard disagree with the count the learner was just shown.
    function answeredCount() {
      return cards.filter(c => selectedAnswers[c.id]).length;
    }

    // `selectedAnswers` is in the dep array, so the handle is rebuilt on every
    // pick and never reports a stale count. Verified deliberately: a stale 0
    // here would let the container discard an attempt the learner really took.
    useImperativeHandle(ref, () => ({ commitAll, answeredCount }), [cards, selectedAnswers, attemptId]);

    function goNext() {
      const activeId = cards[currentIndex]?.id;
      if (activeId) timer.stop(activeId);
      setCurrentIndex(i => Math.min(i + 1, cards.length - 1));
    }

    function goPrev() {
      const activeId = cards[currentIndex]?.id;
      if (activeId) timer.stop(activeId);
      setCurrentIndex(i => Math.max(i - 1, 0));
    }

    const card = cards[currentIndex];
    if (!card) return <div className="text-center p-10">No cards available for this quiz.</div>;

    const statementReady = Boolean(statements[card.id]) && loadingId !== card.id;

    return (
      <div className="max-w-2xl mx-auto space-y-4 p-4">
        <CardUI className="space-y-4">
          <CardHeader>
            <CardTitle className="mb-2 flex items-center justify-between gap-3">
              <span>Question {currentIndex + 1}</span>
              <QuestionTimerDisplay timer={timer} cardId={card.id} />
            </CardTitle>
            <QuizCardPrompt card={card} side="term" />
          </CardHeader>
          <CardContent className="space-y-6 text-center">
            <div className="p-4 bg-muted rounded-lg space-y-2 text-left">
              <p className="font-bold text-sm text-muted-foreground uppercase tracking-wider">
                Statement
              </p>
              {loadingId === card.id ? (
                <p className="text-muted-foreground">Loading…</p>
              ) : (
                <p>{statements[card.id] ?? ''}</p>
              )}
            </div>

            <p className="text-sm text-muted-foreground text-center">
              Is this statement correct?
            </p>

            <div className="flex justify-center gap-4">
              {['true', 'false'].map((val) => (
                <Button
                  key={val}
                  type="button"
                  disabled={!statementReady}
                  variant={selectedAnswers[card.id] === val ? 'default' : 'outline'}
                  onClick={() => {
                    timer.stop(card.id);
                    setSelectedAnswers(prev => ({ ...prev, [card.id]: val }));
                  }}
                  className={cn(
                    'px-8 capitalize transition-all',
                    selectedAnswers[card.id] === val && 'bg-primary text-primary-foreground',
                  )}
                >
                  {val}
                </Button>
              ))}
            </div>
          </CardContent>
        </CardUI>

        <SectionNav
          index={currentIndex}
          total={cards.length}
          answeredCount={answeredCount()}
          onPrev={goPrev}
          onNext={goNext}
        />
        {errorDialog}
      </div>
    );
  }
);
