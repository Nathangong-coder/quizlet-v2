"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { QuizSetup, QuizSetupSchema } from "@/lib/quiz/setup";
import { UNCATEGORIZED_ID } from "@/lib/cards/categories";
import { SelectableChip } from "@/components/ui/selectable-chip";
import { Input } from "@/components/ui/input";

type QuizMode = QuizSetup["questionMode"][number];
type PromptSide = QuizSetup["promptSide"];

/** The four modes and their labels, in one place instead of a nested ternary. */
const MODES: { value: QuizMode; label: string }[] = [
  { value: "multiple-choice", label: "Multiple Choice" },
  { value: "short-answer", label: "Short Answer" },
  { value: "matching", label: "Matching" },
  { value: "true-false", label: "True/False" },
];

const SIDES: { value: PromptSide; label: string }[] = [
  { value: "term", label: "Term" },
  { value: "definition", label: "Definition" },
  { value: "mixed", label: "Mixed" },
];

/**
 * The print URL.
 *
 * Pure and exported so the filter carry-through is testable. It previously
 * carried only modes/side/count, so Categories, Starred Only and Previously
 * Failed were silently dropped and the learner got a test over the whole set.
 */
export function printQuizHref(setId: string, setup: QuizSetup): string {
  const qs = new URLSearchParams({
    modes: setup.questionMode.join(","),
    side: setup.promptSide,
    count: String(setup.questionCount),
  });
  if (setup.categoryIds.length > 0) qs.set("cats", setup.categoryIds.join(","));
  // Only when true: `starred=0` in the URL reads as a filter that is set.
  if (setup.starredOnly) qs.set("starred", "1");
  if (setup.failedOnly) qs.set("failed", "1");
  return `/sets/${setId}/print?${qs.toString()}`;
}

interface QuizSetupScreenProps {
  setId: string;
  availableCategories: { id: string; name: string; color?: string | null }[];
  /**
   * Spec 3C §6.5: categories pre-ticked from the learner's saved study scope,
   * resolved server-side to THIS set's ids. A prefill, not a constraint — every
   * toggle below still works and the learner can clear them.
   */
  initialCategoryIds?: string[];
  /** Set true when this set sits outside the saved scope; renders a one-liner. */
  outOfScope?: boolean;
  onStart: (setup: QuizSetup) => void;
}

export function QuizSetupScreen({
  setId,
  availableCategories,
  initialCategoryIds,
  outOfScope,
  onStart,
}: QuizSetupScreenProps) {
  const [setup, setSetup] = useState<QuizSetup>({
    questionMode: ["multiple-choice"],
    promptSide: "term",
    categoryIds: initialCategoryIds ?? [],
    starredOnly: false,
    failedOnly: false,
    printable: false,
    questionCount: 10,
  });

  const toggleCategory = (id: string) => {
    setSetup((prev) => ({
      ...prev,
      categoryIds: prev.categoryIds.includes(id)
        ? prev.categoryIds.filter((c) => c !== id)
        : [...prev.categoryIds, id],
    }));
  };

  const toggleMode = (mode: QuizMode) => {
    setSetup((prev) => ({
      ...prev,
      questionMode: prev.questionMode.includes(mode)
        ? prev.questionMode.filter((m) => m !== mode)
        : [...prev.questionMode, mode],
    }));
  };

  // `QuizSetupSchema` already requires at least one mode; the screen let the
  // learner reach an empty selection and press Start anyway, so the failure
  // surfaced from the server instead of from the control that caused it.
  const noModes = setup.questionMode.length === 0;

  return (
    <Card className="max-w-lg mx-auto">
      <CardHeader>
        <CardTitle>Quiz Setup</CardTitle>
        <CardDescription>Configure your quiz parameters before starting.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {outOfScope && (
          /* Said out loud rather than handled silently. Prefilling a set the
             learner excluded would be confusing; blocking it would be
             enforcement, which the scope deliberately is not. */
          <p className="text-sm text-muted-foreground rounded-lg border border-dashed p-3">
            This set is outside your saved study scope, so no categories were pre-selected.
            You can still quiz on all of it.
          </p>
        )}

        <div className="space-y-2">
          <Label>Question Mode</Label>
          {/* Was a `<div onClick>` wrapping a readOnly checkbox: not focusable,
              no role, no announced state, and unusable by keyboard. */}
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Question Mode">
            {MODES.map((mode) => (
              <SelectableChip
                key={mode.value}
                semantics="checkbox"
                label={mode.label}
                selected={setup.questionMode.includes(mode.value)}
                onToggle={() => toggleMode(mode.value)}
                className="justify-center rounded-lg"
              />
            ))}
          </div>
          {noModes && (
            <p className="text-sm text-destructive">
              Pick at least one question mode.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="promptSide">Prompt Side</Label>
          <select
            id="promptSide"
            className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={setup.promptSide}
            onChange={(e) =>
              setSetup((prev) => ({ ...prev, promptSide: e.target.value as PromptSide }))
            }
          >
            {SIDES.map((side) => (
              <option key={side.value} value={side.value}>
                {side.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="questionCount">Number of Questions</Label>
          <Input
            id="questionCount"
            type="number"
            value={setup.questionCount}
            onChange={(e) =>
              setSetup((prev) => ({ ...prev, questionCount: parseInt(e.target.value) || 1 }))
            }
            min={1}
          />
        </div>

        <div className="space-y-3">
          <Label>Categories</Label>
          <div className="flex flex-wrap gap-2">
            {/* Was a `<div onClick>` wrapping a readOnly checkbox: not
                focusable, no role, no announced state, and tinted with the
                category's own colour when active. */}
            {[
              ...availableCategories,
              { id: UNCATEGORIZED_ID, name: "Uncategorized", color: null },
            ].map((cat) => (
              <SelectableChip
                key={cat.id}
                semantics="checkbox"
                label={cat.name}
                color={cat.color}
                selected={setup.categoryIds.includes(cat.id)}
                onToggle={() => toggleCategory(cat.id)}
              />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="starredOnly"
              className="h-4 w-4 rounded border-input"
              checked={setup.starredOnly}
              onChange={(e) => setSetup(prev => ({ ...prev, starredOnly: e.target.checked }))}
            />
            <Label htmlFor="starredOnly">Starred Only</Label>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="failedOnly"
              className="h-4 w-4 rounded border-input"
              checked={setup.failedOnly}
              onChange={(e) => setSetup(prev => ({ ...prev, failedOnly: e.target.checked }))}
            />
            <Label htmlFor="failedOnly">Previously Failed</Label>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="printable"
            className="h-4 w-4 rounded border-input"
            checked={setup.printable}
            onChange={(e) => setSetup(prev => ({ ...prev, printable: e.target.checked }))}
          />
          <Label htmlFor="printable">Printable Test</Label>
        </div>

        <div className="flex gap-3">
          {/* Both actions were enabled with zero modes selected, which starts a
              quiz that cannot produce a question. */}
          <Button className="flex-1" disabled={noModes} onClick={() => onStart(setup)}>
            Start Quiz
          </Button>
          <Button
            variant="outline"
            disabled={noModes}
            onClick={() => window.open(printQuizHref(setId, setup), '_blank')}
          >
            Print Test
          </Button>
        </div>

      </CardContent>
    </Card>
  );
}
