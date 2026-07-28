import type { ErrorDetail } from '@/lib/errors/classify';

export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; detail?: ErrorDetail };
