'use client';

import React, { useState } from 'react';
import { Card as CardComponent, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { submitShortAnswer } from '@/actions/quiz';
import { GradeCard } from './GradeCard';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Card } from '@prisma/client';

interface ShortAnswerQuizProps {
  cards: Card[];
  attemptId: string;
  onFinish: (score: number) => void;
}

export function ShortAnswerQuiz({ cards, attemptId, onFinish }: ShortAnswerQuizProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [grade, setGrade] = useState<any>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [totalScore, setTotalScore] = useState(0);
  const [scores, setScores] = useState<number[]>([]);

  const currentCard = cards[currentIndex];

  if (!currentCard) {
    return <div className="text-center p-10">No cards available for this quiz.</div>;
  }

  async function handleSubmit() {
    if (!answer.trim()) return;

    setIsSubmitting(true);
    const result = await submitShortAnswer({
      attemptId,
      cardId: currentCard.id,
      answer,
    });
    setIsSubmitting(false);

    if (result.success && result.data) {
      setScores(s => [...s, result.data!.score]);
      if (currentIndex < cards.length - 1) {
        setAnswer('');
        setCurrentIndex(i => i + 1);
      } else {
        const scoresToAverage = [...scores, result.data.score];
        const avg = scoresToAverage.reduce((a, b) => a + b, 0) / scoresToAverage.length;
        onFinish(Math.round(avg));
      }
    } else {
      toast.error(result.error || 'Failed to grade');
    }
  }

  return (
    <CardComponent className="max-w-xl mx-auto">
      <CardHeader>
        <CardTitle>{currentCard.term}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <Textarea
          placeholder="Type your answer here..."
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          disabled={isSubmitting}
        />
        <Button onClick={handleSubmit} disabled={isSubmitting || !answer.trim()}>
          {isSubmitting ? <Loader2 className="animate-spin w-4 h-4 mr-2" /> : 'Submit Answer'}
        </Button>
      </CardContent>
    </CardComponent>
  );
}
