'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle, Trophy } from 'lucide-react';

interface QuizSummaryProps {
  score: number;
  setId: string;
  attemptId: string;
}

export function QuizSummary({ score, setId, attemptId }: QuizSummaryProps) {
  return (
    <Card className="max-w-xl mx-auto">
      <CardHeader className="text-center">
        <div className="flex justify-center mb-2">
          <Trophy className="w-12 h-12 text-yellow-500" />
        </div>
        <CardTitle className="text-3xl font-bold">Quiz Complete!</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 text-center">
        <div className="text-6xl font-bold text-primary">{score}%</div>
        <p className="text-muted-foreground">
          {score >= 80 ? 'Outstanding! You have a strong grasp of these concepts.' :
           score >= 60 ? 'Good job! A bit more review and you\'ll be an expert.' :
           'Keep practicing! Focus on the starred cards for a quicker improvement.'}
        </p>
        <Button
          className="w-full"
          onClick={() => window.location.href = `/sets/${setId}`}
        >
          Back to Set
        </Button>
      </CardContent>
    </Card>
  );
}
