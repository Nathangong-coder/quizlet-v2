'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Trash2, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  getStudyEventHistory,
  listMemoryFilterOptions,
  deleteStudyEvent,
  forgetCard,
  forgetSet,
  type StudyEventHistoryRow,
} from '@/actions/memory';
import { resetUserMemory } from '@/actions/user';

const SOURCE_LABELS: Record<string, string> = {
  review: 'Review',
  'quiz-mc': 'Quiz (Multiple Choice)',
  'quiz-sa': 'Quiz (Short Answer)',
  'quiz-tf': 'Quiz (True/False)',
  matching: 'Matching Game',
  lesson: 'Lesson',
};

export default function MemoryHistoryPage() {
  const [setId, setSetId] = useState('');
  const [cardId, setCardId] = useState('');
  const [source, setSource] = useState('');

  const [events, setEvents] = useState<StudyEventHistoryRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sets, setSets] = useState<{ id: string; title: string }[]>([]);
  const [cards, setCards] = useState<{ id: string; term: string }[]>([]);
  const [isResetting, setIsResetting] = useState(false);

  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    const result = await getStudyEventHistory({
      setId: setId || undefined,
      cardId: cardId || undefined,
      source: source || undefined,
    });
    if (result.success) {
      setEvents(result.data.events);
      setCursor(result.data.nextCursor);
    } else {
      toast.error(result.error);
    }
    setLoading(false);
  }, [setId, cardId, source]);

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  useEffect(() => {
    listMemoryFilterOptions(setId || undefined).then((result) => {
      if (result.success) {
        setSets(result.data.sets);
        setCards(result.data.cards);
      }
    });
  }, [setId]);

  function handleSetChange(value: string) {
    setSetId(value);
    setCardId('');
  }

  async function handleLoadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    const result = await getStudyEventHistory({
      setId: setId || undefined,
      cardId: cardId || undefined,
      source: source || undefined,
      cursor,
    });
    if (result.success) {
      setEvents((prev) => [...prev, ...result.data.events]);
      setCursor(result.data.nextCursor);
    } else {
      toast.error(result.error);
    }
    setLoadingMore(false);
  }

  async function handleDeleteEvent(eventId: string) {
    if (!confirm("Delete this entry? This will recompute this card's confidence and mastery from its remaining history.")) return;
    const result = await deleteStudyEvent(eventId);
    if (result.success) {
      toast.success('Entry deleted');
      loadFirstPage();
    } else {
      toast.error(result.error);
    }
  }

  async function handleForgetCard() {
    if (!cardId) return;
    const term = cards.find((c) => c.id === cardId)?.term ?? 'this card';
    if (!confirm(`Forget everything about "${term}"? This deletes all its history and resets it to unseen. This cannot be undone.`)) return;
    const result = await forgetCard(cardId);
    if (result.success) {
      toast.success('Card memory forgotten');
      setCardId('');
    } else {
      toast.error(result.error);
    }
  }

  async function handleForgetSet() {
    if (!setId) return;
    const title = sets.find((s) => s.id === setId)?.title ?? 'this set';
    if (!confirm(`Forget all memory for "${title}"? This deletes history for every card in this set. This cannot be undone.`)) return;
    const result = await forgetSet(setId);
    if (result.success) {
      toast.success('Set memory forgotten');
      setSetId('');
      setCardId('');
    } else {
      toast.error(result.error);
    }
  }

  async function handleFullReset() {
    if (!confirm('Are you sure you want to reset your entire learning memory? This will delete all quiz history, confidence scores, and progress. This action cannot be undone.')) return;
    setIsResetting(true);
    const result = await resetUserMemory();
    setIsResetting(false);
    if (result.success) {
      toast.success('Memory reset successfully');
      setSetId('');
      setCardId('');
      loadFirstPage();
    } else {
      toast.error(result.error || 'Failed to reset memory');
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-12 space-y-8">
      <div>
        <Link href="/profile" className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1 mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to profile
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Memory History</h1>
        <p className="text-muted-foreground mt-2">Every review and quiz answer that shaped your confidence scores.</p>
      </div>

      <Card>
        <CardContent className="pt-6 flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Set</label>
            <select
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
              value={setId}
              onChange={(e) => handleSetChange(e.target.value)}
            >
              <option value="">All sets</option>
              {sets.map((s) => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Card</label>
            <select
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm disabled:opacity-50"
              value={cardId}
              disabled={!setId}
              onChange={(e) => setCardId(e.target.value)}
            >
              <option value="">All cards</option>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>{c.term}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Source</label>
            <select
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="">All sources</option>
              {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {cardId && (
            <Button variant="destructive" size="sm" onClick={handleForgetCard}>
              <Trash2 className="w-4 h-4 mr-1" /> Forget this card
            </Button>
          )}
          {setId && !cardId && (
            <Button variant="destructive" size="sm" onClick={handleForgetSet}>
              <Trash2 className="w-4 h-4 mr-1" /> Forget this set
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
          <CardDescription>Newest first.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <p className="text-sm text-muted-foreground text-center py-8">Loading...</p>
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No history matches these filters.</p>
          ) : (
            <>
              {events.map((event) => (
                <div key={event.id} className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors gap-3">
                  <div className="flex flex-col min-w-0">
                    <span className="font-medium truncate">{event.term}</span>
                    <span className="text-xs text-muted-foreground truncate">
                      {event.setTitle} &middot; {format(new Date(event.createdAt), 'MMM d, h:mm a')}
                    </span>
                  </div>
                  <Badge variant="outline">{SOURCE_LABELS[event.source] ?? event.source}</Badge>
                  <span className="text-sm w-16 text-right">
                    {event.score !== null ? `${event.score}%` : event.correct ? 'Correct' : 'Wrong'}
                  </span>
                  <span className="text-sm w-20 text-right text-muted-foreground">conf {event.confidenceAfter}</span>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => handleDeleteEvent(event.id)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
              {cursor && (
                <div className="pt-2 text-center">
                  <Button variant="outline" size="sm" onClick={handleLoadMore} disabled={loadingMore}>
                    {loadingMore ? 'Loading...' : 'Load more'}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/50 bg-destructive/5">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
          <CardDescription>Reset your learning memory to start fresh.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground max-w-md">
              This will permanently delete all your quiz history, confidence scores, and progress across all sets.
              This action cannot be undone.
            </p>
            <Button variant="destructive" onClick={handleFullReset} disabled={isResetting} className="whitespace-nowrap">
              {isResetting ? (
                'Resetting...'
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Reset Memory
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
