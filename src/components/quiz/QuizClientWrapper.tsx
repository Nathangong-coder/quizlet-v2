"use client";

import React, { useState } from "react";
import { QuizContainer } from "./QuizContainer";
import { QuizSetupScreen } from "./QuizSetupScreen";
import { Separator } from "@/components/ui/separator";
import { TrainingPlanPanel } from "./TrainingPlanPanel";

export function QuizClientWrapper({ setId, cards, categories }: { setId: string; cards: any[]; categories: any[] }) {
  const [setup, setSetup] = useState<any>(null);

  if (!setup) {
    return (
      <QuizSetupScreen
        setId={setId}
        availableCategories={categories.map(c => ({ id: c.id, name: c.name }))}
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
