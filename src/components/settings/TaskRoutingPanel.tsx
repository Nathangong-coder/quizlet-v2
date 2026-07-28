'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { listCredentials, listTaskRoutings, saveTaskRouting, type CredentialRow } from '@/actions/ai-credentials';
import { PROVIDER_META, type ProviderId } from '@/lib/ai/providers';

const TASKS = ['grade', 'plan', 'distractors', 'autocomplete'] as const;
type Task = (typeof TASKS)[number];

const TASK_LABELS: Record<Task, string> = {
  grade: 'Grading (short-answer & spoken)',
  plan: 'Training plan generation',
  distractors: 'Multiple-choice distractors',
  autocomplete: 'Card autocomplete',
};

interface RowState {
  credentialId: string;
  model: string;
}

const EMPTY_ROW: RowState = { credentialId: '', model: '' };

export default function TaskRoutingPanel() {
  const [credentials, setCredentials] = useState<CredentialRow[]>([]);
  const [routing, setRouting] = useState<Record<Task, RowState>>({
    grade: { ...EMPTY_ROW },
    plan: { ...EMPTY_ROW },
    distractors: { ...EMPTY_ROW },
    autocomplete: { ...EMPTY_ROW },
  });
  const [loading, setLoading] = useState(true);
  const [savingTask, setSavingTask] = useState<Task | null>(null);

  useEffect(() => {
    (async () => {
      const [credsResult, routingResult] = await Promise.all([listCredentials(), listTaskRoutings()]);
      if (credsResult.success) setCredentials(credsResult.data);
      else toast.error(credsResult.error);

      if (routingResult.success) {
        setRouting((prev) => {
          const next = { ...prev };
          for (const row of routingResult.data) {
            if (TASKS.includes(row.task as Task)) {
              next[row.task as Task] = {
                credentialId: row.credentialId ?? '',
                model: row.model ?? '',
              };
            }
          }
          return next;
        });
      } else {
        toast.error(routingResult.error);
      }
      setLoading(false);
    })();
  }, []);

  function updateRow(task: Task, patch: Partial<RowState>) {
    setRouting((prev) => ({ ...prev, [task]: { ...prev[task], ...patch } }));
  }

  async function handleSave(task: Task) {
    setSavingTask(task);
    const row = routing[task];
    const result = await saveTaskRouting(task, row.credentialId || null, row.model.trim() || null);
    setSavingTask(null);
    if (result.success) {
      toast.success(`${TASK_LABELS[task]} routing saved`);
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Task routing</CardTitle>
        <CardDescription>
          Send specific tasks to a specific credential and model, instead of the default fallback order.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-6">Loading…</p>
        ) : (
          TASKS.map((task) => {
            const row = routing[task];
            return (
              <div key={task} className="space-y-2 pb-4 border-b last:border-b-0 last:pb-0">
                <Label>{TASK_LABELS[task]}</Label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <select
                    className="h-8 flex-1 rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground dark:bg-input/30"
                    value={row.credentialId}
                    onChange={(e) => updateRow(task, { credentialId: e.target.value })}
                  >
                    <option value="">Use provider default</option>
                    {credentials.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label} ({PROVIDER_META[c.provider as ProviderId]?.label ?? c.provider})
                      </option>
                    ))}
                  </select>
                  <Input
                    value={row.model}
                    onChange={(e) => updateRow(task, { model: e.target.value })}
                    placeholder="Model override (optional)"
                    className="sm:max-w-xs"
                  />
                  <Button variant="outline" onClick={() => handleSave(task)} disabled={savingTask === task}>
                    {savingTask === task ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
