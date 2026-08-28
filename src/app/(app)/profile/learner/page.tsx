'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import ScopeLine from '@/components/memory/ScopeLine';
import ProfileNav from '@/components/profile/ProfileNav';
import EmptyDashboard from '@/components/learner/EmptyDashboard';
import MissedWork from '@/components/learner/MissedWork';
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
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Learner Profile</h1>
        <p className="text-muted-foreground mt-2">
          What the app has actually learned about you, and what it would put in front of you next.
          Every number here comes from answers you have given.
        </p>
      </div>

      <ProfileNav />

      {/* Both notices are required, not decorative. A filtered view the learner
          did not choose on this visit — or a scope that quietly stopped working
          — is indistinguishable from a broken page. */}
      {d?.widened && (
        <Card className="border-warning/50 bg-warning/5">
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

      {/* The saved-scope notice, the "Show everything" button and the scope
          editor used to be three stacked affordances for one value. They are
          now one line. The amber banner above stays separate on purpose: it is
          an error state, not a control. */}
      <ScopeLine
        options={options}
        scope={d?.appliedScope ?? { setIds: [], categoryKeys: [], sources: [] }}
        onChange={setScope}
        // No `activityFilter` here, deliberately: this page renders a knowledge
        // model, and narrowing it to one answer mode silently halves every
        // posterior it touches. See ScopeLineProps.
        savedScope={
          d?.defaultApplied
            ? {
                onShowEverything: () =>
                  router.replace(`${pathname}?${SCOPE_ALL_PARAM}=all`, { scroll: false }),
              }
            : undefined
        }
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

          {/* Spec §8. Leads the page: "what am I getting wrong" is the
              question a learner arrives with, and every panel below answers a
              narrower one. The existing panels are untouched. */}
          <MissedWork topics={d.missed} floor={d.thresholds.minObservations} />

          <StudyNext
            // Labels are merged here rather than inside `getLearnerMetrics`, so
            // the scoring pipeline keeps returning candidates with no prose on
            // them. `topicName` already worked this way; `text` and `term` join
            // it from the same read.
            ranked={d.metrics.ranked.map((c) => ({
              ...c,
              topicName: topicNames[c.topicKey],
              label: d.metrics.candidateLabels[c.klpId]?.label,
              text: d.metrics.candidateLabels[c.klpId]?.text,
              term: d.metrics.candidateLabels[c.klpId]?.term,
            }))}
            strategy={d.strategy}
            floor={d.thresholds.minObservations}
          />

          <TopicMastery
            topics={d.metrics.profile.topics}
            floor={d.thresholds.minObservations}
          />

          {/* The AI-derived axis, BESIDE the category axis rather than
              replacing it — a category is often a format label, which filters
              well and rolls up to a concept badly. */}
          {d.metrics.kltTopics.length > 0 && (
            <TopicMastery
              topics={d.metrics.kltTopics}
              floor={d.thresholds.minObservations}
              heading="Topic mastery (auto-detected)"
              blurb="Topics the app derived from your cards' key points, rather than from the categories you wrote. Scored exactly the same way."
              breadcrumbs={d.metrics.kltBreadcrumbs}
            />
          )}

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
        <div className="text-sm text-muted-foreground">Loading…</div>
      }
    >
      <LearnerDashboardContent />
    </Suspense>
  );
}
