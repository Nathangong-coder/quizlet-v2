'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Trophy, History, Activity } from 'lucide-react';
import { getUserStats, type UserStats } from '@/actions/user';
import { toast } from 'sonner';
import { format } from 'date-fns';

export default function ProfilePage() {
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getUserStats().then((result) => {
      if (cancelled) return;
      if (result.success && result.data) setStats(result.data);
      else toast.error(result.error || 'Failed to load profile stats');
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">Failed to load your profile.</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-12 space-y-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Your Learning Memory</h1>
          <p className="text-muted-foreground mt-2">Track your progress and mastery across all sets.</p>
          <Link href="/profile/memory" className="text-sm text-primary hover:underline inline-block mt-2">
            View full memory history &rarr;
          </Link>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Activity className="w-4 h-4" />
          <span>Real-time Progress Tracking</span>
        </div>
      </div>

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
        <Card>
          <CardHeader>
            <CardTitle>Performance by Mode</CardTitle>
            <CardDescription>Your average score and activity per quiz type.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {stats.modeStats.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No quiz attempts yet. Start studying!</p>
            ) : (
              stats.modeStats.map((s) => (
                <div key={s.mode} className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                  <div className="flex flex-col">
                    <span className="font-medium capitalize">{s.mode.replace('-', ' ')}</span>
                    <span className="text-xs text-muted-foreground">{s.count} attempts</span>
                  </div>
                  <Badge variant="outline" className="text-lg px-3 py-1">
                    {s.averageScore === null ? '—' : `${s.averageScore}%`}
                  </Badge>
                </div>
              ))
            )}
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
