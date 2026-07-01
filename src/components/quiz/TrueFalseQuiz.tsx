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
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [scores, setScores] = useState<number[]>([]);

  const currentCard = cards[currentIndex];

  if (!currentCard) {
    return <div className="text-center p-10">No cards available for this quiz.</div>;
  }

  async function handleAnswer(answer: string) {
    if (isSubmitting) return;

    setIsSubmitting(true);
    const result = await submitTrueFalseAnswer({
      attemptId,
      cardId: currentCard.id,
      selectedOption: answer,
    });

    if (result.success && result.data) {
      const newScores = [...scores, result.data.score];
      setScores(newScores);

      if (currentIndex < cards.length - 1) {
        setCurrentIndex(i => i + 1);
        setIsSubmitting(false); // Reset for next question
      } else {
        const avg = newScores.reduce((a, b) => a + b, 0) / newScores.length;
        onFinish(Math.round(avg));
        // Keep isSubmitting true to prevent double onFinish
      }
    } else {
      setIsSubmitting(false);
      toast.error(result.error || 'Failed to submit answer');
    }
  }

  return (
    <CardUI className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="text-lg">Question {currentIndex + 1} of {cards.length}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-center">
        <div className="p-4 bg-muted rounded-lg space-y-2">
          <p className="font-bold text-sm text-muted-foreground uppercase tracking-wider">Term</p>
          <p className="text-xl font-medium">{currentCard.term}</p>
          <div className="h-px bg-border my-2" />
          <p className="font-bold text-sm text-muted-foreground uppercase tracking-wider">Definition</p>
          <p className="text-lg">{currentCard.definition}</p>
        </div>

        <p className="text-sm text-muted-foreground">Is this the correct definition?</p>

        <div className="flex justify-center gap-4">
          {["true", "false"].map((val) => (
            <Button
              key={val}
              variant="outline"
              onClick={() => handleAnswer(val)}
              disabled={isSubmitting}
              className={cn(
                "px-8 capitalize transition-all",
                isSubmitting && "opacity-50"
              )}
            >
              {val}
              {isSubmitting && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
            </Button>
          ))}
        </div>
      </CardContent>
    </CardUI>
  );
}
