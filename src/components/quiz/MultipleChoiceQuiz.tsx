'use client';

import React, { useState, useEffect } from 'react';
import { Card as CardComponent, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { getOrGenerateMultipleChoiceOptions } from '@/actions/quiz';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Card } from '@prisma/client';

interface MultipleChoiceQuizProps {
  cards: Card[];
  onAnswer: (cardId: string, option: string) => void;
  answers: { [key: string]: string };
}

export function MultipleChoiceQuiz({ cards, onAnswer, answers }: MultipleChoiceQuizProps) {
  const [optionsState, setOptionsState] = useState<{ [cardId: string]: { options: string[], correctAnswer: string } }>({});
  const [loadingCards, setLoadingCards] = useState<Set<string>>(new Set());

  useEffect(() => {
    cards.forEach(async (card) => {
      if (optionsState[card.id]) return;

      setLoadingCards(prev => new Set(prev).add(card.id));
      const result = await getOrGenerateMultipleChoiceOptions(card.id);

      if (result.success && result.data) {
        const { options, correctAnswer } = result.data;
        setOptionsState(prev => ({
          ...prev,
          [card.id]: { options, correctAnswer }
        }));
      } else {
        toast.error(`Failed to load options for ${card.term}`);
      }
      setLoadingCards(prev => {
        const next = new Set(prev);
        next.delete(card.id);
        return next;
      });
    });
  }, [cards]);

  return (
    <div className="space-y-8">
      {cards.map((card, i) => {
        const data = optionsState[card.id];

        if (!data) {
          return (
            <CardComponent key={card.id} className="max-w-xl mx-auto p-6 flex justify-center">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="animate-spin w-4 h-4" />
                <span>Generating options for {card.term}...</span>
              </div>
            </CardComponent>
          );
        }

        return (
          <CardComponent key={card.id} className="max-w-xl mx-auto space-y-4">
            <CardHeader>
              <CardTitle>Question {i + 1}: {card.term}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <RadioGroup
                value={answers[card.id]}
                onValueChange={(val) => onAnswer(card.id, val)}
              >
                {data.options.map((opt, idx) => (
                  <div key={idx} className="flex items-center space-x-2 border p-3 rounded hover:bg-muted">
                    <RadioGroupItem value={opt} id={`${card.id}-opt-${idx}`} />
                    <Label htmlFor={`${card.id}-opt-${idx}`}>{opt}</Label>
                  </div>
                ))}
              </RadioGroup>
            </CardContent>
          </CardComponent>
        );
      })}
    </div>
  );
}
