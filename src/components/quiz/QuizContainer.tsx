'use client';

import React, { useState, useEffect } from 'react';
import { QuizModePicker } from './QuizModePicker';
import { MultipleChoiceQuiz } from './MultipleChoiceQuiz';
import { ShortAnswerQuiz } from './ShortAnswerQuiz';
import { TrueFalseQuiz } from './TrueFalseQuiz';
import { MatchingQuiz } from './MatchingQuiz';
import { QuizSummary } from './QuizSummary';
import { Card } from '@prisma/client';
import { getQuizAttemptCards } from '@/actions/quiz';
import { Loader2 } from 'lucide-react';

export function QuizContainer({ setId, cards: allCards }: { setId: string, cards: Card[] }) {
  const [mode, setMode] = useState<'multiple-choice' | 'short-answer' | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [selectedCards, setSelectedCards] = useState<Card[]>([]);
  const [isLoadingCards, setIsLoadingCards] = useState(true);
  const [finished, setFinished] = useState(false);
  const [score, setScore] = useState<number | null>(null);

  useEffect(() => {
    if (attemptId) {
      async function loadCards() {
        setIsLoadingCards(true);
        const result = await getQuizAttemptCards(attemptId as string);
        if (result.success && result.data) {
          setSelectedCards(result.data.cards);
        }
        setIsLoadingCards(false);
      }
      loadCards();
    }
  }, [attemptId]);

  if (finished) {
    return <QuizSummary score={score || 0} setId={setId} attemptId={attemptId!} />;
  }

  if (!mode) {
    return <QuizModePicker setId={setId} onModeSelect={(m, id) => { setMode(m); setAttemptId(id); }} />;
  }

  if (isLoadingCards) return <div className="flex justify-center p-10"><Loader2 className="animate-spin w-8 h-8" /></div>;

  return mode === 'multiple-choice' ? (
    <MultipleChoiceQuiz cards={selectedCards} attemptId={attemptId!} onFinish={(s) => { setScore(s); setFinished(true); }} />
  ) : mode === 'short-answer' ? (
    <ShortAnswerQuiz cards={selectedCards} attemptId={attemptId!} onFinish={(s) => { setScore(s); setFinished(true); }} />
  ) : mode === 'true-false' ? (
    <TrueFalseQuiz cards={selectedCards} attemptId={attemptId!} onFinish={(s) => { setScore(s); setFinished(true); }} />
  ) : (
    <MatchingQuiz cards={selectedCards} attemptId={attemptId!} onFinish={(s) => { setScore(s); setFinished(true); }} />
  );
}
