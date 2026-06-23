interface MatchTileCardProps {
  content: string;
  isSelected: boolean;
  isMatched: boolean;
  onClick: () => void;
}

export function MatchTileCard({ content, isSelected, isMatched, onClick }: MatchTileCardProps) {
  const baseClasses = "p-4 rounded-lg border-2 transition-all duration-200 text-center cursor-pointer min-h-[100px] flex items-center justify-center";

  const stateClasses = isMatched
    ? "bg-green-100 border-green-500 opacity-50 cursor-default"
    : isSelected
      ? "bg-blue-100 border-blue-500"
      : "bg-white border-gray-300 hover:border-blue-300";

  return (
    <button
      className={`${baseClasses} ${stateClasses}`}
      onClick={onClick}
      disabled={isMatched}
    >
      {content}
    </button>
  );
}
