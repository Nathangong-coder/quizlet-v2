import React, { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCardAutocompleteSuggestions } from "@/actions/card-autocomplete";
import { cn } from "@/lib/utils";

interface AIAutocompleteButtonProps {
  setId: string;
  currentText: string;
  side: "term" | "definition";
  categories: string[];
  onSelect: (suggestion: string) => void;
}

export function AIAutocompleteButton({
  setId,
  currentText,
  side,
  categories,
  onSelect,
}: AIAutocompleteButtonProps) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const fetchSuggestions = async () => {
    setIsLoading(true);
    const result = await getCardAutocompleteSuggestions(setId, currentText, side, categories);
    if (result.success && result.data) {
      setSuggestions(result.data.suggestions);
    }
    setIsLoading(false);
    setIsOpen(true);
  };

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0 text-muted-foreground hover:text-primary"
        onClick={fetchSuggestions}
        disabled={isLoading}
      >
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
      </Button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-64 p-2 bg-white border rounded-lg shadow-lg z-50">
            <div className="space-y-1">
              {suggestions.length === 0 && !isLoading && (
                <p className="text-sm text-muted-foreground text-center py-2">No suggestions found.</p>
              )}
              {suggestions.map((s, i) => (
                <Button
                  key={i}
                  variant="ghost"
                  className="w-full justify-start text-sm h-auto py-2 px-3 text-left"
                  onClick={() => {
                    onSelect(s);
                    setIsOpen(false);
                  }}
                >
                  {s}
                </Button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
