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
      // Remove match
      const newMatches = { ...matches };
      delete newMatches[termId];
      setMatches(newMatches);
    } else if (selectedDefId) {
      // Place selected definition into slot
      const newMatches = { ...matches };
      newMatches[termId] = selectedDefId;
      setMatches(newMatches);
      setSelectedDefId(null);
    }
  };

  async function handleSubmit() {
    setIsSubmitting(true);

    // Transform matches: { [termId]: defId } -> { cardId: termId, matchedWithId: defId }
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

  return (
    <Card className="max-w-6xl mx-auto">
      <CardHeader>
        <CardTitle className="text-center text-2xl">Match Definitions to Terms</CardTitle>
        <p className="text-center text-muted-foreground">
          Select a definition from the pool, then click the slot next to the correct term.
        </p>
      </CardHeader>
      <CardContent className="grid grid-cols-1 lg:grid-cols-3 gap-12 p-8">
        {/* Main Matching Area (Left 2/3) */}
        <div className="lg:col-span-2 space-y-4">
          <h3 className="font-semibold text-lg mb-4">Terms & Slots</h3>
          <div className="space-y-3">
            {cards.map(c => {
              const matchedDefId = matches[c.id];
              const matchedDef = cards.find(card => card.id === matchedDefId);

              return (
                <div key={c.id} className="flex items-center gap-4 p-3 border rounded-lg bg-card group transition-colors hover:bg-muted/50">
                  <div className="flex-1">
                    <p className="font-medium">{c.term}</p>
                  </div>
                  <div className="w-64">
                    <Button
                      variant={matchedDefId ? "secondary" : "outline"}
                      className={cn(
                        "w-full justify-center h-10 text-sm transition-all",
                        matchedDefId ? "bg-secondary text-secondary-foreground" : "hover:bg-muted"
                      )}
                      onClick={() => handleSlotClick(c.id)}
                      disabled={isSubmitting}
                    >
                      {matchedDef ? (
                        <span className="truncate px-2">{matchedDef.definition}</span>
                      ) : (
                        <span className="text-muted-foreground italic">Empty Slot</span>
                      )}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Definition Pool (Right 1/3) */}
        <div className="space-y-4">
          <h3 className="font-semibold text-lg mb-4">Definition Pool</h3>
          <div className="grid grid-cols-1 gap-2">
            {cards.map(c => {
              const isUsed = matchedDefIds.includes(c.id);
              return (
                <Button
                  key={c.id}
                  variant={selectedDefId === c.id ? "default" : isUsed ? "secondary" : "outline"}
                  className={cn(
                    "w-full text-left justify-start h-auto py-3 px-4 transition-all",
                    isUsed && "opacity-50 cursor-not-allowed"
                  )}
                  onClick={() => !isUsed && handleDefSelect(c.id)}
                  disabled={isUsed || isSubmitting}
                >
                  <span className="line-clamp-3">{c.definition}</span>
                </Button>
              );
            })}
          </div>
        </div>

        <div className="col-span-full flex flex-col items-center justify-center pt-8 gap-4">
          {allSlotsFilled && (
            <Button
              onClick={handleSubmit}
              variant="default"
              className="px-16 py-6 text-xl bg-green-600 hover:bg-green-700 transition-transform active:scale-95"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="animate-spin w-6 h-6 mr-2" />
                  Submitting Quiz...
                </>
              ) : (
                'Submit Matching Quiz'
              )}
            </Button>
          )}
          {!allSlotsFilled && (
            <p className="text-muted-foreground text-sm italic">
              Match all terms to continue
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
