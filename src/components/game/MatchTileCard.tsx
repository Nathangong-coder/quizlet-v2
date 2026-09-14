interface MatchTileCardProps {
  content: string;
  isSelected: boolean;
  isMatched: boolean;
  onClick: () => void;
}

/**
 * One tile. Sized for PIECES — a short prompt or a one-to-five word answer —
 * so sixteen of them fit one screen: fixed aspect, centred text, clamped to
 * four lines. The old min-height + scroll layout was built for whole cards
 * and made the board unplayable on a finance set.
 */
export function MatchTileCard({ content, isSelected, isMatched, onClick }: MatchTileCardProps) {
  const baseClasses =
    'flex aspect-[4/3] items-center justify-center rounded-lg border-2 p-2.5 text-center text-[13px] leading-snug transition-all duration-200 sm:text-sm [&>span]:line-clamp-4';

  const stateClasses = isMatched
    ? 'bg-muted border-muted-foreground/40 text-muted-foreground cursor-default'
    : isSelected
      ? 'bg-accent border-primary'
      : 'bg-card border-input hover:border-primary/50';

  return (
    <button
      className={`${baseClasses} ${stateClasses}`}
      onClick={onClick}
      disabled={isMatched}
      // Selection was conveyed by colour alone; a screen reader had no way to
      // tell a picked tile from an unpicked one.
      aria-pressed={isSelected}
      title={content}
    >
      <span>{content}</span>
    </button>
  );
}
