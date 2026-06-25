'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { saveGoogleApiKey, deleteGoogleApiKey, testGoogleApiKey } from '@/actions/ai-settings';
import { Loader2, Trash2, CheckCircle2 } from 'lucide-react';

interface GoogleApiKeyFormProps {
  initialKeyHint: string | null;
}

export function GoogleApiKeyForm({ initialKeyHint }: GoogleApiKeyFormProps) {
  const [apiKey, setApiKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentKeyHint, setCurrentKeyHint] = useState(initialKeyHint);

  async function handleSave() {
    if (!apiKey) {
      toast.error('Please enter an API key');
      return;
    }

    setIsLoading(true);
    const result = await saveGoogleApiKey(apiKey);
    setIsLoading(false);

    if (result.success) {
      toast.success('API key saved successfully');
      setCurrentKeyHint(`AIza****${apiKey.slice(-4)}`);
      setApiKey('');
    } else {
      toast.error(result.error || 'Failed to save API key');
    }
  }

  async function handleTest() {
    if (!apiKey) {
      toast.error('Please enter an API key to test');
      return;
    }

    setIsLoading(true);
    const result = await testGoogleApiKey(apiKey);
    setIsLoading(false);

    if (result.success) {
      toast.success('API key is valid!');
    } else {
      toast.error(result.error || 'Invalid API key');
    }
  }

  async function handleDelete() {
    if (!confirm('Are you sure you want to delete your saved API key?')) return;

    setIsLoading(true);
    const result = await deleteGoogleApiKey();
    setIsLoading(false);

    if (result.success) {
      toast.success('API key deleted');
      setCurrentKeyHint(null);
    } else {
      toast.error(result.error || 'Failed to delete API key');
    }
  }

  return (
    <div className="space-y-6 max-w-md">
      <div className="p-4 rounded-lg border bg-muted/50 space-y-2">
        <p className="text-sm font-medium">Current Status</p>
        <div className="flex items-center gap-2 text-sm">
          {currentKeyHint ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span>Saved key: <code className="bg-background px-1 rounded">{currentKeyHint}</code></span>
            </>
          ) : (
            <span>No key saved. Please enter one below.</span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Google API Key</label>
        <div className="flex gap-2">
          <Input
            type="password"
            placeholder="AIza..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            disabled={isLoading}
          />
          <Button variant="outline" onClick={handleTest} disabled={isLoading}>
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Test'}
          </Button>
        </div>
      </div>

      <div className="flex gap-3">
        <Button onClick={handleSave} disabled={isLoading}>
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Key'}
        </Button>
        {currentKeyHint && (
          <Button variant="destructive" onClick={handleDelete} disabled={isLoading}>
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
              <><Trash2 className="w-4 h-4 mr-2" /> Delete</>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
