import { describe, it, expect } from 'vitest'
import { USER_ROLES, isStaff, isAdmin, isKnownRole } from '@/lib/auth/roles'

describe('USER_ROLES', () => {
  it('is exactly the three known roles, in ascending capability order', () => {
    expect(USER_ROLES).toEqual(['learner', 'staff', 'admin'])
  })
})

describe('isStaff', () => {
  it('admits staff and admin', () => {
    expect(isStaff('staff')).toBe(true)
    expect(isStaff('admin')).toBe(true)
  })

  it('refuses learner', () => {
    expect(isStaff('learner')).toBe(false)
  })

  // The analogue of the empty-id case the old KLT operator allowlist guarded.
  // A role read from a session that failed to resolve must not admit anyone —
  // a gate that opens on missing input is not a gate.
  it('refuses undefined, null, empty string and any unknown value', () => {
    expect(isStaff(undefined)).toBe(false)
    expect(isStaff(null)).toBe(false)
    expect(isStaff('')).toBe(false)
    expect(isStaff('Admin')).toBe(false)
    expect(isStaff('superuser')).toBe(false)
  })
})

describe('isAdmin', () => {
  it('admits only admin', () => {
    expect(isAdmin('admin')).toBe(true)
    expect(isAdmin('staff')).toBe(false)
    expect(isAdmin('learner')).toBe(false)
  })

  it('refuses undefined, null, empty string and any unknown value', () => {
    expect(isAdmin(undefined)).toBe(false)
    expect(isAdmin(null)).toBe(false)
    expect(isAdmin('')).toBe(false)
    expect(isAdmin('ADMIN')).toBe(false)
  })
})

describe('isKnownRole', () => {
  it('narrows only the three members', () => {
    expect(isKnownRole('learner')).toBe(true)
    expect(isKnownRole('nope')).toBe(false)
    expect(isKnownRole(undefined)).toBe(false)
    expect(isKnownRole(7)).toBe(false)
  })
})
