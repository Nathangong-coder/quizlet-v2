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
import { GradeCard } from './GradeCard';

interface MultipleChoiceQuizProps {
  cards: Card[];
  attemptId: string;
  onFinish: (score: number) => void;
}

export function MultipleChoiceQuiz({ cards, attemptId, onFinish }: MultipleChoiceQuizProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [options, setOptions] = useState<string[]>([]);
  const [correctAnswer, setCorrectAnswer] = useState<string>('');
  const [selectedOption, setSelectedOption] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [score, setScore] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);

  const currentCard = cards[currentIndex];

  if (!currentCard) {
    return <div className="text-center p-10">No cards available for this quiz.</div>;
  }

  useEffect(() => {
    async function loadOptions() {
      setIsLoading(true);
      setFeedback(null);
      const result = await getOrGenerateMultipleChoiceOptions(currentCard.id);
      if (result.success && result.data) {
        setOptions(result.data.options);
        setCorrectAnswer(result.data.correctAnswer);
      } else {
        toast.error(result.error || 'Failed to load options');
      }
      setIsLoading(false);
    }
    loadOptions();
  }, [currentCard]);

  async function handleSubmit() {
    if (!selectedOption) return;

    setIsSubmitting(true);
    const result = await submitMultipleChoiceAnswer({
      attemptId,
      cardId: currentCard.id,
      selectedOption,
      correctAnswer,
    });
    setIsSubmitting(false);

    if (result.success && result.data) {
      if (result.data.isCorrect) {
        setScore(s => s + 1);
      }

      if (currentIndex < cards.length - 1) {
        setCurrentIndex(i => i + 1);
        setSelectedOption('');
      } else {
        const finalScore = score + (result.data.isCorrect ? 1 : 0);
        const percentage = Math.round((finalScore / cards.length) * 100);
        onFinish(percentage);
      }
    } else {
      toast.error('Failed to submit answer');
    }
  }

  if (isLoading) return <div className="flex justify-center p-10"><Loader2 className="animate-spin w-8 h-8" /></div>;

  return (
    <CardComponent className="max-w-xl mx-auto space-y-4">
      <CardHeader>
        <CardTitle>{currentCard.term}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <RadioGroup value={selectedOption} onValueChange={setSelectedOption}>
          {options.map((opt, i) => (
            <div key={i} className="flex items-center space-x-2 border p-3 rounded hover:bg-muted">
              <RadioGroupItem value={opt} id={`opt-${i}`} />
              <Label htmlFor={`opt-${i}`}>{opt}</Label>
            </div>
          ))}
        </RadioGroup>
        <Button onClick={handleSubmit} disabled={isSubmitting || !selectedOption}>
          {isSubmitting ? <Loader2 className="animate-spin w-4 h-4 mr-2" /> : 'Submit'}
        </Button>
      </CardContent>
    </CardComponent>
  );
}
