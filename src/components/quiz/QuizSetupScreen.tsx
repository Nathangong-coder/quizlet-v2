import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
          <Select
            value={setup.questionMode}
            onValueChange={(v) => setSetup(prev => ({ ...prev, questionMode: v }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="multiple-choice">Multiple Choice</SelectItem>
              <SelectItem value="short-answer">Short Answer</SelectItem>
              <SelectItem value="matching">Matching</SelectItem>
              <SelectItem value="true-false">True/False</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Prompt Side</Label>
          <Select
            value={setup.promptSide}
            onValueChange={(v) => setSetup(prev => ({ ...prev, promptSide: v }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="term">Term</SelectItem>
              <SelectItem value="definition">Definition</SelectItem>
              <SelectItem value="mixed">Mixed</SelectItem>
            </SelectContent>
          </Select>
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
                <Checkbox
                  checked={setup.categoryIds.includes(cat.id)}
                  onCheckedChange={() => {}} // Handle via parent div
                />
                <span className="text-sm">{cat.name}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="starredOnly"
              checked={setup.starredOnly}
              onCheckedChange={(v) => setSetup(prev => ({ ...prev, starredOnly: !!v }))}
            />
            <Label htmlFor="starredOnly">Starred Only</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="failedOnly"
              checked={setup.failedOnly}
              onCheckedChange={(v) => setSetup(prev => ({ ...prev, failedOnly: !!v }))}
            />
            <Label htmlFor="failedOnly">Previously Failed</Label>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="printable"
            checked={setup.printable}
            onCheckedChange={(v) => setSetup(prev => ({ ...prev, printable: !!v }))}
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
