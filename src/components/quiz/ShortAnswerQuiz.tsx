'use client';

import React, { useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { Card as CardComponent, CardContent, CardHeader } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { submitShortAnswer } from '@/actions/quiz';
import { Card } from '@prisma/client';
import { ContentBlock } from '@/lib/cards/content';
import { QuizCardPrompt } from './QuizCardPrompt';
import { QuizSectionHandle, SectionNav } from './section';
import { useErrorToast } from '@/components/errors/useErrorToast';
import { useQuestionTimer } from './useQuestionTimer';
import { QuestionTimerDisplay } from './QuestionTimer';

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
    const timer = useQuestionTimer();

    // Starts (or confirms) this question's clock whenever it becomes the
    // visible one in this one-question-at-a-time carousel. `timer.start` is
    // first-write-wins, so navigating back to an already-seen question does
    // not restart its clock.
    useEffect(() => {
      const activeId = cards[currentIndex]?.id;
      if (activeId) timer.start(activeId);
    }, [cards, currentIndex, timer]);

    async function commitAll() {
      // Grade every answered card once, on overall submit (sequential to be
      // gentle on the AI rate limit). Changing an answer before submitting
      // simply grades the final text once — no double grading.
      for (const card of cards) {
        const text = (answers[card.id] || '').trim();
        if (!text) continue;
        timer.stop(card.id);
        const res = await submitShortAnswer({
          attemptId,
          cardId: card.id,
          answer: text,
          latencyMs: timer.elapsed(card.id),
        });
        if (!res.success) showError(res.error || 'Failed to grade answer', res.detail);
      }
    }

    // The one expression for "how many did they answer" in this section: read
    // both by SectionNav's progress badge below and by the imperative handle
    // the container sums at submit. The `.trim()` mirrors commitAll's own skip
    // above — a box holding only whitespace is never submitted, so it must not
    // count as an answer either, or a wholly blank quiz would look answered.
    function answeredCount() {
      return cards.filter(c => (answers[c.id] || '').trim()).length;
    }

    // `answers` is in the dep array, so the handle is rebuilt on every
    // keystroke and never reports a stale count. Verified deliberately: a
    // stale 0 would let the container discard an attempt the learner took.
    useImperativeHandle(ref, () => ({ commitAll, answeredCount }), [cards, answers, attemptId]);

    function goNext() {
      const activeId = cards[currentIndex]?.id;
      if (activeId && (answers[activeId] || '').trim()) timer.stop(activeId);
      setCurrentIndex(i => Math.min(i + 1, cards.length - 1));
    }

    function goPrev() {
      const activeId = cards[currentIndex]?.id;
      if (activeId && (answers[activeId] || '').trim()) timer.stop(activeId);
      setCurrentIndex(i => Math.max(i - 1, 0));
    }

    const card = cards[currentIndex];
    if (!card) return <div className="text-center p-10">No cards available for this quiz.</div>;

    return (
      <div className="max-w-xl mx-auto space-y-4">
        <CardComponent>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold">Question {currentIndex + 1}</span>
              <QuestionTimerDisplay timer={timer} cardId={card.id} />
            </div>
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
          answeredCount={answeredCount()}
          onPrev={goPrev}
          onNext={goNext}
        />
        {errorDialog}
      </div>
    );
  }
);
