'use client';

import React, { useState, useImperativeHandle, forwardRef } from 'react';
import { Card as CardComponent, CardContent, CardHeader } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { submitShortAnswer } from '@/actions/quiz';
import { Card } from '@prisma/client';
import { ContentBlock } from '@/lib/cards/content';
import { QuizCardPrompt } from './QuizCardPrompt';
import { QuizSectionHandle, SectionNav } from './section';
import { useErrorToast } from '@/components/errors/useErrorToast';

type QuizCard = Card & { contentBlocks?: ContentBlock[] };

interface ShortAnswerQuizProps {
  cards: QuizCard[];
  attemptId: string;
}

export const ShortAnswerQuiz = forwardRef<QuizSectionHandle, ShortAnswerQuizProps>(
  function ShortAnswerQuiz({ cards, attemptId }, ref) {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [answers, setAnswers] = useState<{ [cardId: string]: string }>({});
    const { show: showError, dialog: errorDialog } = useErrorToast();

    async function commitAll() {
      // Grade every answered card once, on overall submit (sequential to be
      // gentle on the AI rate limit). Changing an answer before submitting
      // simply grades the final text once — no double grading.
      for (const card of cards) {
        const text = (answers[card.id] || '').trim();
        if (!text) continue;
        const res = await submitShortAnswer({ attemptId, cardId: card.id, answer: text });
        if (!res.success) showError(res.error || 'Failed to grade answer', res.detail);
      }
    }

    useImperativeHandle(ref, () => ({ commitAll }), [cards, answers, attemptId]);

    function goNext() {
      setCurrentIndex(i => Math.min(i + 1, cards.length - 1));
    }

    function goPrev() {
      setCurrentIndex(i => Math.max(i - 1, 0));
    }

    const card = cards[currentIndex];
    if (!card) return <div className="text-center p-10">No cards available for this quiz.</div>;

    const answeredCount = cards.filter(c => (answers[c.id] || '').trim()).length;

    return (
      <div className="max-w-xl mx-auto space-y-4">
        <CardComponent>
          <CardHeader>
            <QuizCardPrompt card={card} side="term" />
          </CardHeader>
          <CardContent className="space-y-6">
            <Textarea
              placeholder="Type your answer here..."
              value={answers[card.id] || ''}
              onChange={(e) => setAnswers(prev => ({ ...prev, [card.id]: e.target.value }))}
              className="min-h-[150px] py-4"
            />
          </CardContent>
        </CardComponent>

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
