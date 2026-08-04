'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Trophy, CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
import { getQuizAttemptSummary } from '@/actions/quiz';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { ExpandableText } from '@/components/ui/expandable-text';
import { QuizCardPrompt } from './QuizCardPrompt';
import { SessionInsightView } from '@/components/memory/SessionInsightView';
import { labelForErrorType, labelForKlpStatus } from '@/lib/errors/labels';

const MODE_LABELS: Record<string, string> = {
  'multiple-choice': 'Multiple Choice',
  'true-false': 'True/False',
  'short-answer': 'Short Answer',
  'matching': 'Matching',
};

interface QuizSummaryProps {
  /** Live score handed down by QuizContainer. Absent on the permalink, where
   *  the saved attempt is the source of truth. */
  score?: number;
  setId: string;
  attemptId: string;
}

function GradeFactor({ title, data }: { title: string, data: { score: number, pros: string[], cons: string[] } }) {
  const getBadgeVariant = (score: number) => {
    if (score >= 8) return 'default';
    if (score >= 5) return 'secondary';
    return 'destructive';
  };

  return (
    <div className="space-y-2 p-3 rounded-lg border bg-muted/30">
      <div className="flex justify-between items-center">
        <span className="font-semibold text-sm">{title}</span>
        <Badge variant={getBadgeVariant(data.score)}>{data.score}/10</Badge>
      </div>
      <div className="grid grid-cols-2 gap-4 text-xs">
        <div className="space-y-1">
          <span className="text-green-600 font-medium">Pros:</span>
          <ul className="list-disc pl-4 space-y-1">
            {data.pros.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
        <div className="space-y-1">
          <span className="text-red-600 font-medium">Cons:</span>
          <ul className="list-disc pl-4 space-y-1">
            {data.cons.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
      </div>
    </div>
  );
}

function MultipleChoiceResult({ options, selectedOption, correctAnswer }: { options: string[], selectedOption: string | null, correctAnswer: string }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {options.map((option: string, index: number) => {
        const isCorrect = option === correctAnswer;
        const isSelected = option === selectedOption;
        const isWrongSelection = isSelected && !isCorrect;

        return (
          <div
            key={index}
            className={cn(
              "p-3 rounded-md border text-sm transition-colors flex items-center justify-between",
              isCorrect ? "bg-green-50 border-green-500 text-green-900 dark:bg-green-900/20 dark:text-green-100" :
              isWrongSelection ? "bg-red-50 border-red-500 text-red-900 dark:bg-red-900/20 dark:text-red-100" :
              "bg-muted/50 border-transparent text-muted-foreground"
            )}
          >
            <span className="truncate">{option}</span>
            <div className="flex items-center gap-2 flex-shrink-0">
              {isCorrect && <Badge className="bg-green-600 hover:bg-green-600">Correct</Badge>}
              {isWrongSelection && <Badge variant="destructive">Your Answer</Badge>}
              {isSelected && isCorrect && <Badge variant="secondary">Your Answer</Badge>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * "No tags" must never read as "nothing wrong" for a degraded analysisStatus
 * — that's the one invariant this whole component exists to preserve on the
 * display side. `null` (a legacy, pre-Spec-2a answer) and `'analyzed'`
 * (a genuinely clean answer) both render nothing, on purpose.
 */
const DEGRADED_ANALYSIS_COPY: Record<string, string> = {
  no_provenance: "Detailed analysis wasn't available for this question.",
  no_klps: "This card's key points haven't been generated yet.",
  failed: 'Analysis failed for this answer.',
};

function AnalysisDegradedNote({ status }: { status: string | null }) {
  const text = status ? DEGRADED_ANALYSIS_COPY[status] : undefined;
  if (!text) return null;
  return <p className="text-xs text-muted-foreground italic">{text}</p>;
}

function KlpChecklist({ results }: { results: any[] }) {
  if (!results || results.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Key points tested</p>
      <ul className="space-y-1">
        {results.map((r, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            {r.status === 'passed' ? (
              <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
            ) : r.status === 'partial' ? (
              <MinusCircle className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            )}
            <span>
              <span className="text-muted-foreground">{labelForKlpStatus(r.status)}:</span>{' '}
              {r.klp?.text ?? 'this point'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const DIMENSION_BADGE_VARIANT: Record<string, 'destructive' | 'secondary' | 'outline'> = {
  accuracy: 'destructive',
  clarity: 'secondary',
  conciseness: 'outline',
};

function ErrorTagBadges({ tags }: { tags: any[] }) {
  if (!tags || tags.length === 0) return null;
  // Order only — significance is never shown as a raw number on the
  // per-answer card, to avoid over-interpreting a single data point.
  const sorted = [...tags].sort((a, b) => (b.significance ?? 0) - (a.significance ?? 0));
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">What went wrong</p>
      <div className="flex flex-wrap gap-3">
        {sorted.map((t, i) => (
          <div key={i} className="space-y-1 max-w-full">
            <Badge variant={DIMENSION_BADGE_VARIANT[t.dimension] ?? 'outline'}>
              {t.dimension}: {labelForErrorType(t.type)}
            </Badge>
            {t.quote && <ExpandableText text={t.quote} className="text-xs text-muted-foreground pl-1" />}
          </div>
        ))}
      </div>
    </div>
  );
}

function MatchingReview({ answers }: { answers: any[] }) {
  return (
    <div className="space-y-4">
      {answers.map((answer, i) => (
        <Card key={answer.id}>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="flex-1 font-medium">{answer.card.term}</div>
            <div className="flex-1">
              <div className={cn(
                "p-2 rounded-md border text-sm",
                answer.isCorrect ? "bg-green-50 border-green-500 text-green-900 dark:bg-green-900/20 dark:text-green-100" : "bg-red-50 border-red-500 text-red-900 dark:bg-red-900/20 dark:text-red-100"
              )}>
                <ExpandableText text={answer.selectedOption || "No match"} />
              </div>
              {!answer.isCorrect && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Correct: <ExpandableText text={answer.correctAnswer} className="font-medium" />
                </div>
              )}
            </div>
            <div className="flex-shrink-0">
              {answer.isCorrect ? <CheckCircle2 className="w-5 h-5 text-green-500" /> : <XCircle className="w-5 h-5 text-red-500" />}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function QuizSummary({ score, setId, attemptId }: QuizSummaryProps) {
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadSummary() {
      const result = await getQuizAttemptSummary(attemptId);
      if (result.success && result.data) {
        setSummary(result.data);
      }
      setLoading(false);
    }
    loadSummary();
  }, [attemptId]);

  if (loading) return <div className="text-center p-10">Generating summary...</div>;

  if (!summary) return <div className="text-center p-10">Failed to load quiz summary. Please try again.</div>;

  const attempt = summary.attempt;
  const correctCount = attempt.answers.filter((a: any) => a.isCorrect).length;
  const totalCount = attempt.answers.length;

  // Group answers by mode for a structured review
  const groupedAnswers = attempt.answers.reduce((acc: Record<string, any[]>, answer: any) => {
    const mode = answer.mode || 'unknown';
    if (!acc[mode]) acc[mode] = [];
    acc[mode].push(answer);
    return acc;
  }, {} as Record<string, any[]>);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Card>
        <CardHeader className="text-center">
          <div className="flex justify-center mb-2">
            <Trophy className="w-12 h-12 text-yellow-500" />
          </div>
          <CardTitle className="text-3xl font-bold">Quiz Results</CardTitle>
          <div className="text-6xl font-bold text-primary mt-4">{correctCount}/{totalCount}</div>
        </CardHeader>
      </Card>

      <Tabs defaultValue="review">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="summary">Overall Analysis</TabsTrigger>
          <TabsTrigger value="review">Individual Review</TabsTrigger>
        </TabsList>

        <TabsContent value="summary">
          {attempt.mode === 'short-answer' ? (
            <Card>
              <CardHeader>
                <CardTitle>AI-Powered Analysis</CardTitle>
              </CardHeader>
              <CardContent>
                <SessionInsightView
                  insight={summary.insight}
                  sessionId={summary.attempt.sessionId ?? null}
                  canGenerate
                />
                <Button
                  className="w-full mt-6"
                  onClick={() => window.location.href = `/sets/${setId}`}
                >
                  Back to Set
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Quiz Complete!</CardTitle>
              </CardHeader>
              <CardContent className="text-center space-y-4">
                <p className="text-muted-foreground">
                  You got {correctCount} out of {totalCount} questions correct.
                </p>
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    onClick={() => window.location.href = `/sets/${setId}`}
                  >
                    Back to Set
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => window.open(`/sets/${setId}/print?attemptId=${attemptId}`, '_blank')}
                  >
                    Print PDF
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="review">
          <div className="space-y-8">
            {(Object.entries(groupedAnswers) as [string, any[]][]).map(([mode, answers]) => (
              <div key={mode} className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b">
                  <h3 className="text-xl font-semibold">
                    {MODE_LABELS[mode] || mode}
                  </h3>
                  <Badge variant="outline">{answers.length}</Badge>
                </div>
                <div className="space-y-4">
                  {mode === 'matching' ? (
                    <MatchingReview answers={answers} />
                  ) : (
                    answers.map((answer: any, index: number) => (
                      <Card key={answer.id}>
                        <CardHeader>
                          <CardTitle className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              {answer.isCorrect ? <CheckCircle2 className="text-green-500 shrink-0" /> : <XCircle className="text-red-500 shrink-0" />}
                              <span className="font-medium shrink-0">Question {index + 1}</span>
                            </div>
                            {answer.grade && (
                              <Badge variant={answer.grade.overall >= 8 ? 'default' : answer.grade.overall >= 5 ? 'secondary' : 'destructive'}>
                                AI Grade: {answer.grade.overall}/10
                              </Badge>
                            )}
                          </CardTitle>
                          {/* Render the actual prompt (incl. images) rather than raw term text */}
                          <div className="pt-2">
                            <QuizCardPrompt card={answer.card} side="term" />
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-6">
                          {answer.mode === 'multiple-choice' && answer.options ? (
                            <MultipleChoiceResult
                              options={answer.options}
                              selectedOption={answer.selectedOption}
                              correctAnswer={answer.correctAnswer}
                            />
                          ) : answer.mode === 'true-false' ? (
                            <MultipleChoiceResult
                              options={['True', 'False']}
                              selectedOption={answer.selectedOption === 'true' ? 'True' : answer.selectedOption === 'false' ? 'False' : null}
                              correctAnswer={answer.correctAnswer === 'true' ? 'True' : 'False'}
                            />
                          ) : (
                            <div className="grid grid-cols-2 gap-4">
                              <div className="p-4 bg-muted rounded-md">
                                <p className="font-semibold text-sm">Correct Answer</p>
                                <p>{answer.correctAnswer}</p>
                              </div>
                              <div className="p-4 bg-muted rounded-md">
                                <p className="font-semibold text-sm">Your Answer</p>
                                <p>{answer.answer || answer.selectedOption}</p>
                              </div>
                            </div>
                          )}

                          <AnalysisDegradedNote status={answer.analysisStatus} />
                          <KlpChecklist results={answer.klpResults ?? []} />
                          <ErrorTagBadges tags={answer.errorTags ?? []} />

                          {answer.grade ? (
                            <div className="space-y-4 pt-4 border-t">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <GradeFactor title="Clarity" data={answer.grade.clarity} />
                                <GradeFactor title="Conciseness" data={answer.grade.conciseness} />
                                <GradeFactor title="Correctness" data={answer.grade.correctness} />
                              </div>
                              <div className="p-3 rounded-lg border bg-primary/5 space-y-2">
                                <h4 className="font-semibold text-sm">AI Summary</h4>
                                <p className="text-sm text-muted-foreground">{answer.grade.summary}</p>
                              </div>
                              <div className="p-3 rounded-lg border bg-blue-50 dark:bg-blue-900/20 space-y-2">
                                <h4 className="font-semibold text-sm text-blue-700 dark:text-blue-300">Targeted Improvement</h4>
                                <p className="text-sm">{answer.grade.suggestedImprovement}</p>
                              </div>
                            </div>
                          ) : (
                            <div>
                              <p className="font-semibold text-sm">AI Feedback</p>
                              <p className="text-muted-foreground">{answer.feedback}</p>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
