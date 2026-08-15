'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Trophy, History, Activity } from 'lucide-react';
import { getUserStats, type UserStats } from '@/actions/user';
import ProfileNav from '@/components/profile/ProfileNav';
import { toast } from 'sonner';
import { format } from 'date-fns';

export default function ProfilePage() {
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getUserStats().then((result) => {
      if (cancelled) return;
      if (result.success && result.data) setStats(result.data);
      else toast.error(result.error || 'Failed to load profile stats');
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // The header and nav render IMMEDIATELY. A full-route spinner hid the
  // navigation that is the whole point of having it — a learner waiting on
  // `getUserStats` could not leave for the page that would have answered them.
  const chrome = (
    <div>
      <h1 className="text-4xl font-bold tracking-tight">Profile</h1>
      <p className="text-muted-foreground mt-2">
        Your activity at a glance. The learner profile is where the app says what it thinks you
        know.
      </p>
    </div>
  );

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-12 space-y-8">
        {chrome}
        <ProfileNav />
        <p className="text-sm text-muted-foreground text-center py-12">Loading your activity…</p>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-12 space-y-8">
        {chrome}
        <ProfileNav />
        <div className="text-center py-12 space-y-3">
          <p className="text-muted-foreground">Could not load your activity.</p>
          {/* A dead end before: no retry, and no navigation to anywhere else. */}
          <Button variant="outline" onClick={() => setReloadKey((n) => n + 1)}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-12 space-y-8">
      {chrome}
      <ProfileNav />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="flex flex-col items-center text-center pb-2">
            <Trophy className="w-8 h-8 text-yellow-500 mb-2" />
            <CardTitle>Mastered Cards</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-center">{stats.masteredCards}</div>
            <p className="text-xs text-center text-muted-foreground mt-1">Cards with confidence &ge; 8</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col items-center text-center pb-2">
            <History className="w-8 h-8 text-blue-500 mb-2" />
            <CardTitle>Total Attempts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-center">{stats.totalAttempts}</div>
            <p className="text-xs text-center text-muted-foreground mt-1">Quizzes completed</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col items-center text-center pb-2">
            <Activity className="w-8 h-8 text-green-500 mb-2" />
            <CardTitle>Avg Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-center">
              {stats.overallAverageScore === null ? '—' : `${stats.overallAverageScore}%`}
            </div>
            <p className="text-xs text-center text-muted-foreground mt-1">Across all graded attempts</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* This slot used to hold "Performance by Mode" — a flat average score
            per quiz type. It was removed rather than restyled: since Spec 3,
            the learner page answers "how am I doing?" from the same answers
            using knowledge, articulation and retention, and two pages
            answering that question with different numbers is how a learner
            stops trusting both. Attempt COUNTS stay above, because those are
            activity facts rather than judgements. */}
        <Card>
          <CardHeader>
            <CardTitle>What you know</CardTitle>
            <CardDescription>
              Scores say how a quiz went. The learner profile says what you actually know, how well
              you can express it, and what to study next.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Built from every answer you have given — per key point, not per quiz.
            </p>
            <Link href="/profile/learner" className={cn(buttonVariants({ variant: 'outline' }))}>
              Open your learner profile
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Your most recent quiz attempts.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {stats.recentAttempts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No recent activity.</p>
            ) : (
              stats.recentAttempts.map((attempt) => (
                <div key={attempt.id} className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                  <div className="flex flex-col min-w-0">
                    <span className="font-medium capitalize">{attempt.mode.replace('-', ' ')}</span>
                    <span className="text-xs text-muted-foreground truncate">
                      {attempt.setTitle} &middot; {format(new Date(attempt.date), 'MMM d, h:mm a')}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-sm font-bold">
                      {attempt.score === null ? '—' : `${attempt.score}%`}
                    </span>
                    {/* The activity permalink is keyed on the session, not the
                        attempt, and nothing else in the app links to it. Absent
                        for pre-Stage-6 attempts, which have no session envelope
                        — those render with History alone rather than a dead link. */}
                    {attempt.sessionId && (
                      <Link
                        href={`/profile/activity/${attempt.sessionId}`}
                        className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'h-8 px-2 text-xs')}
                      >
                        Results
                      </Link>
                    )}
                    <Link
                      href={`/profile/memory?sets=${attempt.setId}`}
                      className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'h-8 px-2 text-xs')}
                    >
                      History
                    </Link>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
