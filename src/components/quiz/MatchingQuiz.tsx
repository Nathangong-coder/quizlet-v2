import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { submitMatchingAnswers } from "@/actions/quiz-matching";
import { Card as PrismaCard } from "@prisma/client";
import { cn } from "@/lib/utils";

interface MatchingQuizProps {
  cards: PrismaCard[];
  attemptId: string;
  onFinish: (score: number) => void;
}

export function MatchingQuiz({ cards, attemptId, onFinish }: MatchingQuizProps) {
  const [selectedTermId, setSelectedTermId] = useState<string | null>(null);
  const [selectedDefId, setSelectedDefId] = useState<string | null>(null);
  const [matches, setMatches] = useState<{ [key: string]: string }>({});
  const [isLoading, setIsLoading] = useState(false);

  const handleTermSelect = (id: string) => {
    if (matches[id]) {
      // Deselect match
      const matchedDefId = matches[id];
      const newMatches = { ...matches };
      delete newMatches[id];
      // Also remove the reverse mapping if we had one, but here we only map Term -> Def
      setMatches(newMatches);
      setSelectedTermId(null);
    } else {
      setSelectedTermId(id);
    }
  };

  const handleDefSelect = (id: string) => {
    if (matches[Object.keys(matches).find(tId => matches[tId] === id)!]) {
       // This definition is already matched. We'll allow re-matching by removing the old one.
       const oldTermId = Object.keys(matches).find(tId => matches[tId] === id)!;
       const newMatches = { ...matches };
       delete newMatches[oldTermId];
       setMatches(newMatches);
    }

    if (selectedTermId) {
      setMatches(prev => ({ ...prev, [selectedTermId!]: id }));
      setSelectedTermId(null);
    } else {
      setSelectedDefId(id);
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
    <Card className="max-w-4xl mx-auto">
      <CardHeader>
        <CardTitle>Match the terms to their definitions</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-8">
        <div className="space-y-2">
          {cards.map(c => (
            <Button
              key={c.id}
              variant={selectedTermId === c.id ? "default" : matches[c.id] ? "secondary" : "outline"}
              className={cn("w-full text-left justify-start", matches[c.id] && "opacity-50")}
              onClick={() => handleTermSelect(c.id)}
            >
              {c.term}
            </Button>
          ))}
        </div>
        <div className="space-y-2">
          {cards.map(c => (
            <Button
              key={c.id}
              variant={selectedDefId === c.id || Object.values(matches).includes(c.id) ? "default" : "outline"}
              className={cn("w-full text-left justify-start", Object.values(matches).includes(c.id) && "opacity-50")}
              onClick={() => handleDefSelect(c.id)}
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
