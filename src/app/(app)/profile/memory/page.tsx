'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  getScopedMemoryStats,
  getStudyEventHistory,
  listMemoryFilterOptions,
  deleteStudyEvent,
  forgetCard,
  forgetSet,
  type MemoryFilterOptions,
  type ScopedMemoryStats,
  type StudyEventHistoryRow,
} from '@/actions/memory';
import { resetUserMemory } from '@/actions/user';
import { EMPTY_SCOPE, parseScope, serializeScope, scopeToCard, type HistoryScope } from '@/lib/memory/scope';
import ScopeLine from '@/components/memory/ScopeLine';
import ProfileNav from '@/components/profile/ProfileNav';
import ScopeStats from '@/components/memory/ScopeStats';
import ActivityTable from '@/components/memory/ActivityTable';

const NO_OPTIONS: MemoryFilterOptions = { sets: [], categories: [], cards: [] };

/** Loaded data tagged with the request key it answered. */
interface FeedState {
  key: string;
  events: StudyEventHistoryRow[];
  cursor: string | null;
  error?: string;
}

interface StatsState {
  key: string;
  value: ScopedMemoryStats | null;
}

function MemoryHistoryContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Scope lives in the URL so a filtered view survives reload, back/forward,
  // and can be shared. `qs` keys the memo so `scope` is referentially stable
  // per URL and safe to use as an effect dependency.
  const qs = searchParams.toString();
  const scope = useMemo(() => parseScope(new URLSearchParams(qs)), [qs]);

  const [options, setOptions] = useState<MemoryFilterOptions>(NO_OPTIONS);
  const [feed, setFeed] = useState<FeedState | null>(null);
  const [stats, setStats] = useState<StatsState | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Data is tagged with the request it answered, so "loading" is derived from
  // whether what we hold matches what the URL currently asks for. That avoids
  // a synchronous setState in the effect and keeps the two in lockstep.
  const requestKey = `${qs}::${reloadKey}`;
  const loading = feed?.key !== requestKey;
  const statsLoading = stats?.key !== requestKey;

  const setScope = useCallback(
    (next: HistoryScope) => {
      const query = serializeScope(next);
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  useEffect(() => {
    // Toggling chips quickly fires overlapping requests; ignore all but the
    // one belonging to the current scope so a slow earlier reply can't win.
    let cancelled = false;
    getStudyEventHistory(scope).then((result) => {
      if (cancelled) return;
      if (result.success) {
        setFeed({ key: requestKey, events: result.data.events, cursor: result.data.nextCursor });
      } else {
        toast.error(result.error);
        setFeed({ key: requestKey, events: [], cursor: null, error: result.error });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [scope, requestKey]);

  useEffect(() => {
    let cancelled = false;
    getScopedMemoryStats(scope).then((result) => {
      if (cancelled) return;
      if (result.success) {
        setStats({ key: requestKey, value: result.data });
      } else {
        toast.error(result.error);
        setStats({ key: requestKey, value: null });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [scope, requestKey]);

  // Only the card list depends on scope, so refetch options when sets change.
  const setIdsKey = scope.setIds.join(',');
  useEffect(() => {
    let cancelled = false;
    const setIds = setIdsKey ? setIdsKey.split(',') : [];
    listMemoryFilterOptions(setIds).then((result) => {
      if (cancelled) return;
      if (result.success) setOptions(result.data);
      else toast.error(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [setIdsKey]);

  const refresh = () => setReloadKey((n) => n + 1);

  async function handleLoadMore() {
    const cursor = feed?.cursor;
    if (!cursor) return;
    setLoadingMore(true);
    const result = await getStudyEventHistory({ ...scope, cursor });
    if (result.success) {
      const { events, nextCursor } = result.data;
      // Guard against the scope changing mid-request: only append if the page
      // we hold is still the one this request was issued against.
      setFeed((prev) =>
        prev && prev.key === requestKey
          ? { ...prev, events: [...prev.events, ...events], cursor: nextCursor }
          : prev,
      );
    } else {
      toast.error(result.error);
    }
    setLoadingMore(false);
  }

  async function handleDeleteEvent(eventId: string) {
    if (!confirm("Delete this entry? If it came from a quiz, the graded answer is deleted too, and this card's confidence and mastery are recomputed from its remaining history.")) return;
    const result = await deleteStudyEvent(eventId);
    if (result.success) {
      toast.success('Entry deleted');
      refresh();
    } else {
      toast.error(result.error);
    }
  }

  async function handleForgetCard() {
    if (!scope.cardId) return;
    const term = options.cards.find((c) => c.id === scope.cardId)?.term ?? 'this card';
    if (!confirm(`Forget everything about "${term}"? This deletes its study history AND its graded quiz answers, resets it to unseen, and unstars it. This cannot be undone.`)) return;
    const result = await forgetCard(scope.cardId);
    if (result.success) {
      toast.success('Card memory forgotten');
      setScope({ ...scope, cardId: undefined });
    } else {
      toast.error(result.error);
    }
  }

  async function handleForgetSet() {
    const setId = scope.setIds.length === 1 ? scope.setIds[0] : undefined;
    if (!setId) return;
    const title = options.sets.find((s) => s.id === setId)?.title ?? 'this set';
    if (!confirm(`Forget all memory for "${title}"? This deletes study history, graded quiz answers, and quiz results for every card in this set, and unstars them. This cannot be undone.`)) return;
    const result = await forgetSet(setId);
    if (result.success) {
      toast.success('Set memory forgotten');
      setScope(EMPTY_SCOPE);
    } else {
      toast.error(result.error);
    }
  }

  async function handleFullReset() {
    if (!confirm('Are you sure you want to reset your entire learning memory? This will delete all quiz history, confidence scores, progress, and your study activity — including matching and review sessions, not just quizzes. This action cannot be undone.')) return;
    setIsResetting(true);
    const result = await resetUserMemory();
    setIsResetting(false);
    if (result.success) {
      toast.success('Memory reset successfully');
      setScope(EMPTY_SCOPE);
      refresh();
    } else {
      toast.error(result.error || 'Failed to reset memory');
    }
  }

  // Counts for the activity picker's options. Held from the LAST successful
  // stats load rather than cleared while a new one is in flight: the picker is
  // what triggers the reload, so zeroing every count mid-request makes the
  // options flicker to 0 on the exact interaction that reads them.
  const sourceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const row of stats?.value?.bySource ?? []) counts[row.source] = row.count;
    return counts;
  }, [stats?.value?.bySource]);

  const canForgetCard = Boolean(scope.cardId);
  const canForgetSet = scope.setIds.length === 1 && !scope.cardId;
  const scopedCardTerm = options.cards.find((c) => c.id === scope.cardId)?.term ?? 'this card';
  const scopedSetTitle = options.sets.find((s) => s.id === scope.setIds[0])?.title ?? 'this set';

  return (
    <div className="max-w-5xl mx-auto px-4 py-12 space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Memory History</h1>
        <p className="text-muted-foreground mt-2">
          Every review and quiz answer that shaped your confidence scores. Filter by set or by
          category &mdash; categories span every set that uses the same name.
        </p>
      </div>

      <ProfileNav />

      <ScopeLine
        options={options}
        scope={scope}
        onChange={setScope}
        summary={
          stats?.value ? `${stats.value.totalEvents.toLocaleString()} answers` : undefined
        }
        // The activity picker lives here, next to sets and categories — one
        // filter surface, three dimensions. It replaces the by-mode chip row
        // that used to sit under the stat tiles below.
        activityFilter={{ counts: sourceCounts }}
      />

      <ScopeStats stats={stats?.value ?? null} loading={statsLoading} />

      {(canForgetCard || canForgetSet) && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {canForgetCard ? `Forget "${scopedCardTerm}"` : `Forget "${scopedSetTitle}"`}
              </p>
              <p className="text-sm text-muted-foreground">
                {canForgetCard
                  ? 'Deletes this card’s study history and its graded quiz answers, unstars it, and resets it to unseen.'
                  : 'Deletes study history, graded quiz answers, and quiz results for every card in this set.'}{' '}
                This cannot be undone.
              </p>
            </div>
            {canForgetCard ? (
              <Button variant="destructive" size="sm" onClick={handleForgetCard} className="shrink-0">
                <Trash2 className="w-4 h-4 mr-1" /> Forget this card
              </Button>
            ) : (
              <Button variant="destructive" size="sm" onClick={handleForgetSet} className="shrink-0">
                <Trash2 className="w-4 h-4 mr-1" /> Forget this set
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
          <CardDescription>
            Newest first. Select a card to open the activity it came from.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <p className="text-sm text-muted-foreground text-center py-8">Loading...</p>
          ) : feed?.error ? (
            <p className="text-sm text-destructive text-center py-8">{feed.error}</p>
          ) : feed!.events.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No history matches this scope.</p>
          ) : (
            <>
              <ActivityTable
                events={feed!.events}
                onScopeToCard={(event) => setScope(scopeToCard(scope, event))}
                onDelete={handleDeleteEvent}
              />
              {feed!.cursor && (
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
              This will permanently delete all your quiz history, confidence scores, progress, and study
              activity across all sets — including matching and review sessions, not just quizzes.
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

export default function MemoryHistoryPage() {
  return (
    <Suspense fallback={<div className="max-w-5xl mx-auto px-4 py-12 text-sm text-muted-foreground">Loading...</div>}>
      <MemoryHistoryContent />
    </Suspense>
  );
}
