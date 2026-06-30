import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { submitMultipleChoiceAnswer } from "@/actions/quiz";
import { Card } from "@prisma/client";

interface TrueFalseQuizProps {
  cards: Card[];
  attemptId: string;
  onFinish: (score: number) => void;
}

export function TrueFalseQuiz({ cards, attemptId, onFinish }: TrueFalseQuizProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; isCorrect: boolean } | null>(null);

  const currentCard = cards[currentIndex];
  if (!currentCard) return null;

  const isTruePrompt = Math.random() > 0.5;
  const prompt = isTruePrompt
    ? `${currentCard.term} is ${currentCard.definition}`
    : `${currentCard.term} is ${cards[Math.floor(Math.random() * cards.length)].definition}`;

  const correctValue = isTruePrompt ? "true" : "false";

  const handleSubmit = async () => {
    if (!selected) return;
    setIsLoading(true);

    // We reuse submitMultipleChoiceAnswer since it's essentially a binary choice
    const result = await submitMultipleChoiceAnswer({
      attemptId,
      cardId: currentCard.id,
      selectedOption: selected,
      correctAnswer: correctValue,
    });

    setIsLoading(false);
    if (result.success && result.data) {
      setFeedback({ text: result.data.feedback || (result.data.isCorrect ? "Correct!" : "Incorrect."), isCorrect: result.data.isCorrect });
    }
  };

  const nextQuestion = () => {
    setFeedback(null);
    setSelected(null);
    if (currentIndex < cards.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      // Calculate final score (simplified)
      onFinish(100); // In real impl, fetch attempt score
    }
  };

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>True or False?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 text-center">
        <div className="text-2xl font-medium p-6 bg-gray-50 rounded-lg">
          {prompt}
        </div>

        <div className="flex justify-center gap-4">
          <Button
            variant={selected === "true" ? "default" : "outline"}
            onClick={() => setSelected("true")}
            disabled={isLoading || !!feedback}
          >
            True
          </Button>
          <Button
            variant={selected === "false" ? "default" : "outline"}
            onClick={() => setSelected("false")}
            disabled={isLoading || !!feedback}
          >
            False
          </Button>
        </div>

        {!feedback ? (
          <Button
            disabled={!selected || isLoading}
            onClick={handleSubmit}
            className="w-full"
          >
            {isLoading ? "Checking..." : "Submit Answer"}
          </Button>
        ) : (
          <div className="space-y-4">
            <div className={cn("p-4 rounded-lg", feedback.isCorrect ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800")}>
              {feedback.text}
            </div>
            <Button className="w-full" onClick={nextQuestion}>
              {currentIndex < cards.length - 1 ? "Next Question" : "Finish Quiz"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
