'use client';

import React, { useState } from 'react';
import { Card as CardUI, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Card as PrismaCard } from '@prisma/client';
import { submitTrueFalseAnswer } from '@/actions/quiz';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TrueFalseQuizProps {
  cards: PrismaCard[];
  attemptId: string;
  onFinish: (score: number) => void;
}

export function TrueFalseQuiz({ cards, attemptId, onFinish }: TrueFalseQuizProps) {
  const [selectedAnswers, setSelectedAnswers] = useState<{ [cardId: string]: string }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleFinish() {
    if (Object.keys(selectedAnswers).length < cards.length) {
      toast.error('Please answer all questions before submitting');
      return;
    }

    setIsSubmitting(true);
    try {
      const results = await Promise.all(
        cards.map(async (card) => {
          const res = await submitTrueFalseAnswer({
            attemptId,
            cardId: card.id,
            selectedOption: selectedAnswers[card.id],
          });
          return res.success && res.data ? { score: res.data.score } : { score: 0 };
        })
      );

      const avgScore = results.reduce((a, b) => a + b.score, 0) / results.length;
      onFinish(Math.round(avgScore));
    } catch (error) {
      toast.error('Failed to submit quiz');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8 p-4">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">True/False Quiz</h2>
        <Button
          onClick={handleFinish}
          disabled={isSubmitting || Object.keys(selectedAnswers).length < cards.length}
        >
          {isSubmitting ? <Loader2 className="animate-spin w-4 h-4 mr-2" /> : null}
          Submit Quiz
        </Button>
      </div>

      <div className="space-y-8">
        {cards.map((card, index) => (
          <CardUI key={card.id} className="space-y-4">
            <CardHeader>
              <CardTitle>Question {index + 1}: {card.term}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 text-center">
              <div className="p-4 bg-muted rounded-lg space-y-2 text-left">
                <p className="font-bold text-sm text-muted-foreground uppercase tracking-wider">Definition</p>
                <p className="text-lg">{card.definition}</p>
              </div>

              <p className="text-sm text-muted-foreground text-center">Is this the correct definition?</p>

              <div className="flex justify-center gap-4">
                {["true", "false"].map((val) => (
                  <Button
                    key={val}
                    variant={selectedAnswers[card.id] === val ? "default" : "outline"}
                    onClick={() => setSelectedAnswers(prev => ({ ...prev, [card.id]: val }))}
                    disabled={isSubmitting}
                    className={cn(
                      "px-8 capitalize transition-all",
                      selectedAnswers[card.id] === val && "bg-primary text-primary-foreground",
                      isSubmitting && "opacity-50"
                    )}
                  >
                    {val}
                  </Button>
                ))}
              </div>
            </CardContent>
          </CardUI>
        ))}
      </div>
    </div>
  );
}
