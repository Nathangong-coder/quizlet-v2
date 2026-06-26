'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { generateTrainingPlan } from '@/actions/training-plan';
import { toast } from 'sonner';
import { Loader2, Sparkles } from 'lucide-react';

export function TrainingPlanPanel({ setId }: { setId: string }) {
  const [plan, setPlan] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleGenerate() {
    setIsLoading(true);
    const result = await generateTrainingPlan(setId);
    setIsLoading(false);

    if (result.success && result.data) {
      setPlan(result.data.plan);
      toast.success('Training plan generated!');
    } else {
      toast.error((result as any).error || 'Failed to generate plan');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          AI Training Plan
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!plan ? (
          <Button onClick={handleGenerate} disabled={isLoading} className="w-full">
            {isLoading ? <Loader2 className="animate-spin w-4 h-4 mr-2" /> : 'Generate Personalized Plan'}
          </Button>
        ) : (
          <div className="space-y-4">
            <h3 className="font-bold text-lg">{plan.title}</h3>
            <p className="text-sm">{plan.summary}</p>
            <div className="grid gap-2">
              <h4 className="font-semibold text-sm">Focus Areas</h4>
              {(plan.focusAreas as any[]).map((area, i) => (
                <div key={i} className="text-xs p-2 bg-muted rounded flex justify-between">
                  <span>{area.label} - {area.reason}</span>
                  <span className="font-bold">{area.priority}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
