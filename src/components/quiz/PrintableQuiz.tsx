import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Printer, ArrowLeft } from "lucide-react";

interface PrintableQuizProps {
  title: string;
  questions: { id: string; prompt: string; answer: string }[];
}

export function PrintableQuiz({ title, questions }: PrintableQuizProps) {
  const [showAnswers, setShowAnswers] = useState(false);

  return (
    <div className="max-w-4xl mx-auto p-8">
      <div className="flex justify-between items-center mb-8 print:hidden">
        <Button variant="outline" onClick={() => window.history.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Quiz
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowAnswers(!showAnswers)}>
            {showAnswers ? "Hide Answers" : "Show Answers"}
          </Button>
          <Button onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" /> Print PDF
          </Button>
        </div>
      </div>

      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold mb-2">{title}</h1>
        <p className="text-muted-foreground">Name: __________________________ Date: __________</p>
      </div>

      <div className="space-y-8">
        {questions.map((q, i) => (
          <div key={q.id} className="page-break-inside-avoid border-b pb-4">
            <div className="flex gap-4">
              <span className="font-bold">{i + 1}.</span>
              <div className="flex-grow">
                <p className="text-lg mb-4">{q.prompt}</p>
                {showAnswers && (
                  <p className="text-green-600 font-medium">
                    Answer: {q.answer}
                  </p>
                )}
                <div className="mt-4 h-20 border-b border-gray-300" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
