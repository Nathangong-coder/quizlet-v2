import { StudyNoteAnalysisSchema } from '@/lib/ai/schemas';

export interface StudyNoteAnalysisBuildInput {
  title: string;
  body: string;
}

/**
 * Turns a learner-authored note into a compact, editable study surface. The
 * output is line-oriented so no useful idea gets trapped inside one opaque AI
 * paragraph.
 */
export const STUDY_NOTE_ANALYSIS_PROMPT = {
  id: 'study-note-analysis',
  version: 1,
  schema: StudyNoteAnalysisSchema,

  build(input: StudyNoteAnalysisBuildInput): string {
    return `You are a precise study-notes editor for a finance interview preparation app.

Note title: ${input.title}

Note body:
${input.body}

Analyze this note into a compact, useful study surface.
- Write 3-12 summaryLines unless the note is genuinely tiny.
- Each line must stand alone and preserve the note's meaning. Do not invent facts.
- Use sourceLine as a zero-based line number when a summary line clearly comes from one source line; omit it when it synthesizes multiple lines.
- Use kind: insight for a key idea, definition for a term, question for something to investigate, and action for a concrete next step.
- keyTerms should contain the most useful finance/interview terms from the note.
- followUps should contain specific questions or actions the learner could pursue next. Use [] when none are warranted.

Return structured JSON with exactly: summaryLines, keyTerms, followUps.`;
  },
};
