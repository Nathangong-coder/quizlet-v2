/**
 * Lives here (not in the `'use server'` action file that uses it) because a
 * "use server" module may only export async functions — a plain constant
 * export there is a hard Next.js build error.
 */
export const STUDY_SESSION_KINDS = ['quiz', 'matching', 'confidence'] as const
export type StudySessionKind = (typeof STUDY_SESSION_KINDS)[number]
