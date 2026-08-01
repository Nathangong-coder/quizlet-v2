import { useRef } from 'react';
import { createQuestionTimer, type QuestionTimer } from '@/lib/quiz/question-timer';

/** Stable per-mount QuestionTimer. All logic lives in createQuestionTimer. */
export function useQuestionTimer(): QuestionTimer {
  const ref = useRef<QuestionTimer | null>(null);
  if (ref.current === null) ref.current = createQuestionTimer();
  return ref.current;
}
