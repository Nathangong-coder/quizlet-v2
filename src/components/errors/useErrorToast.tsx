'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import type { ErrorDetail } from '@/lib/errors/classify';
import ErrorDetailsDialog from './ErrorDetailsDialog';

/**
 * Shows a toast for an ActionResult failure, with a "Details" action that
 * opens the full-screen ErrorDetailsDialog when a structured `detail` is
 * available. Render the returned `dialog` element once, anywhere in the
 * component tree that calls `show`.
 */
export function useErrorToast() {
  const [detail, setDetail] = useState<ErrorDetail | null>(null);

  const show = useCallback((error: string, d?: ErrorDetail) => {
    if (!d) {
      toast.error(error);
      return;
    }
    toast.error(d.title, {
      description: d.why,
      action: { label: 'Details', onClick: () => setDetail(d) },
    });
  }, []);

  const dialog = (
    <ErrorDetailsDialog detail={detail} open={detail !== null} onOpenChange={(o) => !o && setDetail(null)} />
  );

  return { show, dialog };
}
