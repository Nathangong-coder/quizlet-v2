"use client";

import React, { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateCardAutofill, getCardAutocompleteSuggestions } from "@/actions/card-autocomplete";
import { useErrorToast } from "@/components/errors/useErrorToast";

interface AIAutocompleteButtonProps {
  setId: string;
  currentText: string;
  side: "term" | "definition";
  categories: string[];
  referenceText: string;
  onSelect: (suggestion: string) => void;
  onFillCard: (term: string, definition: string) => void;
}

export function AIAutocompleteButton({
  setId,
  currentText,
  side,
  categories,
  referenceText,
  onSelect,
  onFillCard,
}: AIAutocompleteButtonProps) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const { show: showError, dialog: errorDialog } = useErrorToast();

  const fetchSuggestions = async () => {
    setIsLoading(true);
    try {
      // A blank side is a completion action, not a suggestion request. The
      // server returns both sides so an entirely empty card can be filled in
      // one click, while the parent preserves any side the learner already
      // typed.
      if (!currentText.trim()) {
        const result = await generateCardAutofill(
          setId,
          side === "term" ? currentText : referenceText,
          side === "definition" ? currentText : referenceText,
          categories,
        );
        if (result.success) {
          setIsOpen(false);
          onFillCard(result.data.term, result.data.definition);
          // Also fill the specific empty text block that owns this button.
          // This matters when a rich card has another text block on the same
          // side that already contains content.
          onSelect(side === "term" ? result.data.term : result.data.definition);
        } else {
          showError(result.error, result.detail);
        }
        return;
      }

      const result = await getCardAutocompleteSuggestions(
        setId,
        currentText,
        side,
        categories,
        referenceText,
      );
      if (result.success) {
        setSuggestions(result.data.suggestions);
        setIsOpen(true);
      } else {
        showError(result.error, result.detail);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        type="button"
        aria-label={currentText.trim() ? "Get AI suggestions" : "Fill card with AI"}
        title={currentText.trim() ? "Get AI suggestions" : "Fill card with AI"}
        aria-expanded={isOpen}
        className="h-8 w-8 p-0 text-muted-foreground hover:text-primary"
        onClick={fetchSuggestions}
        disabled={isLoading}
      >
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
      </Button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-64 p-2 bg-popover text-popover-foreground border rounded-lg shadow-lg z-50">
            <div className="space-y-1">
              {suggestions.length === 0 && !isLoading && (
                <p className="text-sm text-muted-foreground text-center py-2">No suggestions found.</p>
              )}
              {suggestions.map((s, i) => (
                <Button
                  key={i}
                  variant="ghost"
                  type="button"
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
      {errorDialog}
    </div>
  );
}
