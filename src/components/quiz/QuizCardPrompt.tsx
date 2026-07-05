'use client';

import React from 'react';
import { Card } from '@prisma/client';
import { ContentBlock } from '@/lib/cards/content';
import { ContentBlockView } from '@/components/cards/ContentBlockView';

type QuizCard = Card & { contentBlocks?: ContentBlock[] };

/**
 * Renders one side of a quiz card's prompt, including any rich media
 * (images, audio, video, files). Falls back to the plain term/definition
 * text when the card has no content blocks for that side.
 */
export function QuizCardPrompt({
  card,
  side,
  className = '',
}: {
  card: QuizCard;
  side: 'term' | 'definition';
  className?: string;
}) {
  const blocks = (card.contentBlocks ?? [])
    .filter((b) => b.side === side)
    .sort((a, b) => a.position - b.position);

  const fallbackText = side === 'term' ? card.term : card.definition;

  if (blocks.length === 0) {
    return <p className={`text-lg font-medium ${className}`}>{fallbackText}</p>;
  }

  return (
    <div className={`space-y-2 ${className}`}>
      {blocks.map((block, i) => (
        <ContentBlockView
          key={i}
          block={block}
          compact
          assetUrl={block.assetId ? `/api/assets/${block.assetId}` : undefined}
        />
      ))}
    </div>
  );
}
