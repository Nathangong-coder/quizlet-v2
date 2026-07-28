'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  saveCredential,
  testCredential,
  testRawCredential,
  listProviderModels,
  listRawProviderModels,
  type CredentialRow,
} from '@/actions/ai-credentials';
import { PROVIDER_META, type ProviderId } from '@/lib/ai/providers';
import { useErrorToast } from '@/components/errors/useErrorToast';

interface CredentialFormProps {
  provider: ProviderId;
  /** Existing row when editing; null when adding a new credential. */
  credential: CredentialRow | null;
}

/** Tagged model-list result so a stale in-flight fetch can never overwrite a newer one. */
interface ModelsState {
  key: string;
  options: string[];
}

export default function CredentialForm({ provider, credential }: CredentialFormProps) {
  const router = useRouter();
  const meta = PROVIDER_META[provider];
  const { show: showError, dialog: errorDialog } = useErrorToast();

  const [credentialId, setCredentialId] = useState<string | undefined>(credential?.id);
  const [label, setLabel] = useState(credential?.label ?? '');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(credential?.baseUrl ?? meta.defaultBaseUrl ?? '');
  const [model, setModel] = useState(credential?.defaultModel ?? meta.defaultModel);
  const [role, setRole] = useState<'primary' | 'backup'>((credential?.role as 'primary' | 'backup') ?? 'primary');
  const [enabled, setEnabled] = useState(credential?.enabled ?? true);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const isEditing = Boolean(credential);

  // --- Model listing for a SAVED credential (editing, or right after Save
  // creates one). Fetched reactively: when `credentialId` first appears, or
  // when the user bumps `modelsReloadKey` via "Refresh list". Every state
  // update happens inside the `.then()` callback, never synchronously in the
  // effect body, and a request tag + `cancelled` flag stop a stale response
  // from clobbering a newer one — same shape as `profile/memory/page.tsx`.
  const [modelsReloadKey, setModelsReloadKey] = useState(0);
  const [savedModelsState, setSavedModelsState] = useState<ModelsState | null>(null);
  const savedModelsRequestKey = credentialId ? `${credentialId}::${modelsReloadKey}` : null;
  const loadingSavedModels = savedModelsRequestKey !== null && savedModelsState?.key !== savedModelsRequestKey;

  useEffect(() => {
    if (!credentialId || !savedModelsRequestKey) return;
    let cancelled = false;
    listProviderModels(credentialId).then((result) => {
      if (cancelled) return;
      if (result.success) {
        setSavedModelsState({ key: savedModelsRequestKey, options: result.data });
      } else {
        toast.error(result.error);
        setSavedModelsState({ key: savedModelsRequestKey, options: [] });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [credentialId, savedModelsRequestKey]);

  // --- Model listing for a brand-new, unsaved credential. This is a plain
  // click handler (not an effect) because it depends on freshly-typed key
  // material we deliberately do not want to fire automatically on keystroke.
  const [rawModelOptions, setRawModelOptions] = useState<string[]>([]);
  const [loadingRawModels, setLoadingRawModels] = useState(false);

  async function loadRawModels() {
    if (apiKey.trim().length < 8) {
      toast.error('Enter an API key first.');
      return;
    }
    if (meta.requiresBaseUrl && !baseUrl.trim()) {
      toast.error(`${meta.label} requires a base URL.`);
      return;
    }
    setLoadingRawModels(true);
    const result = await listRawProviderModels({
      provider,
      apiKey: apiKey.trim(),
      baseUrl: baseUrl.trim() || undefined,
    });
    setLoadingRawModels(false);
    if (result.success) {
      setRawModelOptions(result.data);
    } else {
      toast.error(result.error);
    }
  }

  const usingSavedCredential = Boolean(credentialId);
  const modelOptions = usingSavedCredential ? (savedModelsState?.options ?? []) : rawModelOptions;
  const loadingModels = usingSavedCredential ? loadingSavedModels : loadingRawModels;

  function handleRefreshModels() {
    if (usingSavedCredential) {
      setModelsReloadKey((k) => k + 1);
    } else {
      void loadRawModels();
    }
  }

  async function handleSave() {
    if (!isEditing && apiKey.trim().length < 8) {
      toast.error('Enter an API key (at least 8 characters).');
      return;
    }
    if (meta.requiresBaseUrl && !baseUrl.trim()) {
      toast.error(`${meta.label} requires a base URL.`);
      return;
    }
    if (!model.trim()) {
      toast.error('Enter a model id.');
      return;
    }

    setSaving(true);
    const result = await saveCredential({
      id: credentialId,
      provider,
      label: label.trim(),
      apiKey: apiKey.trim() ? apiKey.trim() : undefined,
      baseUrl: baseUrl.trim(),
      defaultModel: model.trim(),
      role,
      enabled,
    });
    setSaving(false);

    if (result.success) {
      toast.success('Credential saved');
      setApiKey('');
      if (!credentialId) setCredentialId(result.data.id);
      router.refresh();
    } else {
      showError(result.error, result.detail);
    }
  }

  async function handleTest() {
    if (!model.trim()) {
      toast.error('Enter a model id first.');
      return;
    }
    if (!usingSavedCredential && apiKey.trim().length < 8) {
      toast.error('Enter an API key first.');
      return;
    }
    if (meta.requiresBaseUrl && !baseUrl.trim()) {
      toast.error(`${meta.label} requires a base URL.`);
      return;
    }

    setTesting(true);
    const result = credentialId
      ? await testCredential(credentialId, model.trim())
      : await testRawCredential({
          provider,
          apiKey: apiKey.trim(),
          baseUrl: baseUrl.trim() || undefined,
          model: model.trim(),
        });
    setTesting(false);

    if (result.success) {
      toast.success('It works — the provider accepted this key and model.');
    } else {
      showError(result.error, result.detail);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-12 space-y-6">
      <div>
        <Link href="/settings/ai" className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1 mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to AI settings
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">
          {isEditing ? `Edit ${meta.label} credential` : `Add ${meta.label} credential`}
        </h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Credential details</CardTitle>
          <CardDescription>
            Your key is encrypted before it is stored, and only used server-side to call {meta.label} on your behalf.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="label">Label</Label>
            <Input
              id="label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Personal Gemini key"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="apiKey">API key</Label>
            <Input
              id="apiKey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={meta.keyPlaceholder}
            />
            {isEditing && (
              <p className="text-xs text-muted-foreground">
                Current key: <code className="bg-muted px-1 rounded">{credential?.keyHint}</code>. Leave blank to keep it.
              </p>
            )}
          </div>

          {meta.requiresBaseUrl && (
            <div className="space-y-2">
              <Label htmlFor="baseUrl">Base URL *</Label>
              <Input
                id="baseUrl"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={meta.defaultBaseUrl ?? 'https://…'}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="model">Model</Label>
            <div className="flex gap-2">
              <Input
                id="model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Model id"
                className="flex-1"
              />
              <Button type="button" variant="outline" onClick={handleTest} disabled={testing}>
                {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Test'}
              </Button>
            </div>

            {modelOptions.length > 0 && (
              <select
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground dark:bg-input/30"
                value=""
                onChange={(e) => {
                  if (e.target.value) setModel(e.target.value);
                }}
              >
                <option value="">Choose from {modelOptions.length} listed model{modelOptions.length === 1 ? '' : 's'}…</option>
                {modelOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            )}

            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Listed models are not guaranteed to work with your key. Press Test to confirm.
              </p>
              <Button type="button" variant="ghost" size="xs" onClick={handleRefreshModels} disabled={loadingModels}>
                {loadingModels ? 'Loading…' : modelOptions.length > 0 ? 'Refresh list' : 'List models'}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Role</Label>
            <RadioGroup value={role} onValueChange={(v) => setRole(v as 'primary' | 'backup')} className="grid-cols-1 sm:grid-cols-2">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="primary" id="role-primary" />
                <Label htmlFor="role-primary" className="font-normal">Primary — tried first</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="backup" id="role-backup" />
                <Label htmlFor="role-backup" className="font-normal">Backup — used if primaries fail</Label>
              </div>
            </RadioGroup>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="enabled"
              className="h-4 w-4 rounded border-gray-300"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <Label htmlFor="enabled">Enabled</Label>
          </div>

          <div className="flex gap-3 pt-2">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {errorDialog}
    </div>
  );
}
