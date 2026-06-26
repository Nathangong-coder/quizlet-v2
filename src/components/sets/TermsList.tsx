'use client';

import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import StarButton from '@/components/sets/StarButton';
import ConfidenceRate from '@/components/sets/ConfidenceRate';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';

interface Term {
  id: string;
  term: string;
  definition: string;
}

interface Progress {
  confidence: number;
  starred: boolean;
}

interface TermsListProps {
  cards: Term[];
  progressMap: Map<string, Progress>;
  userId?: string;
  setId: string;
}

export function TermsList({ cards, progressMap, userId, setId }: TermsListProps) {
  const [isCompact, setIsCompact] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">Terms List</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsCompact(!isCompact)}
        >
          {isCompact ? 'Show Full Text' : 'Compact View'}
        </Button>
      </div>

      <Separator className="mb-6" />

      {cards.map((card) => {
        const progress = progressMap.get(card.id);
        return (
          <Card key={card.id}>
            <CardContent className="pt-4 grid grid-cols-[1fr_1fr_auto] gap-4 items-start">
              <div>
                <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wide">
                  Term
                </p>
                <p className="font-medium whitespace-pre-wrap">{card.term}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wide">
                  Definition
                </p>
                <p className={cn(
                  "whitespace-pre-wrap",
                  isCompact && "line-clamp-2"
                )}>
                  {card.definition}
                </p>
              </div>
              {userId && (
                <div className="flex flex-col items-center gap-3 pt-5">
                  <StarButton
                    cardId={card.id}
                    setId={setId}
                    starred={progress?.starred ?? false}
                  />
                  <ConfidenceRate
                    cardId={card.id}
                    setId={setId}
                    initialConfidence={progress?.confidence ?? 5}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
