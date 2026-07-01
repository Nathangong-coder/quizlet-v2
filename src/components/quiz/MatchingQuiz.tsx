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
  // matches: { [definitionId: string]: termId }
  const [matches, setMatches] = useState<{ [defId: string]: string }>({});
  const [selectedTermId, setSelectedTermId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleTermSelect = (id: string) => {
    setSelectedTermId(id);
  };

  const handleSlotClick = (defId: string) => {
    const currentMatchedTermId = matches[defId];

    if (currentMatchedTermId) {
      // Remove match
      const newMatches = { ...matches };
      delete newMatches[defId];
      setMatches(newMatches);
    } else if (selectedTermId) {
      // Place selected term into slot
      const newMatches = { ...matches };
      newMatches[defId] = selectedTermId;
      setMatches(newMatches);
      setSelectedTermId(null); // Clear selection after placing
    }
  };

  async function handleSubmit() {
    setIsSubmitting(true);

    // Transform matches: { [defId]: termId } -> { cardId: termId, matchedWithId: defId }
    // Note: In the server action 'submitMatchingAnswers', the expected format is
    // an array of { cardId: string, matchedWithId: string }.
    // We will treat the 'cardId' as the term and 'matchedWithId' as the definition.
    const matchesArray = Object.entries(matches).map(([defId, termId]) => ({
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
  const matchedTermIds = Object.values(matches);

  return (
    <Card className="max-w-5xl mx-auto">
      <CardHeader>
        <CardTitle className="text-center text-2xl">Match Terms to Definitions</CardTitle>
        <p className="text-center text-muted-foreground">
          Select a term from the left, then click a slot next to its definition on the right.
        </p>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-12 p-8">
        {/* Terms Column */}
        <div className="space-y-3">
          <h3 className="font-semibold text-lg mb-4 text-center">Terms</h3>
          <div className="grid grid-cols-1 gap-2">
            {cards.map(c => {
              const isMatched = matchedTermIds.includes(c.id);
              return (
                <Button
                  key={c.id}
                  variant={selectedTermId === c.id ? "default" : isMatched ? "secondary" : "outline"}
                  className={cn(
                    "w-full text-left justify-start h-auto py-3 px-4 transition-all",
                    isMatched && "opacity-50 cursor-not-allowed"
                  )}
                  onClick={() => !isMatched && handleTermSelect(c.id)}
                  disabled={isMatched || isSubmitting}
                >
                  {c.term}
                </Button>
              );
            })}
          </div>
        </div>

        {/* Definitions Column */}
        <div className="space-y-4">
          <h3 className="font-semibold text-lg mb-4 text-center">Definitions</h3>
          <div className="space-y-4">
            {cards.map(c => {
              const matchedTermId = matches[c.id];
              const matchedTerm = cards.find(card => card.id === matchedTermId);

              return (
                <div key={c.id} className="flex items-center gap-4 p-3 border rounded-lg bg-card group">
                  <div className="flex-1">
                    <p className="text-sm font-medium leading-relaxed">{c.definition}</p>
                  </div>
                  <div className="w-40">
                    <Button
                      variant={matchedTermId ? "secondary" : "outline"}
                      className={cn(
                        "w-full justify-center h-10 text-sm transition-all",
                        matchedTermId ? "bg-secondary text-secondary-foreground" : "hover:bg-muted"
                      )}
                      onClick={() => handleSlotClick(c.id)}
                      disabled={isSubmitting}
                    >
                      {matchedTerm ? (
                        <span className="truncate px-2">{matchedTerm.term}</span>
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
              Match all definitions to continue
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
