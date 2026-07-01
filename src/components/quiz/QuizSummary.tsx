'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Trophy, CheckCircle2, XCircle } from 'lucide-react';
import { getQuizAttemptSummary } from '@/actions/quiz';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface QuizSummaryProps {
  score: number;
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

function MatchingReview({ answers }: { answers: any[] }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Matching Results</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs uppercase bg-muted">
                <tr>
                  <th className="px-4 py-2">Term</th>
                  <th className="px-4 py-2">Your Match</th>
                  <th className="px-4 py-2">Correct Definition</th>
                  <th className="px-4 py-2 text-center">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {answers.map((answer, i) => (
                  <tr key={answer.id} className="hover:bg-muted/50">
                    <td className="px-4 py-3 font-medium">{answer.card.term}</td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        "p-1 rounded",
                        answer.isCorrect ? "text-green-600 bg-green-50" : "text-red-600 bg-red-50"
                      )}>
                        {answer.selectedOption || "No match"}
                      </span>
                    </td>
                    <td className="px-4 py-3">{answer.correctAnswer}</td>
                    <td className="px-4 py-3 text-center">
                      {answer.isCorrect ? <CheckCircle2 className="w-4 h-4 text-green-500 mx-auto" /> : <XCircle className="w-4 h-4 text-red-500 mx-auto" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
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
                <div className="prose max-w-none text-muted-foreground whitespace-pre-line">
                  {summary.overallAnalysis}
                </div>
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
                <Button
                  className="w-full"
                  onClick={() => window.location.href = `/sets/${setId}`}
                >
                  Back to Set
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="review">
          {attempt.mode === 'matching' ? (
            <MatchingReview answers={attempt.answers} />
          ) : (
            <div className="space-y-4">
              {attempt.answers.map((answer: any, index: number) => (
                <Card key={answer.id}>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {answer.isCorrect ? <CheckCircle2 className="text-green-500" /> : <XCircle className="text-red-500" />}
                        Question {index + 1}: {answer.card.term}
                      </div>
                      {answer.grade && (
                        <Badge variant={answer.grade.overall >= 8 ? 'default' : answer.grade.overall >= 5 ? 'secondary' : 'destructive'}>
                          AI Grade: {answer.grade.overall}/10
                        </Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
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
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
