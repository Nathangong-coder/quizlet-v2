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
      // Unmatch the pair
      const newMatches = { ...matches };
      delete newMatches[id];
      setMatches(newMatches);
      setSelectedTermId(null);
      setSelectedDefId(null);
    } else {
      setSelectedTermId(id);
    }
  };

  const handleDefSelect = (id: string) => {
    const matchingTermId = Object.keys(matches).find(tId => matches[tId] === id);
    if (matchingTermId) {
      // Unmatch the pair
      const newMatches = { ...matches };
      delete newMatches[matchingTermId];
      setMatches(newMatches);
      setSelectedTermId(null);
      setSelectedDefId(null);
    } else {
      setSelectedDefId(id);
    }
  };

  const confirmMatch = () => {
    if (selectedTermId && selectedDefId) {
      // If this definition was already matched to someone else, remove that match first
      const existingTermId = Object.keys(matches).find(tId => matches[tId] === selectedDefId);
      const newMatches = { ...matches };
      if (existingTermId) delete newMatches[existingTermId];

      newMatches[selectedTermId] = selectedDefId;
      setMatches(newMatches);
      setSelectedTermId(null);
      setSelectedDefId(null);
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

  const allMatched = Object.keys(matches).length === cards.length;

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
              variant={selectedDefId === c.id ? "default" : Object.values(matches).includes(c.id) ? "secondary" : "outline"}
              className={cn("w-full text-left justify-start", Object.values(matches).includes(c.id) && "opacity-50")}
              onClick={() => handleDefSelect(c.id)}
            >
              {c.definition}
            </Button>
          ))}
        </div>
        <div className="col-span-2 flex flex-col items-center justify-center gap-4 pt-6">
          {selectedTermId && selectedDefId && (
            <Button onClick={confirmMatch} variant="default" className="px-8">
              Match Pair
            </Button>
          )}
          <Button
            onClick={submitAll}
            disabled={isLoading || !allMatched}
            variant={allMatched ? "default" : "outline"}
          >
            {isLoading ? "Submitting..." : allMatched ? "Submit Matching Quiz" : "Match all pairs to submit"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
