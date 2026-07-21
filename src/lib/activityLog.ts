import { supabase } from './supabase'

export type LogAction  = 'upload' | 'edit' | 'delete'
export type LogSection = 'bp-sites' | 'lp-sites' | 'ftds'

export interface ActivityLogEntry {
  id:        number
  createdAt: string
  email:     string
  action:    LogAction
  section:   LogSection
  summary:   string
}

/**
 * Best-effort activity log write. Never throws — a failed log write must
 * never block or roll back the real mutation it's describing. Callers fire
 * this without awaiting: `void logActivity(...)`.
 */
export async function logActivity(action: LogAction, section: LogSection, summary: string): Promise<void> {
  try {
    const { data, error: sessionErr } = await supabase.auth.getSession()
    const user = data.session?.user
    if (sessionErr || !user) {
      console.error('logActivity: no signed-in user, skipping', sessionErr)
      return
    }
    const { error } = await supabase.from('activity_log').insert({
      user_id: user.id,
      email:   user.email ?? 'unknown',
      action,
      section,
      summary,
    })
    if (error) console.error('Failed to write activity log:', error)
  } catch (err) {
    console.error('logActivity: unexpected error, skipping', err)
  }
}

export async function loadActivityLog(limit = 200): Promise<ActivityLogEntry[]> {
  const { data, error } = await supabase
    .from('activity_log')
    .select('id, created_at, email, action, section, summary')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []).map((r) => ({
    id:        r.id as number,
    createdAt: r.created_at as string,
    email:     r.email as string,
    action:    r.action as LogAction,
    section:   r.section as LogSection,
    summary:   r.summary as string,
  }))
}
