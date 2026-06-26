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

  const CategorySection = ({ title, data }: { title: string, data: { score: number, pros: string[], cons: string[] } }) => (
    <div className="space-y-2 p-3 rounded-lg border bg-muted/30">
      <div className="flex justify-between items-center">
        <span className="font-semibold">{title}</span>
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl flex items-center justify-between">
          AI Grade
          <Badge variant={getBadgeVariant(grade.overall)}>Overall: {grade.overall}/10</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <CategorySection title="Clarity" data={grade.clarity} />
          <CategorySection title="Conciseness" data={grade.conciseness} />
          <CategorySection title="Correctness" data={grade.correctness} />
        </div>

        <div className="p-3 rounded-lg border bg-primary/5 space-y-2">
          <h4 className="font-semibold text-sm">AI Summary</h4>
          <p className="text-sm text-muted-foreground">{grade.summary}</p>
        </div>

        <div className="p-3 rounded-lg border bg-blue-50 dark:bg-blue-900/20 space-y-2">
          <h4 className="font-semibold text-sm text-blue-700 dark:text-blue-300">Targeted Improvement</h4>
          <p className="text-sm">{grade.suggestedImprovement}</p>
        </div>
      </CardContent>
    </Card>
  );
}
