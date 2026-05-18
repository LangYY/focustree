import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { treeToPromptText } from '../lib/treeUtils'
import { getClientTime, localDateKey } from '../lib/clientTime'

/**
 * 每日聚焦：今天 3 件最该做的事
 *
 * 行为：
 * - 进入 app 时拉今天的记录；没有则不自动生成（避免无意识烧 token）
 * - 用户点「生成今日聚焦」按钮才调 /api/daily-focus
 * - 单条 toggle done / 删除 / 整张重生成
 */
export function useDailyFocus(user, treeData, userGoal, recentSummaries, learnedPatterns, hitRate) {
  const [focus, setFocus] = useState(null)        // { date, tasks: [], generated_at, summary }
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)

  const today = localDateKey()

  // ── 加载今天的 focus ──
  const loadToday = useCallback(async () => {
    if (!user) { setFocus(null); return }
    setLoading(true)
    const { data, error } = await supabase
      .from('daily_focus')
      .select('*')
      .eq('user_id', user.id)
      .eq('date', today)
      .maybeSingle()
    if (error) console.warn('[useDailyFocus] load:', error.message)
    setFocus(data || null)
    setLoading(false)
  }, [user, today])

  useEffect(() => { loadToday() }, [loadToday])

  // ── 生成今日聚焦 ──
  const generate = useCallback(async () => {
    if (!user || generating) return
    setGenerating(true)
    try {
      const treeText = treeToPromptText(treeData, userGoal)
      const clientTime = getClientTime()
      const res = await fetch('/api/daily-focus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          treeText,
          userGoal: userGoal || null,
          recentSummaries: recentSummaries || [],
          learnedPatterns: learnedPatterns || [],
          hitRate: hitRate || null,
          clientTime,
        }),
      })
      if (!res.ok) throw new Error(`daily-focus ${res.status}`)
      const data = await res.json()
      const row = {
        user_id: user.id,
        date: today,
        tasks: data.tasks || [],
        generated_at: new Date().toISOString(),
      }
      const { error } = await supabase
        .from('daily_focus')
        .upsert(row, { onConflict: 'user_id,date' })
      if (error) { console.error('[useDailyFocus] save:', error); alert('保存失败：' + error.message); return }
      setFocus({ ...row, summary: data.summary })
    } catch (e) {
      console.error('[useDailyFocus] generate:', e)
      alert('生成失败：' + e.message)
    } finally {
      setGenerating(false)
    }
  }, [user, treeData, userGoal, recentSummaries, learnedPatterns, hitRate, today, generating])

  // ── 切换某一条的完成状态 ──
  const toggleTask = useCallback(async (index) => {
    if (!focus || !user) return
    const next = {
      ...focus,
      tasks: focus.tasks.map((t, i) => i === index ? { ...t, done: !t.done } : t),
    }
    setFocus(next)
    await supabase.from('daily_focus').update({ tasks: next.tasks })
      .eq('user_id', user.id).eq('date', today)
  }, [focus, user, today])

  // ── 删除某一条 ──
  const removeTask = useCallback(async (index) => {
    if (!focus || !user) return
    const next = { ...focus, tasks: focus.tasks.filter((_, i) => i !== index) }
    setFocus(next)
    await supabase.from('daily_focus').update({ tasks: next.tasks })
      .eq('user_id', user.id).eq('date', today)
  }, [focus, user, today])

  // ── 整张丢弃，下次进来再生成 ──
  const dismiss = useCallback(async () => {
    if (!user) return
    setFocus(null)
    await supabase.from('daily_focus').delete()
      .eq('user_id', user.id).eq('date', today)
  }, [user, today])

  return {
    focus, loading, generating,
    generate, toggleTask, removeTask, dismiss,
    reload: loadToday,
  }
}
