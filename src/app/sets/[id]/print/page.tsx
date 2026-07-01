import React from 'react';
import { prisma } from '@/lib/db';
import { PrintableQuiz } from '@/components/quiz/PrintableQuiz';
import { notFound } from 'next/navigation';

export default async function PrintPage({ params }: { params: { id: string } }) {
  const { id } = params;

  const set = await prisma.set.findUnique({
    where: { id },
    include: { cards: true },
  });

  if (!set) {
    notFound();
  }

  const questions = set.cards.map(card => ({
    id: card.id,
    prompt: card.term,
    answer: card.definition,
  }));

  return <PrintableQuiz title={set.title} questions={questions} />;
}
