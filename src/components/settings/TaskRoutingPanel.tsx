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
import { GOOGLE_APPROVED_MODELS, isPolicedTask } from '@/lib/ai/model-policy';

const TASKS = AI_TASKS;
type Task = AiTask;

const TASK_LABELS: Record<Task, string> = {
  grade: 'Grading (short-answer & spoken)',
  plan: 'Training plan generation',
  distractors: 'Multiple-choice distractors',
  autocomplete: 'Card autocomplete & autofill',
  'note-analysis': 'Study note analysis',
  diagnostic: 'Diagnostic test generation & grading',
  author: 'KLP authoring (reference answers & discrimination test)',
};

/**
 * What each task actually does, when it fires, and whether its output is kept.
 *
 * "Stored and reused" is the distinction that matters, and the reason these
 * descriptions exist at all. A task whose output is thrown away after one
 * screen can run on anything; a task whose output is PERSISTED becomes
 * evidence — a key learning point is what a distractor gets corrupted from and
 * what a future answer is graded against, so a weak model there writes a wrong
 * fact into the learner's history, where nothing downstream can tell it apart
 * from a right one. Anyone choosing a model needs to know which kind of task
 * they are configuring, and the task NAMES do not tell them.
 */
const TASK_DESCRIPTIONS: Record<Task, string> = {
  grade:
    'Marks typed and spoken answers against the card’s key learning points and writes the result to your learning history. Runs on every answer you submit. Stored and reused.',
  plan: 'Builds a training plan from your confidence scores and past mistakes. Runs when you ask for one.',
  distractors:
    'Writes the wrong options for multiple-choice questions by corrupting one key learning point. That corruption is stored with the question, so a careless option can later be recorded as a misconception you never actually had. Stored and reused.',
  autocomplete:
    'Suggests terms and definitions while you build cards — and today it also extracts key learning points in the background when you save a set, and seeds and summarises the topic tree. That background work is stored and reused, so this task is far more load-bearing than its name suggests.',
  'note-analysis': 'Reads a study note and pulls out what is worth testing. Runs when you save a note.',
  diagnostic:
    'Writes and marks the questions in a diagnostic test. The results feed your learner profile. Stored and reused.',
  author:
    'The full authoring pipeline: drafts a reference answer, extracts key learning points, then tests them against deliberately wrong answers and keeps only the ones that tell a strong answer from a weak one. Slow, run rarely, and the most quality-sensitive task here. Stored and reused.',
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
    author: { ...EMPTY_ROW },
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
          Every AI feature in the app belongs to one of the tasks below, and all of them run on
          <strong> your own keys</strong>. By default a task uses whichever of your keys was least recently
          tried, on that key&rsquo;s own model. Pin a task here to send it to one specific key and model
          instead. Tasks marked <strong>stored and reused</strong> write results that later answers are
          graded against, so their model choice is restricted on Google keys.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-6">Loading…</p>
        ) : (
          TASKS.map((task) => {
            const row = routing[task];
            const selected = credentials.find((c) => c.id === row.credentialId);
            const isGoogleRestricted = selected?.provider === 'google' && isPolicedTask(task);
            return (
              <div key={task} className="space-y-2 pb-4 border-b last:border-b-0 last:pb-0">
                <Label>{TASK_LABELS[task]}</Label>
                <p className="text-xs text-muted-foreground">{TASK_DESCRIPTIONS[task]}</p>
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
                  {isGoogleRestricted ? (
                    // A restricted task on a Google key gets a PICKER rather
                    // than free text. The server rejects an unapproved id
                    // anyway, and discovering the rule by having a save
                    // rejected is a worse way to learn it than never being
                    // offered the option in the first place.
                    <select
                      className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground dark:bg-input/30 sm:max-w-xs"
                      value={row.model}
                      onChange={(e) => updateRow(task, { model: e.target.value })}
                    >
                      <option value="">Use this key&rsquo;s own model</option>
                      {GOOGLE_APPROVED_MODELS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  ) : (
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
                  )}
                  <Button variant="outline" onClick={() => handleSave(task)} disabled={savingTask === task}>
                    {savingTask === task ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
                  </Button>
                </div>
                {isGoogleRestricted && (
                  <p className="text-xs text-muted-foreground">
                    Restricted to {GOOGLE_APPROVED_MODELS.join(', ')} on Google keys, because this task&rsquo;s
                    output is stored and graded against later. If this key&rsquo;s own model is not one of
                    those, the task runs on {GOOGLE_APPROVED_MODELS[0]} instead.
                  </p>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
