"use client";

import React, { useState, useRef, useImperativeHandle, forwardRef } from "react";
import { Button } from "@/components/ui/button";
import { Card as PrismaCard } from "@prisma/client";
import { cn } from "@/lib/utils";
import { ExpandableText } from "@/components/ui/expandable-text";
import { submitMatchingAnswers } from "@/actions/quiz-matching";
import { toast } from "sonner";
import { ContentBlock } from "@/lib/cards/content";
import { ContentBlockView } from "@/components/cards/ContentBlockView";
import { QuizSectionHandle } from "./section";

type MatchCard = PrismaCard & { contentBlocks?: ContentBlock[] };

interface MatchingQuizProps {
  cards: MatchCard[];
  attemptId: string;
}

/**
 * Renders one side of a matching card. Uses the rich ContentBlockView for
 * media (images/video/etc.) so image cards are visible in matching, and
 * falls back to ExpandableText for plain-text cards.
 */
function SideContent({
  card,
  side,
  className,
}: {
  card: MatchCard;
  side: "term" | "definition";
  className?: string;
}) {
  const blocks = (card.contentBlocks ?? [])
    .filter((b) => b.side === side)
    .sort((a, b) => a.position - b.position);

  if (blocks.length === 0) {
    const text = side === "term" ? card.term : card.definition;
    return <ExpandableText text={text} className={className} />;
  }

  return (
    <div className="space-y-2 w-full">
      {blocks.map((block, i) =>
        block.type === "text" ? (
          <ExpandableText key={i} text={block.text ?? ""} className={className} />
        ) : (
          <ContentBlockView
            key={i}
            block={block}
            compact
            assetUrl={block.assetId ? `/api/assets/${block.assetId}` : undefined}
          />
        ),
      )}
    </div>
  );
}

export const MatchingQuiz = forwardRef<QuizSectionHandle, MatchingQuizProps>(
  function MatchingQuiz({ cards, attemptId }, ref) {
  // matches: { [termId: string]: defId }
  const [matches, setMatches] = useState<{ [termId: string]: string }>({});
  const [selectedDefId, setSelectedDefId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const committedRef = useRef(false);

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

  async function commitAll() {
    if (committedRef.current) return;
    const matchesArray = Object.entries(matches).map(([termId, defId]) => ({
      cardId: termId,
      matchedWithId: defId,
    }));
    if (matchesArray.length === 0) return; // nothing matched → contributes 0

    setIsSubmitting(true);
    const result = await submitMatchingAnswers({ attemptId, matches: matchesArray });
    setIsSubmitting(false);

    if (result.success) {
      committedRef.current = true;
    } else {
      toast.error(result.error || 'Failed to submit matching quiz');
    }
  }

  // "Answered" in this section's own terms is a pair the learner placed. This
  // is the same quantity commitAll's early return above tests
  // (`matchesArray.length === 0`, built from these very entries), so a zero
  // here means commitAll wrote nothing — exactly the condition the container's
  // skipped-quiz check is asking about.
  function answeredCount() {
    return Object.keys(matches).length;
  }

  // `matches` is in the dep array, so the handle is rebuilt whenever a pair is
  // placed or removed and never reports a stale count. Verified deliberately:
  // a stale 0 would let the container discard an attempt the learner took.
  useImperativeHandle(ref, () => ({ commitAll, answeredCount }), [matches, attemptId]);

  const matchedDefIds = Object.values(matches);

  return (
    <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-12 p-8">
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
                  "border-2 whitespace-normal",
                  selectedDefId === c.id && "ring-2 ring-primary ring-offset-2",
                  isUsed && "opacity-40 cursor-not-allowed bg-muted text-muted-foreground border-muted"
                )}
                onClick={() => !isUsed && handleDefSelect(c.id)}
                disabled={isUsed || isSubmitting}
              >
                <SideContent card={c} side="definition" className="text-sm" />
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
                <div className="flex-1 font-medium text-base">
                  <SideContent card={c} side="term" />
                </div>
                <div className="w-72">
                  <button
                    onClick={() => handleSlotClick(c.id)}
                    disabled={isSubmitting}
                    className={cn(
                      "w-full min-h-[44px] h-auto px-3 py-2 rounded-lg text-sm transition-all duration-200 border-2 flex items-start justify-start text-left",
                      matchedDefId
                        ? "bg-primary/10 border-primary text-primary-foreground shadow-inner"
                        : "border-dashed border-muted-foreground/30 text-muted-foreground hover:border-primary/50 hover:bg-muted/50"
                    )}
                  >
                    {matchedDef ? (
                      <SideContent card={matchedDef} side="definition" className="px-2 font-medium" />
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
});
