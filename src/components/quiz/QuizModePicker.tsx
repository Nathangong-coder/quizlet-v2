'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Brain, FileText, Loader2 } from 'lucide-react';
import { startQuizAttempt } from '@/actions/quiz';
import { toast } from 'sonner';

interface QuizModePickerProps {
  setId: string;
  onModeSelect: (mode: 'multiple-choice' | 'short-answer', attemptId: string) => void;
}

export function QuizModePicker({ setId, onModeSelect }: QuizModePickerProps) {
  const [isLoading, setIsLoading] = useState<string | null>(null);

  async function handleSelect(mode: 'multiple-choice' | 'short-answer') {
    setIsLoading(mode);
    const result = await startQuizAttempt(setId, mode);
    setIsLoading(null);

    if (result.success && result.data) {
      onModeSelect(mode, result.data.attemptId);
    } else {
      toast.error(result.error || 'Failed to start quiz');
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
      <Card
        className="hover:border-primary cursor-pointer transition-colors"
        onClick={() => !isLoading && handleSelect('multiple-choice')}
      >
        <CardHeader>
          <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-2">
            <Brain className="w-6 h-6 text-primary" />
          </div>
          <CardTitle>Multiple Choice</CardTitle>
          <CardDescription>
            Test your knowledge with AI-generated distractors. Quick and effective for recall.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            className="w-full"
            variant="outline"
            disabled={!!isLoading}
          >
            {isLoading === 'multiple-choice' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Start MC Quiz'}
          </Button>
        </CardContent>
      </Card>

      <Card
        className="hover:border-primary cursor-pointer transition-colors"
        onClick={() => !isLoading && handleSelect('short-answer')}
      >
        <CardHeader>
          <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-2">
            <FileText className="w-6 h-6 text-primary" />
          </div>
          <CardTitle>Short Answer</CardTitle>
          <CardDescription>
            Type your answers and get graded by AI based on clarity, correctness, and conciseness.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            className="w-full"
            variant="outline"
            disabled={!!isLoading}
          >
            {isLoading === 'short-answer' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Start Short Answer'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
