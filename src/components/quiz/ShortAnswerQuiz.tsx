'use client';

import React, { useState, useRef, useImperativeHandle, forwardRef } from 'react';
import { Card as CardComponent, CardContent, CardHeader } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { submitShortAnswer } from '@/actions/quiz';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Card } from '@prisma/client';
import { ContentBlock } from '@/lib/cards/content';
import { QuizCardPrompt } from './QuizCardPrompt';
import { QuizSectionHandle, SectionNav } from './section';

type QuizCard = Card & { contentBlocks?: ContentBlock[] };

interface ShortAnswerQuizProps {
  cards: QuizCard[];
  attemptId: string;
}

export const ShortAnswerQuiz = forwardRef<QuizSectionHandle, ShortAnswerQuizProps>(
  function ShortAnswerQuiz({ cards, attemptId }, ref) {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [answers, setAnswers] = useState<{ [cardId: string]: string }>({});
    const [busy, setBusy] = useState(false);
    // Last answer text graded per card, so navigating back and forth doesn't
    // re-run the (expensive) AI grade unless the answer actually changed.
    const committedRef = useRef<{ [cardId: string]: string }>({});

    async function commitCard(index: number) {
      const card = cards[index];
      if (!card) return;
      const text = (answers[card.id] || '').trim();
      if (!text) return;
      if (committedRef.current[card.id] === text) return;

      const res = await submitShortAnswer({ attemptId, cardId: card.id, answer: text });
      if (res.success) {
        committedRef.current[card.id] = text;
      } else {
        toast.error(res.error || 'Failed to grade answer');
      }
    }

    useImperativeHandle(ref, () => ({
      commitCurrent: () => commitCard(currentIndex),
    }), [currentIndex, answers, attemptId]);

    async function goNext() {
      setBusy(true);
      await commitCard(currentIndex);
      setBusy(false);
      setCurrentIndex(i => Math.min(i + 1, cards.length - 1));
    }

    async function goPrev() {
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
              disabled={busy}
              className="min-h-[150px] py-4"
            />
            {busy && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="animate-spin w-4 h-4" /> Grading your answer...
              </div>
            )}
          </CardContent>
        </CardComponent>

        <SectionNav
          index={currentIndex}
          total={cards.length}
          answeredCount={answeredCount}
          onPrev={goPrev}
          onNext={goNext}
          busy={busy}
        />
      </div>
    );
  }
);
