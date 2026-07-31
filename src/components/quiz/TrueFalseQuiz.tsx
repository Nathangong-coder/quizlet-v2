'use client';

import React, { useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { Card as CardUI, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Card as PrismaCard } from '@prisma/client';
import { submitTrueFalseAnswer } from '@/actions/quiz';
import { cn } from '@/lib/utils';
import { ContentBlock } from '@/lib/cards/content';
import { QuizCardPrompt } from './QuizCardPrompt';
import { QuizSectionHandle, SectionNav } from './section';
import { useErrorToast } from '@/components/errors/useErrorToast';
import { useQuestionTimer } from './useQuestionTimer';

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

    // Starts (or confirms) this question's clock whenever it becomes the
    // visible one in this one-question-at-a-time carousel. `timer.start` is
    // first-write-wins, so navigating back to an already-seen question does
    // not restart its clock — it keeps running from its first visit until
    // the batched commitAll() below reads it at final submit.
    useEffect(() => {
      const activeId = cards[currentIndex]?.id;
      if (activeId) timer.start(activeId);
    }, [cards, currentIndex, timer]);

    async function commitAll() {
      for (const card of cards) {
        const selected = selectedAnswers[card.id];
        if (!selected) continue;
        const res = await submitTrueFalseAnswer({
          attemptId,
          cardId: card.id,
          selectedOption: selected,
          latencyMs: timer.elapsed(card.id),
        });
        if (!res.success) showError(res.error || 'Failed to save answer', res.detail);
      }
    }

    useImperativeHandle(ref, () => ({ commitAll }), [cards, selectedAnswers, attemptId]);

    function goNext() {
      setCurrentIndex(i => Math.min(i + 1, cards.length - 1));
    }

    function goPrev() {
      setCurrentIndex(i => Math.max(i - 1, 0));
    }

    const card = cards[currentIndex];
    if (!card) return <div className="text-center p-10">No cards available for this quiz.</div>;

    const answeredCount = cards.filter(c => selectedAnswers[c.id]).length;

    return (
      <div className="max-w-2xl mx-auto space-y-4 p-4">
        <CardUI className="space-y-4">
          <CardHeader>
            <CardTitle className="mb-2">Question {currentIndex + 1}</CardTitle>
            <QuizCardPrompt card={card} side="term" />
          </CardHeader>
          <CardContent className="space-y-6 text-center">
            <div className="p-4 bg-muted rounded-lg space-y-2 text-left">
              <p className="font-bold text-sm text-muted-foreground uppercase tracking-wider">Definition</p>
              <QuizCardPrompt card={card} side="definition" />
            </div>

            <p className="text-sm text-muted-foreground text-center">Is this the correct definition?</p>

            <div className="flex justify-center gap-4">
              {['true', 'false'].map((val) => (
                <Button
                  key={val}
                  type="button"
                  variant={selectedAnswers[card.id] === val ? 'default' : 'outline'}
                  onClick={() => setSelectedAnswers(prev => ({ ...prev, [card.id]: val }))}
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
          answeredCount={answeredCount}
          onPrev={goPrev}
          onNext={goNext}
        />
        {errorDialog}
      </div>
    );
  }
);
