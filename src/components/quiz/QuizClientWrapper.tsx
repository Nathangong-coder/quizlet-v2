"use client";

import React, { useState } from "react";
import { QuizContainer } from "./QuizContainer";
import { QuizSetupScreen } from "./QuizSetupScreen";
import { Separator } from "@/components/ui/separator";
import { TrainingPlanPanel } from "./TrainingPlanPanel";

export function QuizClientWrapper({
  setId,
  cards,
  categories,
  initialCategoryIds,
  outOfScope,
}: {
  setId: string
  cards: any[]
  categories: { id: string; name: string; color?: string | null }[]
  /** Resolved server-side from the saved study scope — see `resolveScopePrefill`. */
  initialCategoryIds?: string[]
  outOfScope?: boolean
}) {
  const [setup, setSetup] = useState<any>(null);

  if (!setup) {
    return (
      <QuizSetupScreen
        setId={setId}
        availableCategories={categories}
        initialCategoryIds={initialCategoryIds}
        outOfScope={outOfScope}
        onStart={(s) => setSetup(s)}
      />
    );
  }

  return (
    <div className="space-y-8">
        <QuizContainer setId={setId} cards={cards} setup={setup} />
        <Separator />
        <TrainingPlanPanel setId={setId} />
    </div>
  );
}
