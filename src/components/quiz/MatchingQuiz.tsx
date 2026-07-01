"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Card as PrismaCard } from "@prisma/client";
import { cn } from "@/lib/utils";
import { submitMatchingAnswers } from "@/actions/quiz-matching";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface MatchingQuizProps {
  cards: PrismaCard[];
  attemptId: string;
  onFinish: (score: number) => void;
}

export function MatchingQuiz({ cards, attemptId, onFinish }: MatchingQuizProps) {
  const [matches, setMatches] = useState<{ [key: string]: string }>({});
  const [selectedTermId, setSelectedTermId] = useState<string | null>(null);
  const [selectedDefId, setSelectedDefId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleTermSelect = (id: string) => {
    if (matches[id]) {
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
      const existingTermId = Object.keys(matches).find(tId => matches[tId] === selectedDefId);
      const newMatches = { ...matches };
      if (existingTermId) delete newMatches[existingTermId];

      newMatches[selectedTermId] = selectedDefId;
      setMatches(newMatches);
      setSelectedTermId(null);
      setSelectedDefId(null);
    }
  };

  async function handleSubmit() {
    setIsSubmitting(true);
    const matchesArray = Object.entries(matches).map(([cardId, matchedWithId]) => ({
      cardId,
      matchedWithId
    }));

    const result = await submitMatchingAnswers({
      attemptId,
      matches: matchesArray
    });
    setIsSubmitting(false);

    if (result.success && result.data) {
      onFinish(result.data.score);
    } else {
      toast.error(result.error || 'Failed to submit matching quiz');
    }
  }

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
              disabled={isSubmitting}
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
              disabled={isSubmitting}
            >
              {c.definition}
            </Button>
          ))}
        </div>
        <div className="col-span-2 flex flex-col items-center justify-center pt-6 gap-4">
          {selectedTermId && selectedDefId && (
            <Button onClick={confirmMatch} variant="default" className="px-8">
              Match Pair
            </Button>
          )}

          {allMatched && (
            <Button
              onClick={handleSubmit}
              variant="default"
              className="px-12 py-6 text-lg bg-green-600 hover:bg-green-700"
              disabled={isSubmitting}
            >
              {isSubmitting ? <Loader2 className="animate-spin w-5 h-5 mr-2" /> : 'Submit Quiz'}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
