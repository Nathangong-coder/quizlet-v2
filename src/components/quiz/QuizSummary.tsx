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

  if (loading) return <div className="text-center p-10">Generating AI analysis...</div>;

  if (!summary) return <div className="text-center p-10">Failed to load quiz summary. Please try again.</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Card>
        <CardHeader className="text-center">
          <div className="flex justify-center mb-2">
            <Trophy className="w-12 h-12 text-yellow-500" />
          </div>
          <CardTitle className="text-3xl font-bold">Quiz Results</CardTitle>
          <div className="text-6xl font-bold text-primary mt-4">{score}%</div>
        </CardHeader>
      </Card>

      <Tabs defaultValue="summary">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="summary">Overall Results</TabsTrigger>
          <TabsTrigger value="review">Individual Review</TabsTrigger>
        </TabsList>

        <TabsContent value="summary">
          <Card>
            <CardHeader>
              <CardTitle>Overall AI Analysis</CardTitle>
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
        </TabsContent>

        <TabsContent value="review">
          <div className="space-y-4">
            {summary.attempt.answers.map((answer: any, index: number) => (
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
