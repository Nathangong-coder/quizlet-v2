import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ShortAnswerGrade } from '@/lib/ai/schemas';

interface GradeCardProps {
  grade: ShortAnswerGrade;
}

export function GradeCard({ grade }: GradeCardProps) {
  const getBadgeVariant = (score: number) => {
    if (score >= 8) return 'default';
    if (score >= 5) return 'secondary';
    return 'destructive';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl flex items-center justify-between">
          AI Grade
          <Badge variant={getBadgeVariant(grade.overall)}>Overall: {grade.overall}/10</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center p-2 rounded bg-muted/50">
            <div className="text-sm text-muted-foreground">Clarity</div>
            <div className="font-bold">{grade.clarity}/10</div>
          </div>
          <div className="text-center p-2 rounded bg-muted/50">
            <div className="text-sm text-muted-foreground">Conciseness</div>
            <div className="font-bold">{grade.conciseness}/10</div>
          </div>
          <div className="text-center p-2 rounded bg-muted/50">
            <div className="text-sm text-muted-foreground">Correctness</div>
            <div className="font-bold">{grade.correctness}/10</div>
          </div>
        </div>

        <div>
          <h4 className="font-semibold mb-1">Feedback</h4>
          <p className="text-sm text-muted-foreground">{grade.feedback}</p>
        </div>

        <div>
          <h4 className="font-semibold mb-1">Improvement</h4>
          <p className="text-sm text-primary">{grade.suggestedImprovement}</p>
        </div>
      </CardContent>
    </Card>
  );
}
