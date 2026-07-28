'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { ErrorDetail } from '@/lib/errors/classify';

interface ErrorDetailsDialogProps {
  detail: ErrorDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Full-screen-on-mobile / large-panel-on-desktop dialog for surfacing an
 * ErrorDetail. This exists because toast text gets cut off and the user
 * cannot read it — so nothing in here may truncate. The body scrolls
 * internally instead of the dialog growing past the viewport, and the
 * technical block wraps instead of overflowing horizontally.
 */
export default function ErrorDetailsDialog({ detail, open, onOpenChange }: ErrorDetailsDialogProps) {
  const [copied, setCopied] = useState(false);

  if (!detail) return null;

  async function handleCopy() {
    if (!detail?.technical) return;
    try {
      await navigator.clipboard.writeText(detail.technical);
      setCopied(true);
      toast.success('Copied technical details');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy to clipboard');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl w-full h-dvh sm:h-auto sm:max-h-[85vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>{detail.title}</DialogTitle>
            <Badge variant={detail.attribution === 'user' ? 'outline' : 'secondary'}>
              {detail.attribution === 'user' ? 'You can fix this' : 'Problem on our end'}
            </Badge>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          <p className="text-sm text-muted-foreground">{detail.why}</p>

          {detail.fix && (
            <div>
              {detail.fix.href ? (
                <Button size="sm" render={<Link href={detail.fix.href} />}>
                  {detail.fix.label}
                </Button>
              ) : (
                <p className="text-sm font-medium">{detail.fix.label}</p>
              )}
            </div>
          )}

          {detail.attempts && detail.attempts.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Attempts</p>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium">Credential</th>
                      <th className="px-2 py-1.5 text-left font-medium">Provider</th>
                      <th className="px-2 py-1.5 text-left font-medium">Model</th>
                      <th className="px-2 py-1.5 text-left font-medium">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.attempts.map((a, i) => (
                      <tr key={`${a.credentialId}-${i}`} className="border-t">
                        <td className="px-2 py-1.5 break-words">{a.label}</td>
                        <td className="px-2 py-1.5 break-words">{a.provider}</td>
                        <td className="px-2 py-1.5 break-words">{a.model}</td>
                        <td className="px-2 py-1.5 break-words">{a.kind}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {detail.technical && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Technical details</p>
                <Button variant="outline" size="xs" onClick={handleCopy}>
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <pre className="whitespace-pre-wrap break-words rounded-lg border bg-muted/50 p-3 text-xs">
                {detail.technical}
              </pre>
            </div>
          )}
        </div>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
