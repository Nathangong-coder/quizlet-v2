import { z } from 'zod';

/**
 * The chapter skeleton (2026-09-15). Bottom-up clustering (shared children,
 * shared words) finds the parents the cards happen to name; it cannot invent
 * the chapter no card names, and on the first written M&A tree 20 of 34
 * branches under the domain were one card each. ONE call: given every
 * branch that sits directly under the domain, group them into the chapters
 * of a syllabus and name each. A branch may be left out (it stays where it
 * is); a chapter needs two or more members; names are at most four words.
 */
export const ChapterSkeletonSchema = z.object({
  chapters: z.array(
    z.object({
      name: z.string(),
      /** Exact branch names from the list, verbatim. */
      members: z.array(z.string()),
      reason: z.string().optional(),
    }),
  ),
});

export const CHAPTER_SKELETON_PROMPT = {
  id: 'chapter-skeleton',
  version: 1,
  schema: ChapterSkeletonSchema,

  build(input: { domain: string; branches: { name: string; cards: number; children: string[] }[]; maxChapters?: number }): string {
    const max = input.maxChapters ?? 10;
    const list = input.branches
      .map((b) => `- ${b.name}  (${b.cards} card${b.cards === 1 ? '' : 's'}${b.children.length ? '; covers: ' + b.children.slice(0, 6).join(', ') : ''})`)
      .join('\n');
    return `You are organising the topic tree of a study set on "${input.domain}" the way a textbook's chapters would.

Below are the branches that currently sit directly under the domain. Group them into at most ${max} CHAPTERS — the subjects a syllabus for ${input.domain} would list — and name each chapter.

Rules:
- A chapter name is a lowercase noun phrase of AT MOST FOUR WORDS, no articles ("purchase accounting", "deal financing", "sell-side process").
- Use a branch's OWN name as the chapter name when one branch is the natural parent of the others in its group.
- Every member must be copied VERBATIM from the list. A branch may appear in one chapter only.
- A chapter needs at least two members. Leave out a branch that fits nowhere — it stays where it is.
- Do not invent a grab-bag ("other topics", "miscellaneous"): a chapter is something a learner studies as one subject.

Branches:
${list}

Output JSON: { "chapters": [ { "name": string, "members": [string, ...], "reason": string }, ... ] }`;
  },
};
