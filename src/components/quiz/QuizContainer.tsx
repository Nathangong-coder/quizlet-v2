'use client';

import React, { useState, useEffect, useRef } from 'react';
import { MultipleChoiceQuiz } from './MultipleChoiceQuiz';
import { ShortAnswerQuiz } from './ShortAnswerQuiz';
import { TrueFalseQuiz } from './TrueFalseQuiz';
import { MatchingQuiz } from './MatchingQuiz';
import { QuizSummary } from './QuizSummary';
import { QuizSkippedNotice } from './QuizSkippedNotice';
import { QuizSectionHandle } from './section';
import { Card } from '@prisma/client';
import { discardSkippedQuizAttempt, getQuizAttemptCards, startQuizAttempt } from '@/actions/quiz';
import { finishStudySession, generateSessionInsight } from '@/actions/study-session';
import { Loader2, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export function QuizContainer({ setId, cards: allCards, setup }: { setId: string, cards: Card[], setup?: any }) {
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [selectedCards, setSelectedCards] = useState<Card[]>([]);
  const [isLoadingCards, setIsLoadingCards] = useState(true);
  const [finished, setFinished] = useState(false);
  // Set only when the server actually discarded the attempt — never inferred
  // from the client's own count, which is an intent signal and not authority.
  const [skipped, setSkipped] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One imperative handle per rendered section, so the single overall-submit
  // button can flush every section's currently-visible answer at once.
  const sectionRefs = useRef<(QuizSectionHandle | null)[]>([]);

  // Guards startQuizAttempt against firing twice (e.g. React Strict Mode's
  // dev-only double-invoke of effects) before the first setAttemptId commits.
  // A ref, not state, so the check-and-set is synchronous — set before the
  // first await inside startAttempt, exactly like Tasks 12/13's session-open
  // guards. Each duplicate call would otherwise mint its own StudySession as
  // well as its own QuizAttempt, and the former is visible in the activity
  // feed. There is no in-place "start a new quiz" path in this component
  // (both "Back to Set" and "Try Again" fully remount via navigation/reload),
  // so this guard never needs to be reset.
  const startingRef = useRef(false);

  useEffect(() => {
    if (setup && !attemptId && !error) {
      if (startingRef.current) return;
      startingRef.current = true;
      async function startAttempt() {
        setIsLoadingCards(true);
        const modes = setup.questionMode || ['multiple-choice'];
        const result = await startQuizAttempt(setId, modes, setup);
        if (result.success) {
          setAttemptId(result.data.attemptId);
          setSessionId(result.data.sessionId);
        } else {
          setError(result.error || 'Failed to start quiz');
          setIsLoadingCards(false);
          toast.error(result.error || 'Failed to start quiz');
        }
      }
      startAttempt();
    }
  }, [setup, setId, attemptId, error]);

  useEffect(() => {
    if (attemptId) {
      async function loadCards() {
        setIsLoadingCards(true);
        const result = await getQuizAttemptCards(attemptId as string);
        if (result.success) {
          setSelectedCards(result.data.cards);
        } else {
          setError(result.error || 'Failed to load cards');
        }
        setIsLoadingCards(false);
      }
      loadCards();
    }
  }, [attemptId]);

  async function handleSubmitQuiz() {
    setIsSubmitting(true);

    // STEP 1 — grade. Its outcome is tracked in its own flag rather than
    // sharing one `try` with everything below, because a grading crash and a
    // skipped quiz must never be confused: see step 2.
    let gradingFailed = false;
    try {
      // Grade every section's answers exactly once, here at submit time.
      // Sections run in parallel; each grades its answered questions.
      await Promise.all(
        sectionRefs.current.map((r) => (r ? r.commitAll() : Promise.resolve())),
      );
    } catch (e) {
      gradingFailed = true;
      toast.error('Something went wrong grading your answers');
    }

    // STEP 2 — a quiz submitted with nothing answered leaves no trace.
    //
    // Skipped ONLY when grading did not throw. A commitAll exception means the
    // answers the learner gave never reached the server, so the attempt is
    // zero-answer for a reason that has nothing to do with intent — calling
    // that "Quiz Skipped" would hide a real defect behind a message saying
    // they did nothing. (`discardSkippedQuizAttempt`'s condition 1 guards the
    // quieter version of the same failure: individual answer errors call
    // `showError` and continue, so they never reach this catch at all.)
    //
    // Its own `try`, deliberately: a discard failure is not a grading failure
    // and must not surface as "Something went wrong grading your answers". It
    // degrades to the ordinary results screen — the attempt simply lingers,
    // and ANSWERED_ATTEMPT_WHERE hides it from history, which is the whole
    // point of hiding rather than deleting.
    let discarded = false;
    if (!gradingFailed && attemptId) {
      try {
        const clientAnsweredCount = sectionRefs.current.reduce(
          (sum, r) => sum + (r ? r.answeredCount() : 0),
          0,
        );
        const result = await discardSkippedQuizAttempt({ attemptId, clientAnsweredCount });
        // A refusal is `success: true` with `discarded: false` — a normal
        // outcome, not an error. Anything that is not an actual discard falls
        // through to today's path.
        discarded = result.success && result.data.discarded;
      } catch (e) {
        console.error('Failed to discard skipped quiz attempt', e);
      }
    }

    // STEP 3 — today's path, unchanged, except that a discarded attempt skips
    // it entirely: the StudySession is being deleted along with the attempt,
    // so closing it first is wasted work and generating an AI narrative about
    // a quiz that no longer exists is worse.
    if (!discarded && !gradingFailed && sessionId) {
      try {
        const finishResult = await finishStudySession({ sessionId });
        if (!finishResult.success) {
          toast.error(finishResult.error || 'Failed to close study session');
        }
        // Fire-and-forget: the summary renders from the computed block
        // immediately, and the AI narrative appears on refresh if it lands.
        // A failed generation must never block the results screen.
        generateSessionInsight({ sessionId }).catch(() => {});
      } catch {
        toast.error('Something went wrong grading your answers');
      }
    }

    setSkipped(discarded);
    setIsSubmitting(false);
    setFinished(true);
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto py-20 text-center space-y-6">
        <div className="bg-destructive/10 p-6 rounded-xl border border-destructive/20">
          <h2 className="text-xl font-bold text-destructive mb-2">Quiz Error</h2>
          <p className="text-muted-foreground">{error}</p>
        </div>
        <Button onClick={() => window.location.reload()} variant="outline">
          Try Again / Change Settings
        </Button>
      </div>
    );
  }

  // Before the general `finished` branch: QuizSummary would fetch an attempt
  // that has just been deleted.
  if (finished && skipped) {
    return <QuizSkippedNotice setId={setId} />;
  }

  if (finished) {
    return <QuizSummary score={0} setId={setId} attemptId={attemptId!} />;
  }

  if (isSubmitting) return <div className="flex flex-col items-center justify-center p-20 gap-4">
    <Loader2 className="animate-spin w-12 h-12 text-primary" />
    <p className="text-lg font-medium">Grading your quiz...</p>
    <p className="text-muted-foreground animate-pulse text-sm">Scoring answers and generating feedback. This can take a moment.</p>
  </div>;

  if (isLoadingCards) return <div className="flex flex-col items-center justify-center p-20 gap-4">
    <Loader2 className="animate-spin w-12 h-12 text-primary" />
    <p className="text-muted-foreground animate-pulse">Building your personalized quiz...</p>
  </div>;

  const modes: string[] = setup?.questionMode || ['multiple-choice'];

  // Build exactly `questionCount` total questions, spread as evenly as possible
  // across the selected sections. A card may be reused across DIFFERENT modes
  // (e.g. tested once as MC and once as True/False) so the requested count is
  // reachable even when the set has few distinct cards — but never repeated
  // within a single mode. This makes "8 questions, 4 sections" give 2 per
  // section instead of 3 total, while still never exceeding what was asked for.
  const pool = selectedCards;
  const nModes = modes.length;
  const requested = Math.max(1, setup?.questionCount ?? pool.length);
  // Ceiling: each mode can hold at most `pool.length` distinct cards.
  const total = Math.min(requested, nModes * pool.length);

  const perMode = modes.map((_, i) => {
    const base = Math.floor(total / nModes);
    return base + (i < total % nModes ? 1 : 0);
  });

  let offset = 0;
  const cardsByMode: Card[][] = modes.map((_, i) => {
    const want = Math.min(perMode[i], pool.length); // no repeats within a mode
    const arr: Card[] = [];
    for (let k = 0; k < want && pool.length > 0; k++) {
      arr.push(pool[(offset + k) % pool.length]);
    }
    offset += want; // rotate so different modes tend to draw different cards
    return arr;
  });

  const registerRef = (el: QuizSectionHandle | null, index: number) => {
    sectionRefs.current[index] = el;
  };

  return (
    <div className="max-w-4xl mx-auto space-y-12 py-8 px-4">
      <div className="text-center space-y-2 mb-8">
        <h1 className="text-3xl font-bold">Your Quiz</h1>
        <p className="text-muted-foreground">Answer what you can, then submit whenever you're ready.</p>
        <div className="flex justify-center pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.open(`/sets/${setId}/print?attemptId=${attemptId}`, '_blank')}
          >
            <Printer className="w-4 h-4 mr-2" /> Print this test (PDF)
          </Button>
        </div>
      </div>

      <div className="space-y-16">
        {modes.map((mode: string, index: number) => {
          const modeCards = cardsByMode[index];

          if (modeCards.length === 0) return null;

          return (
            <section key={mode} className="space-y-4">
              <div className="flex items-center gap-4 border-b pb-2">
                <h2 className="text-xl font-semibold capitalize">
                  {mode.replace('-', ' ')} Section
                </h2>
              </div>

              <div className="bg-card rounded-xl p-1">
                {mode === 'multiple-choice' && (
                  <MultipleChoiceQuiz
                    ref={(el) => registerRef(el, index)}
                    cards={modeCards}
                    attemptId={attemptId!}
                  />
                )}
                {mode === 'short-answer' && (
                  <ShortAnswerQuiz
                    ref={(el) => registerRef(el, index)}
                    cards={modeCards}
                    attemptId={attemptId!}
                  />
                )}
                {mode === 'true-false' && (
                  <TrueFalseQuiz
                    ref={(el) => registerRef(el, index)}
                    cards={modeCards}
                    attemptId={attemptId!}
                  />
                )}
                {mode === 'matching' && (
                  <MatchingQuiz
                    ref={(el) => registerRef(el, index)}
                    cards={modeCards}
                    attemptId={attemptId!}
                  />
                )}
              </div>
            </section>
          );
        })}
      </div>

      <div className="flex flex-col items-center justify-center py-8 space-y-4">
        <Button
          onClick={handleSubmitQuiz}
          disabled={isSubmitting}
          size="lg"
          className="px-12 py-6 text-xl font-bold bg-primary hover:bg-primary/90 transition-all hover:scale-105 active:scale-95 shadow-xl"
        >
          {isSubmitting && <Loader2 className="animate-spin w-5 h-5 mr-2" />}
          Submit Overall Quiz
        </Button>
        <p className="text-xs text-muted-foreground text-center max-w-sm">
          You can submit at any time. A quiz with nothing answered isn&apos;t saved
          to your history.
        </p>
      </div>
    </div>
  );
}
