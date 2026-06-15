import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/**
 * useUserProfile
 * ─────────────────────────────────────────────────────────────
 * current_goal is the single active goal. Goals without a deadline are long-term
 * and never expire automatically. Replaced goals are copied to goal_history.
 */
export function useUserProfile(user) {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async () => {
    if (!user) { setProfile(null); setLoading(false); return }
    setLoading(true)

    const { data, error } = await supabase
      .from('user_profile')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()

    if (error) {
      console.error('[useUserProfile] load failed:', error)
    } else {
      console.log('[useUserProfile] loaded:', data)
    }
    setProfile(data || null)
    setLoading(false)
  }, [user])

  useEffect(() => { loadProfile() }, [loadProfile])

  /**
   * Set the active goal.
   * @param {string} text - 目标描述
   * @param {object} opts - parsed goal fields from the user or AI proposal
   */
  const setGoal = useCallback(async (text, opts = {}) => {
    if (!user) { console.warn('[setGoal] no user'); return }
    if (!text?.trim()) { console.warn('[setGoal] empty text'); return }
    const now = new Date()
    const deadline = normalizeDate(opts.deadline || opts.expires_at)
    const startDate = normalizeDate(opts.start_date)
    const version = opts.version || globalThis.crypto?.randomUUID?.() || `goal-${now.getTime()}`

    const current_goal = {
      version,
      text: text.trim(),
      outcome: String(opts.outcome || text).trim(),
      kind: deadline || startDate ? 'stage' : 'long_term',
      set_at: now.toISOString(),
      start_date: startDate,
      deadline,
      expires_at: deadline ? `${deadline}T23:59:59.999Z` : null,
      constraints: opts.constraints || [],
      exclude:     opts.exclude     || [],
      source: opts.source || 'manual',
    }

    console.log('[setGoal] writing', { user_id: user.id, current_goal })
    if (profile?.current_goal) {
      const { error: historyError } = await supabase.from('goal_history').insert({
        user_id: user.id,
        goal: profile.current_goal,
        status: 'replaced',
      })
      if (historyError) console.warn('[useUserProfile] goal history:', historyError.message)
    }
    const { data, error } = await supabase.from('user_profile').upsert({
      user_id: user.id,
      current_goal,
    }, { onConflict: 'user_id' }).select()

    if (error) {
      console.error('[useUserProfile] setGoal failed:', error)
      alert(`目标保存失败：${error.message}\n\n(详情见 Console)`)
      return null
    }
    console.log('[setGoal] saved:', data)
    await loadProfile()
    return current_goal
  }, [user, profile, loadProfile])

  /**
   * 清除当前目标
   */
  const clearGoal = useCallback(async () => {
    if (!user) return
    if (profile?.current_goal) {
      const { error: historyError } = await supabase.from('goal_history').insert({
        user_id: user.id,
        goal: profile.current_goal,
        status: 'cleared',
      })
      if (historyError) console.warn('[useUserProfile] goal history:', historyError.message)
    }
    const { error } = await supabase.from('user_profile').upsert({
      user_id: user.id,
      current_goal: null,
    }, { onConflict: 'user_id' })
    if (error) { console.error('[useUserProfile] clearGoal:', error.message); return }
    await loadProfile()
  }, [user, profile, loadProfile])

  // 计算便捷字段
  const goal = profile?.current_goal || null
  const goalText = goal?.text || null
  const goalExpired = goal?.deadline
    ? new Date(`${goal.deadline}T23:59:59.999`) < new Date()
    : false

  return {
    profile, loading,
    goal, goalText, goalExpired,
    setGoal, clearGoal,
    reload: loadProfile,
  }
}

function normalizeDate(value) {
  if (!value) return null
  const text = String(value).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}
