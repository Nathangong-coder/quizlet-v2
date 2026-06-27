'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Trophy, BookOpen, AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import { getQuizAttemptSummary } from '@/actions/quiz';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface QuizSummaryProps {
  score: number;
  setId: string;
  attemptId: string;
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
                  <CardTitle className="flex items-center gap-2">
                    {answer.isCorrect ? <CheckCircle2 className="text-green-500" /> : <XCircle className="text-red-500" />}
                    Question {index + 1}: {answer.card.term}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
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
                  <div>
                    <p className="font-semibold text-sm">AI Feedback</p>
                    <p className="text-muted-foreground">{answer.feedback}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
