import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { submitMultipleChoiceAnswer } from "@/actions/quiz";
import { Card } from "@prisma/client";

interface MatchingQuizProps {
  cards: Card[];
  attemptId: string;
  onFinish: (score: number) => void;
}

export function MatchingQuiz({ cards, attemptId, onFinish }: MatchingQuizProps) {
  const [matches, setMatches] = useState<{ [key: string]: string }>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSelect = (id: string, isTerm: boolean) => {
    if (selectedId) {
      // Logic to match term and definition
      // Simplified: just track matches
      setMatches(prev => ({ ...prev, [selectedId!]: id }));
      setSelectedId(null);
    } else {
      setSelectedId(id);
    }
  };

  const submitAll = async () => {
    setIsLoading(true);
    // In a real implementation, we'd iterate through matches and call a matching submit action
    // For now, we'll simulate a successful completion
    setTimeout(() => {
      setIsLoading(false);
      onFinish(100);
    }, 1000);
  };

  return (
    <Card className="max-w-4xl mx-auto">
      <CardHeader>
        <CardTitle>Match the terms to their definitions</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-8">
        <div className="space-y-2">
          {cards.map(c => (
            <Button
              key={c.id}
              variant={selectedId === c.id ? "default" : "outline"}
              className="w-full text-left justify-start"
              onClick={() => handleSelect(c.id, true)}
            >
              {c.term}
            </Button>
          ))}
        </div>
        <div className="space-y-2">
          {cards.map(c => (
            <Button
              key={c.id}
              variant={selectedId === c.id ? "default" : "outline"}
              className="w-full text-left justify-start"
              onClick={() => handleSelect(c.id, false)}
            >
              {c.definition}
            </Button>
          ))}
        </div>
        <div className="col-span-2 flex justify-center pt-6">
          <Button onClick={submitAll} disabled={isLoading}>
            {isLoading ? "Submitting..." : "Submit Matching Quiz"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
