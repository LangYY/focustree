import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/**
 * useUserProfile
 * ─────────────────────────────────────────────────────────────
 * 第一阶段只暴露 current_goal 的读写。
 * 结构：current_goal = { text, set_at, expires_at, constraints[], exclude[] }
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
   * 设置当前阶段目标
   * @param {string} text - 目标描述
   * @param {object} opts - { constraints?: string[], exclude?: string[], days?: number }
   */
  const setGoal = useCallback(async (text, opts = {}) => {
    if (!user) { console.warn('[setGoal] no user'); return }
    if (!text?.trim()) { console.warn('[setGoal] empty text'); return }
    const now = new Date()
    const days = opts.days ?? 90       // 默认 90 天有效期（一个季度）
    const expires = new Date(now.getTime() + days * 24 * 3600 * 1000)

    const current_goal = {
      text: text.trim(),
      set_at: now.toISOString(),
      expires_at: expires.toISOString(),
      constraints: opts.constraints || [],
      exclude:     opts.exclude     || [],
    }

    console.log('[setGoal] writing', { user_id: user.id, current_goal })
    const { data, error } = await supabase.from('user_profile').upsert({
      user_id: user.id,
      current_goal,
    }, { onConflict: 'user_id' }).select()

    if (error) {
      console.error('[useUserProfile] setGoal failed:', error)
      alert(`目标保存失败：${error.message}\n\n(详情见 Console)`)
      return
    }
    console.log('[setGoal] saved:', data)
    await loadProfile()
  }, [user, loadProfile])

  /**
   * 清除当前目标
   */
  const clearGoal = useCallback(async () => {
    if (!user) return
    const { error } = await supabase.from('user_profile').upsert({
      user_id: user.id,
      current_goal: null,
    }, { onConflict: 'user_id' })
    if (error) { console.error('[useUserProfile] clearGoal:', error.message); return }
    await loadProfile()
  }, [user, loadProfile])

  // 计算便捷字段
  const goal = profile?.current_goal || null
  const goalText = goal?.text || null
  const goalExpired = goal?.expires_at ? new Date(goal.expires_at) < new Date() : false

  return {
    profile, loading,
    goal, goalText, goalExpired,
    setGoal, clearGoal,
    reload: loadProfile,
  }
}
