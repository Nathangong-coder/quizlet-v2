/** Vocabulary for `StudyGroupMember.role`. Import, never spell the literal. */
export const GROUP_ROLES = ['owner', 'member'] as const
export type GroupRole = (typeof GROUP_ROLES)[number]

export function isGroupRole(v: string): v is GroupRole {
  return (GROUP_ROLES as readonly string[]).includes(v)
}

/** Vocabulary for `StudyGroup.visibility`. A public group is listed and joinable by request. */
export const GROUP_VISIBILITIES = ['private', 'public'] as const
export type GroupVisibility = (typeof GROUP_VISIBILITIES)[number]

export function isGroupVisibility(v: string): v is GroupVisibility {
  return (GROUP_VISIBILITIES as readonly string[]).includes(v)
}

/** Vocabulary for join requests and invites. */
export const REQUEST_STATUSES = ['pending', 'accepted', 'declined'] as const
export type RequestStatus = (typeof REQUEST_STATUSES)[number]
