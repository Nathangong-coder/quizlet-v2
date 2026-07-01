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
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [scores, setScores] = useState<number[]>([]);

  const currentCard = cards[currentIndex];

  if (!currentCard) {
    return <div className="text-center p-10">No cards available for this quiz.</div>;
  }

  async function handleConfirm() {
    if (!selectedOption || isSubmitting) return;

    setIsSubmitting(true);
    const result = await submitTrueFalseAnswer({
      attemptId,
      cardId: currentCard.id,
      selectedOption,
    });

    if (result.success && result.data) {
      const newScores = [...scores, result.data.score];
      setScores(newScores);

      if (currentIndex < cards.length - 1) {
        setCurrentIndex(i => i + 1);
        setSelectedOption(null);
        setIsSubmitting(false);
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
      <CardContent className="space-y-6 text-center">
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
              variant={selectedOption === val ? "default" : "outline"}
              onClick={() => setSelectedOption(val)}
              disabled={isSubmitting}
              className={cn(
                "px-8 capitalize transition-all",
                selectedOption === val && "bg-primary text-primary-foreground",
                isSubmitting && "opacity-50"
              )}
            >
              {val}
            </Button>
          ))}
        </div>

        <div className="flex justify-center pt-4">
          <Button
            onClick={handleConfirm}
            disabled={!selectedOption || isSubmitting}
            className="px-12"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="animate-spin w-4 h-4 mr-2" />
                Submitting...
              </>
            ) : (
              'Confirm Answer'
            )}
          </Button>
        </div>
      </CardContent>
    </CardUI>
  );
}
