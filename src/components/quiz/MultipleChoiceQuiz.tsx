'use client';

import React, { useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { Card as CardComponent, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { getOrGenerateMultipleChoiceOptions, submitMultipleChoiceAnswer } from '@/actions/quiz';
import { Loader2 } from 'lucide-react';
import { Card } from '@prisma/client';
import { cn } from '@/lib/utils';
import { ContentBlock } from '@/lib/cards/content';
import { QuizCardPrompt } from './QuizCardPrompt';
import { QuizSectionHandle, SectionNav } from './section';
import { useErrorToast } from '@/components/errors/useErrorToast';
import { useQuestionTimer } from './useQuestionTimer';

type QuizCard = Card & { contentBlocks?: ContentBlock[] };

interface MultipleChoiceQuizProps {
  cards: QuizCard[];
  attemptId: string;
}

export const MultipleChoiceQuiz = forwardRef<QuizSectionHandle, MultipleChoiceQuizProps>(
  function MultipleChoiceQuiz({ cards, attemptId }, ref) {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [selectedAnswers, setSelectedAnswers] = useState<{ [cardId: string]: string }>({});
    const [optionsState, setOptionsState] = useState<{ [cardId: string]: { options: string[]; correctAnswer: string } }>({});
    const [loadingCards, setLoadingCards] = useState<Set<string>>(new Set());
    const { show: showError, dialog: errorDialog } = useErrorToast();
    const timer = useQuestionTimer();

    useEffect(() => {
      async function loadAllOptions() {
        const loadPromises = cards.map(async (card) => {
          if (optionsState[card.id]) return;

          setLoadingCards(prev => new Set(prev).add(card.id));
          const result = await getOrGenerateMultipleChoiceOptions(card.id, attemptId);

          if (result.success) {
            const { options, correctAnswer } = result.data;
            setOptionsState(prev => ({ ...prev, [card.id]: { options, correctAnswer } }));
          } else {
            showError(result.error || `Failed to load options for ${card.term}`, result.detail);
          }
          setLoadingCards(prev => {
            const next = new Set(prev);
            next.delete(card.id);
            return next;
          });
        });

        await Promise.all(loadPromises);
      }
      loadAllOptions();
    }, [cards]);

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
      // Graded once, on overall submit. Each card's answer replaces any prior
      // one server-side (deleteMany+create), so this is safe to call once.
      for (const card of cards) {
        const selected = selectedAnswers[card.id];
        const data = optionsState[card.id];
        if (!selected || !data) continue;
        const res = await submitMultipleChoiceAnswer({
          attemptId,
          cardId: card.id,
          selectedOption: selected,
          correctAnswer: data.correctAnswer,
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
    useImperativeHandle(ref, () => ({ commitAll, answeredCount }), [cards, selectedAnswers, optionsState, attemptId]);

    function goNext() {
      setCurrentIndex(i => Math.min(i + 1, cards.length - 1));
    }

    function goPrev() {
      setCurrentIndex(i => Math.max(i - 1, 0));
    }

    const card = cards[currentIndex];
    if (!card) return <div className="text-center p-10">No cards available for this quiz.</div>;

    const data = optionsState[card.id];
    const isLoading = loadingCards.has(card.id);

    return (
      <div className="max-w-2xl mx-auto space-y-4 p-4">
        <CardComponent className="space-y-4">
          <CardHeader>
            <CardTitle className="flex items-baseline gap-2">
              <span className="shrink-0">Question {currentIndex + 1}:</span>
            </CardTitle>
            <QuizCardPrompt card={card} side="term" />
          </CardHeader>
          <CardContent>
            {isLoading || !data ? (
              <div className="flex items-center gap-2 text-muted-foreground py-4">
                <Loader2 className="animate-spin w-4 h-4" />
                <span>Generating options...</span>
              </div>
            ) : (
              <RadioGroup
                value={selectedAnswers[card.id] || ''}
                onValueChange={(val) => setSelectedAnswers(prev => ({ ...prev, [card.id]: val }))}
                className="space-y-3"
              >
                {data.options.map((opt, idx) => (
                  <div key={idx} className="flex items-start space-x-2 border p-3 rounded transition-all hover:bg-muted/50 whitespace-normal">
                    <RadioGroupItem value={opt} id={`${card.id}-opt-${idx}`} className="mt-1" />
                    <Label
                      htmlFor={`${card.id}-opt-${idx}`}
                      className={cn(
                        'flex-1 cursor-pointer leading-relaxed',
                        selectedAnswers[card.id] === opt ? 'font-semibold text-primary' : 'text-muted-foreground',
                      )}
                    >
                      {opt}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            )}
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
