import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Card as PrismaCard } from "@prisma/client";
import { cn } from "@/lib/utils";

interface MatchingQuizProps {
  cards: PrismaCard[];
  onMatch: (matches: { [key: string]: string }) => void;
  matches: { [key: string]: string };
}

export function MatchingQuiz({ cards, onMatch, matches }: MatchingQuizProps) {
  const [selectedTermId, setSelectedTermId] = useState<string | null>(null);
  const [selectedDefId, setSelectedDefId] = useState<string | null>(null);

  const handleTermSelect = (id: string) => {
    if (matches[id]) {
      // Unmatch the pair
      const newMatches = { ...matches };
      delete newMatches[id];
      onMatch(newMatches);
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
      onMatch(newMatches);
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
      onMatch(newMatches);
      setSelectedTermId(null);
      setSelectedDefId(null);
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
              variant={selectedDefId === c.id ? "default" : Object.values(matches).includes(c.id) ? "secondary" : "outline"}
              className={cn("w-full text-left justify-start", Object.values(matches).includes(c.id) && "opacity-50")}
              onClick={() => handleDefSelect(c.id)}
            >
              {c.definition}
            </Button>
          ))}
        </div>
        <div className="col-span-2 flex items-center justify-center pt-6">
          {selectedTermId && selectedDefId && (
            <Button onClick={confirmMatch} variant="default" className="px-8">
              Match Pair
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
