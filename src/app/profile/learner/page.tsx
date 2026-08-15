'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import ScopeBar from '@/components/memory/ScopeBar';
import EmptyDashboard from '@/components/learner/EmptyDashboard';
import TopicMastery from '@/components/learner/TopicMastery';
import StudyNext from '@/components/learner/StudyNext';
import { RetentionPanel, MisconceptionList } from '@/components/learner/RetentionPanel';
import { getLearnerDashboard, type LearnerDashboard } from '@/actions/learner-dashboard';
import { listMemoryFilterOptions, type MemoryFilterOptions } from '@/actions/memory';
import {
  hasExplicitScope,
  parseScope,
  serializeScope,
  SCOPE_ALL_PARAM,
  type HistoryScope,
} from '@/lib/memory/scope';

const NO_OPTIONS: MemoryFilterOptions = { sets: [], categories: [], cards: [] };

interface DataState {
  key: string;
  value: LearnerDashboard | null;
  error?: string;
}

function LearnerDashboardContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Scope lives in the URL so a filtered view survives reload and can be
  // shared — the same contract /profile/memory follows.
  const qs = searchParams.toString();

  // NULL means the URL expressed no scope at all, which is NOT an empty scope:
  // the action reads null as "use my saved default" and an empty scope as
  // "show me everything". `serializeScope(EMPTY_SCOPE)` is the empty string,
  // so without this distinction the two would be the same URL.
  const urlScope = useMemo<HistoryScope | null>(() => {
    const params = new URLSearchParams(qs);
    return hasExplicitScope(params) ? parseScope(params) : null;
  }, [qs]);

  const [options, setOptions] = useState<MemoryFilterOptions>(NO_OPTIONS);
  const [data, setData] = useState<DataState | null>(null);

  const requestKey = qs;
  const loading = data?.key !== requestKey;

  const setScope = useCallback(
    (next: HistoryScope) => {
      const query = serializeScope(next);
      // An empty scope must still say something, or the next load falls back
      // to the saved default and the learner's click appears to do nothing.
      router.replace(`${pathname}?${query || `${SCOPE_ALL_PARAM}=all`}`, { scroll: false });
    },
    [pathname, router],
  );

  useEffect(() => {
    let cancelled = false;
    getLearnerDashboard(urlScope).then((result) => {
      if (cancelled) return;
      if (result.success) setData({ key: requestKey, value: result.data });
      else {
        toast.error(result.error);
        setData({ key: requestKey, value: null, error: result.error });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [urlScope, requestKey]);

  const setIdsKey = (urlScope?.setIds ?? []).join(',');
  useEffect(() => {
    let cancelled = false;
    listMemoryFilterOptions(setIdsKey ? setIdsKey.split(',') : []).then((result) => {
      if (cancelled) return;
      if (result.success) setOptions(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [setIdsKey]);

  const d = data?.value ?? null;
  const topicNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of d?.metrics.profile.topics ?? []) map[t.key] = t.name;
    return map;
  }, [d]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-12 space-y-8">
      <div>
        <Link
          href="/profile"
          className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1 mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back to profile
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Learner Profile</h1>
        <p className="text-muted-foreground mt-2">
          What the app has actually learned about you, and what it would put in front of you next.
          Every number here comes from answers you have given.
        </p>
      </div>

      {/* Both notices are required, not decorative. A filtered view the learner
          did not choose on this visit — or a scope that quietly stopped working
          — is indistinguishable from a broken page. */}
      {d?.widened && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardContent className="py-4 space-y-1">
            <p className="text-sm font-medium">
              Your saved study scope no longer matches anything that exists — showing everything.
            </p>
            <p className="text-sm text-muted-foreground">
              {[
                d.staleSetIds.length > 0 && `${d.staleSetIds.length} deleted set${d.staleSetIds.length === 1 ? '' : 's'}`,
                d.staleCategoryKeys.length > 0 &&
                  `${d.staleCategoryKeys.length} missing categor${d.staleCategoryKeys.length === 1 ? 'y' : 'ies'} (${d.staleCategoryKeys.join(', ')})`,
              ]
                .filter(Boolean)
                .join(' and ')}
              .{' '}
              <Link href="/settings/ai" className="text-primary hover:underline">
                Update your scope
              </Link>
            </p>
          </CardContent>
        </Card>
      )}

      {d?.defaultApplied && (
        <Card className="bg-muted/40">
          <CardContent className="py-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Showing your saved study scope.{' '}
              <Link href="/settings/ai" className="text-primary hover:underline">
                Change it
              </Link>
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.replace(`${pathname}?${SCOPE_ALL_PARAM}=all`, { scroll: false })}
            >
              Show everything
            </Button>
          </CardContent>
        </Card>
      )}

      <ScopeBar
        options={options}
        scope={d?.appliedScope ?? { setIds: [], categoryKeys: [] }}
        onChange={setScope}
      />

      {loading ? (
        <p className="text-sm text-muted-foreground text-center py-12">Loading…</p>
      ) : data?.error ? (
        <p className="text-sm text-destructive text-center py-12">{data.error}</p>
      ) : !d ? null : d.empty?.blocking ? (
        <EmptyDashboard cause={d.empty} />
      ) : (
        <>
          {/* Non-blocking causes sit ABOVE the content they explain rather than
              replacing it — since Task 4B a library with no categories has a
              working study list and empty topic sections. */}
          {d.empty && <EmptyDashboard cause={d.empty} />}

          <StudyNext
            ranked={d.metrics.ranked.map((c) => ({ ...c, topicName: topicNames[c.topicKey] }))}
            strategy={d.strategy}
            floor={d.thresholds.minObservations}
          />

          <TopicMastery
            topics={d.metrics.profile.topics}
            floor={d.thresholds.minObservations}
          />

          <MisconceptionList misconceptions={d.metrics.misconceptions} />

          <RetentionPanel
            forgetting={d.metrics.forgetting}
            paceOutliers={d.metrics.paceOutliers}
          />
        </>
      )}
    </div>
  );
}

export default function LearnerProfilePage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-5xl mx-auto px-4 py-12 text-sm text-muted-foreground">Loading…</div>
      }
    >
      <LearnerDashboardContent />
    </Suspense>
  );
}
