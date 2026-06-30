"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { QuizSetup, QuizSetupSchema } from "@/lib/quiz/setup";

interface QuizSetupScreenProps {
  setId: string;
  availableCategories: { id: string; name: string }[];
  onStart: (setup: QuizSetup) => void;
}

export function QuizSetupScreen({ setId, availableCategories, onStart }: QuizSetupScreenProps) {
  const [setup, setSetup] = useState<QuizSetup>({
    questionMode: "multiple-choice",
    promptSide: "term",
    categoryIds: [],
    starredOnly: false,
    failedOnly: false,
    printable: false,
  });

  const toggleCategory = (id: string) => {
    setSetup((prev) => ({
      ...prev,
      categoryIds: prev.categoryIds.includes(id)
        ? prev.categoryIds.filter((c) => c !== id)
        : [...prev.categoryIds, id],
    }));
  };

  return (
    <Card className="max-w-lg mx-auto">
      <CardHeader>
        <CardTitle>Quiz Setup</CardTitle>
        <CardDescription>Configure your quiz parameters before starting.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>Question Mode</Label>
          <select
            className="w-full rounded border p-2 text-sm"
            value={setup.questionMode}
            onChange={(e) => setSetup(prev => ({ ...prev, questionMode: e.target.value as any }))}
          >
            <option value="multiple-choice">Multiple Choice</option>
            <option value="short-answer">Short Answer</option>
            <option value="matching">Matching</option>
            <option value="true-false">True/False</option>
          </select>
        </div>

        <div className="space-y-2">
          <Label>Prompt Side</Label>
          <select
            className="w-full rounded border p-2 text-sm"
            value={setup.promptSide}
            onChange={(e) => setSetup(prev => ({ ...prev, promptSide: e.target.value as any }))}
          >
            <option value="term">Term</option>
            <option value="definition">Definition</option>
            <option value="mixed">Mixed</option>
          </select>
        </div>

        <div className="space-y-3">
          <Label>Categories</Label>
          <div className="flex flex-wrap gap-2">
            {availableCategories.map((cat) => (
              <div
                key={cat.id}
                className="flex items-center gap-2 rounded-full border px-3 py-1 cursor-pointer hover:bg-gray-50"
                onClick={() => toggleCategory(cat.id)}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300"
                  checked={setup.categoryIds.includes(cat.id)}
                  readOnly
                />
                <span className="text-sm">{cat.name}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="starredOnly"
              className="h-4 w-4 rounded border-gray-300"
              checked={setup.starredOnly}
              onChange={(e) => setSetup(prev => ({ ...prev, starredOnly: e.target.checked }))}
            />
            <Label htmlFor="starredOnly">Starred Only</Label>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="failedOnly"
              className="h-4 w-4 rounded border-gray-300"
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
            className="h-4 w-4 rounded border-gray-300"
            checked={setup.printable}
            onChange={(e) => setSetup(prev => ({ ...prev, printable: e.target.checked }))}
          />
          <Label htmlFor="printable">Printable Test</Label>
        </div>

        <Button className="w-full" onClick={() => onStart(setup)}>
          Start Quiz
        </Button>
      </CardContent>
    </Card>
  );
}
