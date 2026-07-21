import { supabase } from './supabase'
import type { UserAccessRow, UserAccessStatus } from '../types'

interface UserAccessSelf {
  status: UserAccessStatus
  isAdmin: boolean
}

/**
 * The current user's own approval status + admin flag. Returns null if no
 * row exists yet (shouldn't happen once the trigger has run for this user,
 * but callers treat a null result as "not approved" defensively).
 */
export async function getUserAccess(userId: string): Promise<UserAccessSelf | null> {
  const { data, error } = await supabase
    .from('user_access')
    .select('status, is_admin')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return { status: data.status as UserAccessStatus, isAdmin: data.is_admin as boolean }
}

/** All users, newest first — for the admin approval page. RLS only returns rows to an admin; a non-admin caller gets just their own row. */
export async function listUserAccess(): Promise<UserAccessRow[]> {
  const { data, error } = await supabase
    .from('user_access')
    .select('user_id, email, status, is_admin, created_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((r) => ({
    userId: r.user_id as string,
    email: r.email as string,
    status: r.status as UserAccessStatus,
    isAdmin: r.is_admin as boolean,
    createdAt: r.created_at as string,
  }))
}

/** Approve or revoke a user. RLS only allows this for an admin caller. */
export async function updateUserStatus(userId: string, status: UserAccessStatus): Promise<void> {
  const { error } = await supabase.from('user_access').update({ status }).eq('user_id', userId)
  if (error) throw error
}

/** Promote or demote a user's admin flag. RLS only allows this for an admin caller. */
export async function updateUserAdmin(userId: string, isAdmin: boolean): Promise<void> {
  const { error } = await supabase.from('user_access').update({ is_admin: isAdmin }).eq('user_id', userId)
  if (error) throw error
}
