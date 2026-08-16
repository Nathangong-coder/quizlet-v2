interface MatchTileCardProps {
  content: string;
  isSelected: boolean;
  isMatched: boolean;
  onClick: () => void;
}

export function MatchTileCard({ content, isSelected, isMatched, onClick }: MatchTileCardProps) {
  const baseClasses = "p-4 rounded-lg border-2 transition-all duration-200 text-left cursor-pointer min-h-[100px] flex items-start justify-start overflow-y-auto";

  const stateClasses = isMatched
    ? "bg-muted border-muted-foreground/50 text-muted-foreground opacity-100 cursor-default"
    : isSelected
      ? "bg-accent border-primary"
      : "bg-card border-input hover:border-primary/50";

  return (
    <button
      className={`${baseClasses} ${stateClasses}`}
      onClick={onClick}
      disabled={isMatched}
      // Selection was conveyed by colour alone; a screen reader had no way to
      // tell a picked tile from an unpicked one.
      aria-pressed={isSelected}
    >
      {content}
    </button>
  );
}
