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
import { AI_TASKS, type AiTask } from '@/lib/ai/model-routing';

const TASKS = AI_TASKS;
type Task = AiTask;

const TASK_LABELS: Record<Task, string> = {
  grade: 'Grading (short-answer & spoken)',
  plan: 'Training plan generation',
  distractors: 'Multiple-choice distractors',
  autocomplete: 'Card autocomplete & autofill',
  'note-analysis': 'Study note analysis',
  diagnostic: 'Diagnostic test generation & grading',
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
    'note-analysis': { ...EMPTY_ROW },
    diagnostic: { ...EMPTY_ROW },
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
              // A stored model with no credential is legacy invalid state (it
              // is rejected on save now). Drop it rather than surfacing an
              // override the user cannot edit or re-save.
              next[row.task as Task] = {
                credentialId: row.credentialId ?? '',
                model: row.credentialId ? row.model ?? '' : '',
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

  /**
   * A model override only means something alongside a pinned credential —
   * model ids are provider-specific, so there is no such thing as one that is
   * valid for a whole heterogeneous pool. Clearing the override when the user
   * returns to "Use provider default" keeps the UI from producing the
   * combination `saveTaskRouting` rejects.
   */
  function selectCredential(task: Task, credentialId: string) {
    updateRow(task, credentialId ? { credentialId } : { credentialId: '', model: '' });
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
                    onChange={(e) => selectCredential(task, e.target.value)}
                  >
                    <option value="">Use provider default</option>
                    {credentials.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label} ({PROVIDER_META[c.provider as ProviderId]?.label ?? c.provider})
                        {c.enabled ? '' : ' — disabled'}
                      </option>
                    ))}
                  </select>
                  <Input
                    value={row.model}
                    onChange={(e) => updateRow(task, { model: e.target.value })}
                    disabled={!row.credentialId}
                    placeholder={
                      row.credentialId ? 'Model override (optional)' : 'Pick a credential to override its model'
                    }
                    title={
                      row.credentialId
                        ? undefined
                        : 'A model id only applies to one provider, so an override needs a specific credential.'
                    }
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
