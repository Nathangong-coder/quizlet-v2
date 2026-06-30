import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card as CardUI, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { submitMatchingAnswers } from "@/actions/quiz-matching";
import { Card as PrismaCard } from "@prisma/client";

interface MatchingQuizProps {
  cards: PrismaCard[];
  attemptId: string;
  onFinish: (score: number) => void;
}

export function MatchingQuiz({ cards, attemptId, onFinish }: MatchingQuizProps) {
  const [matches, setMatches] = useState<{ [key: string]: string }>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSelect = (id: string, isTerm: boolean) => {
    if (selectedId) {
      if (selectedId === id) {
        setSelectedId(null);
        return;
      }
      setMatches(prev => ({ ...prev, [selectedId!]: id }));
      setSelectedId(null);
    } else {
      setSelectedId(id);
    }
  };

  const submitAll = async () => {
    setIsLoading(true);
    const matchEntries = Object.entries(matches).map(([cardId, matchedWithId]) => ({
      cardId,
      matchedWithId,
    }));

    const result = await submitMatchingAnswers({
      attemptId,
      matches: matchEntries,
    });

    setIsLoading(false);
    if (result.success && result.data) {
      onFinish(result.data.score);
    } else if (result.error) {
      alert(result.error);
    }
  };

  return (
    <CardUI className="max-w-4xl mx-auto">
      <CardHeader>
        <CardTitle>Match the terms to their definitions</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-8">
        <div className="space-y-2">
          {cards.map(c => (
            <Button
              key={c.id}
              variant={selectedId === c.id || matches[c.id] ? "default" : "outline"}
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
              variant={selectedId === c.id || Object.values(matches).includes(c.id) ? "default" : "outline"}
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
    </CardUI>
  );
}
