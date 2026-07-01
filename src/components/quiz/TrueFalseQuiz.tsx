"use client";

import React from "react";
import { Card as CardUI, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Card as PrismaCard } from "@prisma/client";
import { cn } from "@/lib/utils";

interface TrueFalseQuizProps {
  cards: PrismaCard[];
  onAnswer: (cardId: string, answer: string) => void;
  answers: { [key: string]: string };
}

export function TrueFalseQuiz({ cards, onAnswer, answers }: TrueFalseQuizProps) {
  return (
    <div className="space-y-6">
      {cards.map((card, i) => (
        <CardUI key={card.id} className="max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle className="text-lg">Question {i + 1}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <div className="p-4 bg-muted rounded-lg space-y-2">
              <p className="font-bold text-sm text-muted-foreground uppercase tracking-wider">Term</p>
              <p className="text-xl font-medium">{card.term}</p>
              <div className="h-px bg-border my-2" />
              <p className="font-bold text-sm text-muted-foreground uppercase tracking-wider">Definition</p>
              <p className="text-lg">{card.definition}</p>
            </div>

            <p className="text-sm text-muted-foreground">Is this the correct definition?</p>

            <div className="flex justify-center gap-4">
              {["true", "false"].map((val) => (
                <Button
                  key={val}
                  variant={answers[card.id] === val ? "default" : "outline"}
                  onClick={() => onAnswer(card.id, val)}
                  className="px-8 capitalize"
                >
                  {val}
                </Button>
              ))}
            </div>
          </CardContent>
        </CardUI>
      ))}
    </div>
  );
}
