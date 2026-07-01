'use client';

import React, { useState, useEffect } from 'react';
import { Card as CardComponent, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { getOrGenerateMultipleChoiceOptions, submitMultipleChoiceAnswer } from '@/actions/quiz';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Card } from '@prisma/client';
import { cn } from '@/lib/utils';

interface MultipleChoiceQuizProps {
  cards: Card[];
  attemptId: string;
  onFinish: (score: number) => void;
}

export function MultipleChoiceQuiz({ cards, attemptId, onFinish }: MultipleChoiceQuizProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [optionsState, setOptionsState] = useState<{ [cardId: string]: { options: string[], correctAnswer: string } }>({});
  const [loadingCards, setLoadingCards] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [scores, setScores] = useState<number[]>([]);

  const currentCard = cards[currentIndex];

  useEffect(() => {
    if (!currentCard) return;
    if (optionsState[currentCard.id]) return;

    async function loadOptions() {
      setLoadingCards(prev => new Set(prev).add(currentCard.id));
      const result = await getOrGenerateMultipleChoiceOptions(currentCard.id);

      if (result.success && result.data) {
        const { options, correctAnswer } = result.data;
        setOptionsState(prev => ({
          ...prev,
          [currentCard.id]: { options, correctAnswer }
        }));
      } else {
        toast.error(`Failed to load options for ${currentCard.term}`);
      }
      setLoadingCards(prev => {
        const next = new Set(prev);
        next.delete(currentCard.id);
        return next;
      });
    }
    loadOptions();
  }, [currentCard, optionsState]);

  async function handleConfirm() {
    if (!selectedOption || isSubmitting) return;

    const data = optionsState[currentCard.id];
    if (!data) return;

    setIsSubmitting(true);
    const result = await submitMultipleChoiceAnswer({
      attemptId,
      cardId: currentCard.id,
      selectedOption,
      correctAnswer: data.correctAnswer,
    });
    setIsSubmitting(false);

    if (result.success && result.data) {
      const newScores = [...scores, result.data.score];
      setScores(newScores);

      if (currentIndex < cards.length - 1) {
        setCurrentIndex(i => i + 1);
        setSelectedOption(null);
      } else {
        const avg = newScores.reduce((a, b) => a + b, 0) / newScores.length;
        onFinish(Math.round(avg));
      }
    } else {
      toast.error(result.error || 'Failed to submit answer');
    }
  }

  if (!currentCard) {
    return <div className="text-center p-10">No cards available for this quiz.</div>;
  }

  const data = optionsState[currentCard.id];

  if (!data || loadingCards.has(currentCard.id)) {
    return (
      <CardComponent className="max-w-xl mx-auto p-6 flex justify-center">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="animate-spin w-4 h-4" />
          <span>Generating options for {currentCard.term}...</span>
        </div>
      </CardComponent>
    );
  }

  return (
    <CardComponent className="max-w-xl mx-auto space-y-4">
      <CardHeader>
        <CardTitle>Question {currentIndex + 1} of {cards.length}: {currentCard.term}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <RadioGroup
          value={selectedOption || ""}
          onValueChange={(val) => setSelectedOption(val)}
          disabled={isSubmitting}
        >
          {data.options.map((opt, idx) => (
            <div key={idx} className="flex items-center space-x-2 border p-3 rounded hover:bg-muted transition-colors">
              <RadioGroupItem value={opt} id={`${currentCard.id}-opt-${idx}`} />
              <Label
                htmlFor={`${currentCard.id}-opt-${idx}`}
                className={cn(
                  "flex-1 cursor-pointer",
                  selectedOption === opt && "font-semibold text-primary"
                )}
              >
                {opt}
              </Label>
            </div>
          ))}
        </RadioGroup>

        <div className="flex justify-end">
          <Button
            onClick={handleConfirm}
            disabled={!selectedOption || isSubmitting}
            className="px-8"
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
    </CardComponent>
  );
}
