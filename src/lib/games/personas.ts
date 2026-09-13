import { getSubject } from '@/lib/subjects/taxonomy'

/**
 * Hot Seat's interviewer, by the set's subject GROUP. A static table — a
 * persona is tone, not knowledge, and the grading is the same underneath.
 */
export interface Persona {
  id: string
  name: string
  vibe: string
  opening: string
  /** How the probe prompt should sound. */
  probeStyle: string
}

const PERSONAS: Record<string, Persona> = {
  'business-finance': {
    id: 'superday',
    name: 'The superday panel',
    vibe: 'Brisk, technical, wants the mechanism and the number.',
    opening: 'Thanks for coming in. Let’s get straight into the technicals.',
    probeStyle: 'a sharp follow-up a banking interviewer would ask, one sentence, no preamble',
  },
  'arts-humanities': {
    id: 'oral-examiner',
    name: 'The oral examiner',
    vibe: 'Patient, precise, expects you to argue, not recite.',
    opening: 'Take your time. I am interested in how you reason, not only what you remember.',
    probeStyle: 'a probing question an oral examiner would ask to test whether the candidate understands rather than recalls',
  },
  languages: {
    id: 'conversation-partner',
    name: 'Your conversation partner',
    vibe: 'Friendly, curious, keeps the conversation moving.',
    opening: 'Hi! Let’s just talk. Tell me about this one.',
    probeStyle: 'a natural follow-up a conversation partner would ask, warm and short',
  },
  science: {
    id: 'viva',
    name: 'The viva panel',
    vibe: 'Rigorous, asks why, then why again.',
    opening: 'We will start with the fundamentals and go from there.',
    probeStyle: 'a viva-style follow-up that asks for the underlying reason or condition',
  },
  'medicine-health': {
    id: 'attending',
    name: 'The attending',
    vibe: 'Calm, clinical, wants the reasoning behind the answer.',
    opening: 'Present it to me the way you would on rounds.',
    probeStyle: 'a follow-up an attending physician would ask on rounds, focused and clinical',
  },
  technology: {
    id: 'tech-interviewer',
    name: 'The technical interviewer',
    vibe: 'Direct, likes trade-offs and edge cases.',
    opening: 'Let’s walk through a few concepts. Feel free to think out loud.',
    probeStyle: 'a follow-up a software interviewer would ask about a trade-off or an edge case',
  },
}

export const DEFAULT_PERSONA: Persona = {
  id: 'examiner',
  name: 'The examiner',
  vibe: 'Fair, attentive, wants a complete answer.',
  opening: 'Let’s begin. Answer as fully as you can.',
  probeStyle: 'a clear follow-up question aimed at the missing point',
}

export function personaForSubject(subjectSlug: string | null | undefined): Persona {
  const group = getSubject(subjectSlug)?.group.slug
  return (group ? PERSONAS[group] : undefined) ?? DEFAULT_PERSONA
}
