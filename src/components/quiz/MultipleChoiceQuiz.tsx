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
  const [selectedAnswers, setSelectedAnswers] = useState<{ [cardId: string]: string }>({});
  const [optionsState, setOptionsState] = useState<{ [cardId: string]: { options: string[], correctAnswer: string } }>({});
  const [loadingCards, setLoadingCards] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    async function loadAllOptions() {
      const loadPromises = cards.map(async (card) => {
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

      await Promise.all(loadPromises);
    }
    loadAllOptions();
  }, [cards]);

  async function handleFinish() {
    if (Object.keys(selectedAnswers).length < cards.length) {
      toast.error('Please answer all questions before submitting');
      return;
    }

    setIsSubmitting(true);
    try {
      const results = await Promise.all(
        cards.map(async (card) => {
          const data = optionsState[card.id];
          if (!data) return { score: 0 };

          const res = await submitMultipleChoiceAnswer({
            attemptId,
            cardId: card.id,
            selectedOption: selectedAnswers[card.id],
            correctAnswer: data.correctAnswer,
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
        <h2 className="text-2xl font-bold">Multiple Choice Quiz</h2>
        <Button
          onClick={handleFinish}
          disabled={isSubmitting || Object.keys(selectedAnswers).length < cards.length}
        >
          {isSubmitting ? <Loader2 className="animate-spin w-4 h-4 mr-2" /> : null}
          Submit Quiz
        </Button>
      </div>

      <div className="space-y-8">
        {cards.map((card, index) => {
          const data = optionsState[card.id];
          const isLoading = loadingCards.has(card.id);

          return (
            <CardComponent key={card.id} className="space-y-4">
              <CardHeader>
                <CardTitle>Question {index + 1}: {card.term}</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading || !data ? (
                  <div className="flex items-center gap-2 text-muted-foreground py-4">
                    <Loader2 className="animate-spin w-4 h-4" />
                    <span>Generating options...</span>
                  </div>
                ) : (
                  <RadioGroup
                    value={selectedAnswers[card.id] || ""}
                    onValueChange={(val) => setSelectedAnswers(prev => ({ ...prev, [card.id]: val }))}
                    disabled={isSubmitting}
                    className="space-y-3"
                  >
                    {data.options.map((opt, idx) => (
                      <div key={idx} className="flex items-start space-x-2 border p-3 rounded transition-all hover:bg-muted/50 whitespace-normal">
                        <RadioGroupItem value={opt} id={`${card.id}-opt-${idx}`} className="mt-1" />
                        <Label
                          htmlFor={`${card.id}-opt-${idx}`}
                          className={cn(
                            "flex-1 cursor-pointer leading-relaxed",
                            selectedAnswers[card.id] === opt ? "font-semibold text-primary" : "text-muted-foreground",
                            isSubmitting && "opacity-50"
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
          );
        })}
      </div>
    </div>
  );
}
