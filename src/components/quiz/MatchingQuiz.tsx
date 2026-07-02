"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
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
  // matches: { [termId: string]: defId }
  const [matches, setMatches] = useState<{ [termId: string]: string }>({});
  const [selectedDefId, setSelectedDefId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleDefSelect = (id: string) => {
    setSelectedDefId(id);
  };

  const handleSlotClick = (termId: string) => {
    const currentMatchedDefId = matches[termId];

    if (currentMatchedDefId) {
      const newMatches = { ...matches };
      delete newMatches[termId];
      setMatches(newMatches);
    } else if (selectedDefId) {
      const newMatches = { ...matches };
      newMatches[termId] = selectedDefId;
      setMatches(newMatches);
      setSelectedDefId(null);
    }
  };

  async function submitAndFinish() {
    setIsSubmitting(true);

    const matchesArray = Object.entries(matches).map(([termId, defId]) => ({
      cardId: termId,
      matchedWithId: defId
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

  const allSlotsFilled = Object.keys(matches).length === cards.length;
  const matchedDefIds = Object.values(matches);

  useEffect(() => {
    if (allSlotsFilled && !isSubmitting) {
      submitAndFinish();
    }
  }, [allSlotsFilled]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-12 p-8">
      {/* Definition Pool (Left 1/3) */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-6 bg-primary rounded-full" />
          <h3 className="font-semibold text-lg">Definition Pool</h3>
        </div>
        <div className="grid grid-cols-1 gap-3">
          {cards.map(c => {
            const isUsed = matchedDefIds.includes(c.id);
            return (
              <Button
                key={c.id}
                variant={selectedDefId === c.id ? "default" : isUsed ? "secondary" : "outline"}
                className={cn(
                  "w-full text-left justify-start h-auto py-3 px-4 transition-all duration-200",
                  "border-2",
                  selectedDefId === c.id && "ring-2 ring-primary ring-offset-2",
                  isUsed && "opacity-40 cursor-not-allowed bg-muted text-muted-foreground border-muted"
                )}
                onClick={() => !isUsed && handleDefSelect(c.id)}
                disabled={isUsed || isSubmitting}
              >
                <span className="line-clamp-3 text-sm">{c.definition}</span>
              </Button>
            );
          })}
        </div>
      </div>

      {/* Main Matching Area (Right 2/3) */}
      <div className="lg:col-span-2 space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-6 bg-primary rounded-full" />
          <h3 className="font-semibold text-lg">Terms & Matches</h3>
        </div>
        <div className="space-y-3">
          {cards.map(c => {
            const matchedDefId = matches[c.id];
            const matchedDef = cards.find(card => card.id === matchedDefId);

            return (
              <div key={c.id} className="flex items-center gap-4 p-4 border rounded-xl bg-card group transition-all hover:border-primary/50 hover:shadow-sm">
                <div className="flex-1">
                  <p className="font-medium text-base">{c.term}</p>
                </div>
                <div className="w-72">
                  <button
                    onClick={() => handleSlotClick(c.id)}
                    disabled={isSubmitting}
                    className={cn(
                      "w-full h-11 px-3 py-2 rounded-lg text-sm transition-all duration-200 border-2 flex items-center justify-center text-center",
                      matchedDefId
                        ? "bg-primary/10 border-primary text-primary-foreground shadow-inner"
                        : "border-dashed border-muted-foreground/30 text-muted-foreground hover:border-primary/50 hover:bg-muted/50"
                    )}
                  >
                    {matchedDef ? (
                      <span className="truncate px-2 font-medium">{matchedDef.definition}</span>
                    ) : (
                      <span className="italic opacity-60">Click to match...</span>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
