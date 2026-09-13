/** Vocabulary for `StudyGroupMember.role`. Import, never spell the literal. */
export const GROUP_ROLES = ['owner', 'member'] as const
export type GroupRole = (typeof GROUP_ROLES)[number]

export function isGroupRole(v: string): v is GroupRole {
  return (GROUP_ROLES as readonly string[]).includes(v)
}
