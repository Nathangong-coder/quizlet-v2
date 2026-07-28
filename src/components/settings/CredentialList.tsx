'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Loader2, Trash2, Pencil, AlertTriangle, Plus } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { listCredentials, deleteCredential, testCredential, type CredentialRow } from '@/actions/ai-credentials';
import { AI_PROVIDERS, PROVIDER_META } from '@/lib/ai/providers';
import { useErrorToast } from '@/components/errors/useErrorToast';

export default function CredentialList() {
  const [credentials, setCredentials] = useState<CredentialRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { show: showError, dialog: errorDialog } = useErrorToast();

  const refresh = useCallback(async () => {
    const result = await listCredentials();
    if (result.success) {
      setCredentials(result.data);
    } else {
      toast.error(result.error);
      setCredentials([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleTest(cred: CredentialRow) {
    setBusyId(cred.id);
    const result = await testCredential(cred.id);
    setBusyId(null);
    if (result.success) {
      toast.success(`${cred.label} works`);
      void refresh();
    } else {
      showError(result.error, result.detail);
      void refresh();
    }
  }

  async function handleDelete(cred: CredentialRow) {
    if (!confirm(`Delete the credential "${cred.label}"? This cannot be undone.`)) return;
    setBusyId(cred.id);
    const result = await deleteCredential(cred.id);
    setBusyId(null);
    if (result.success) {
      toast.success('Credential deleted');
      void refresh();
    } else {
      toast.error(result.error);
    }
  }

  if (credentials === null) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Loading credentials…</p>;
  }

  return (
    <div className="space-y-4">
      {AI_PROVIDERS.map((provider) => {
        const meta = PROVIDER_META[provider];
        const rows = credentials.filter((c) => c.provider === provider);
        return (
          <Card key={provider}>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle>{meta.label}</CardTitle>
                  <CardDescription>
                    {rows.length === 0 ? 'No credentials yet.' : `${rows.length} credential${rows.length === 1 ? '' : 's'}`}
                  </CardDescription>
                </div>
                <Button size="sm" variant="outline" render={<Link href={`/settings/ai/${provider}`} />}>
                  <Plus className="w-4 h-4" /> Add
                </Button>
              </div>
            </CardHeader>
            {rows.length > 0 && (
              <CardContent className="space-y-2">
                {rows.map((cred) => (
                  <div
                    key={cred.id}
                    className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium truncate">{cred.label}</span>
                        <Badge variant="outline">{cred.role}</Badge>
                        <Badge variant={cred.enabled ? 'secondary' : 'outline'}>
                          {cred.enabled ? 'Enabled' : 'Disabled'}
                        </Badge>
                        {cred.lastErrorKind && (
                          <Badge variant="destructive">
                            <AlertTriangle className="w-3 h-3" /> {cred.lastErrorKind}
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {cred.keyHint} &middot; {cred.defaultModel}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="outline" size="sm" onClick={() => handleTest(cred)} disabled={busyId === cred.id}>
                        {busyId === cred.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Test'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit ${cred.label}`}
                        render={<Link href={`/settings/ai/${cred.provider}?id=${cred.id}`} />}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${cred.label}`}
                        onClick={() => handleDelete(cred)}
                        disabled={busyId === cred.id}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            )}
          </Card>
        );
      })}
      {errorDialog}
    </div>
  );
}
