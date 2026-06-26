'use client';

import React, { useState } from 'react';
import { QuizModePicker } from './QuizModePicker';
import { MultipleChoiceQuiz } from './MultipleChoiceQuiz';
import { ShortAnswerQuiz } from './ShortAnswerQuiz';
import { Card } from '@prisma/client';

export function QuizContainer({ setId, cards }: { setId: string, cards: Card[] }) {
  const [mode, setMode] = useState<'multiple-choice' | 'short-answer' | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [score, setScore] = useState<number | null>(null);

  if (finished) {
    return (
      <div className="text-center p-10 border rounded-lg">
        <h2 className="text-2xl font-bold">Quiz Finished!</h2>
        <p className="text-xl mt-2">Your score: {score}%</p>
        <a href={`/sets/${setId}`} className="mt-6 inline-block text-primary hover:underline">Back to Set</a>
      </div>
    );
  }

  if (!mode) {
    return <QuizModePicker setId={setId} onModeSelect={(m, id) => { setMode(m); setAttemptId(id); }} />;
  }

  return mode === 'multiple-choice' ? (
    <MultipleChoiceQuiz cards={cards} attemptId={attemptId!} onFinish={(s) => { setScore(s); setFinished(true); }} />
  ) : (
    <ShortAnswerQuiz cards={cards} attemptId={attemptId!} onFinish={(s) => { setScore(s); setFinished(true); }} />
  );
}
