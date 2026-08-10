import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { localDateKey } from '../lib/clientTime'
import { serializeReview as serializeReviewText } from '../lib/reviewSerialization.js'

export function serializeReview(review) {
  return serializeReviewText(review)
}

/**
 * 周末主动回顾
 *
 * 触发逻辑：
 *  - 距离上次 review > 7 天 → 自动 fire-and-forget 生成一次
 *  - 或用户点 "本周回顾" 按钮手动触发
 *
 * 生成后落 `weekly_reviews` 表，并通过 `onReviewReady` 回调通知 chat 注入消息。
 */
export function useWeeklyReview(user, userGoal, onReviewReady) {
  const [generating, setGenerating] = useState(false)
  const [history, setHistory] = useState([])
  const [latestReview, setLatestReview] = useState(null)

  // ── 加载历史 review 列表 ──
  const loadHistory = useCallback(async () => {
    if (!user) { setHistory([]); return }
    const { data } = await supabase
      .from('weekly_reviews')
      .select('*')
      .eq('user_id', user.id)
      .order('week_start', { ascending: false })
      .limit(12)
    setHistory(data || [])
    setLatestReview((data || [])[0] || null)
  }, [user])

  // ── 自动触发检查（只在 user 变化时跑一次）──
  useEffect(() => {
    if (!user) return
    loadHistory().then(() => {
      checkAndTrigger()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  /**
   * 判断是否到 review 时间，是则自动生成
   */
  async function checkAndTrigger() {
    if (!user) return
    const { data } = await supabase
      .from('weekly_reviews')
      .select('week_start, triggered_at')
      .eq('user_id', user.id)
      .order('week_start', { ascending: false })
      .limit(1)

    const last = data?.[0]
    if (last) {
      const lastDate = new Date(last.triggered_at)
      const days = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24)
      if (days < 7) {
        console.log('[weeklyReview] last review only', days.toFixed(1), 'days ago, skip')
        return
      }
    }
    // 触发
    generate({ silent: true })
  }

  // ── 收集本周指标 ──
  async function gatherStats(weekStartISO, weekEndISO) {
    if (!user) return {}
    const stats = {}

    // 1. 完成的任务
    const { data: completed } = await supabase
      .from('nodes')
      .select('id, name, completed_at, parent_id')
      .eq('user_id', user.id)
      .eq('status', 'done')
      .gte('completed_at', weekStartISO)
      .lte('completed_at', weekEndISO)
      .order('completed_at', { ascending: true })
    stats.completed_tasks = (completed || []).map(t => ({
      name: t.name, completed_at: t.completed_at,
    }))

    // 2. 推荐命中
    const { data: recs } = await supabase
      .from('recommendation_log')
      .select('id, message, primary_node_id, outcome, created_at')
      .eq('user_id', user.id)
      .gte('created_at', weekStartISO)
      .lte('created_at', weekEndISO)
    const recsArr = recs || []
    const total       = recsArr.filter(r => r.primary_node_id).length
    const completedC  = recsArr.filter(r => r.outcome === 'completed').length
    const dropped = recsArr.filter(r => {
      if (r.outcome === 'completed') return false
      const age = Date.now() - new Date(r.created_at).getTime()
      return age > 7 * 24 * 3600 * 1000
    })
    stats.hit_rate = { total, completed: completedC, dropped: dropped.length }
    stats.dropped_recs = dropped.slice(0, 5).map(r => ({
      message: r.message, primary_node_id: r.primary_node_id,
    }))

    // 3. 停滞超 14 天的项目
    const { data: stale } = await supabase
      .from('nodes')
      .select('id, name, type, last_active_at')
      .eq('user_id', user.id)
      .eq('type', 'project')
      .eq('status', 'active')
    const fourteenDays = 14 * 24 * 3600 * 1000
    const now = Date.now()
    stats.dormant_projects = (stale || [])
      .filter(p => {
        if (!p.last_active_at) return false
        const age = now - new Date(p.last_active_at).getTime()
        return age > fourteenDays
      })
      .map(p => ({
        name: p.name,
        days_silent: Math.floor((now - new Date(p.last_active_at).getTime()) / (24 * 3600 * 1000)),
      }))

    // 4. 本周新沉淀的 learned_patterns
    const { data: profile } = await supabase
      .from('user_profile')
      .select('learned_patterns')
      .eq('user_id', user.id)
      .maybeSingle()
    const patterns = profile?.learned_patterns || []
    stats.new_learned_patterns = patterns.filter(p =>
      p.created_at && p.created_at >= weekStartISO && p.created_at <= weekEndISO
    )

    // 5. 本周 session 摘要 + decisions
    const { data: sums } = await supabase
      .from('session_summaries')
      .select('summary, key_decisions, ended_at')
      .eq('user_id', user.id)
      .gte('ended_at', weekStartISO)
      .lte('ended_at', weekEndISO)
      .order('ended_at', { ascending: true })
    stats.recent_summaries = sums || []
    stats.key_decisions = (sums || []).flatMap(s => s.key_decisions || []).slice(0, 8)

    return stats
  }

  // ── 生成 review ──
  const generate = useCallback(async ({ silent = false } = {}) => {
    if (!user || generating) return
    setGenerating(true)
    try {
      // 本周窗口：过去 7 天到现在
      const end   = new Date()
      const start = new Date(end.getTime() - 7 * 24 * 3600 * 1000)
      const weekStart = localDateKey(start)
      const weekEnd   = localDateKey(end)

      const stats = await gatherStats(start.toISOString(), end.toISOString())

      // 极简检测：如果一周内完全无活动且没历史 review，跳过自动生成（避免给新用户空 review）
      const empty = !stats.completed_tasks?.length &&
                    !stats.hit_rate?.total &&
                    !stats.new_learned_patterns?.length &&
                    !stats.recent_summaries?.length
      if (silent && empty) {
        console.log('[weeklyReview] week empty, skip silent generation')
        return
      }

      const res = await fetch('/api/weekly-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weekStart, weekEnd,
          userGoal: userGoal || null,
          stats,
        }),
      })
      if (!res.ok) throw new Error(`weekly-review ${res.status}`)
      const review = await res.json()

      // 写表
      const { data: saved, error } = await supabase
        .from('weekly_reviews')
        .upsert({
          user_id: user.id,
          week_start: weekStart,
          week_end: weekEnd,
          summary: serializeReview(review),
          stats,
          triggered_at: new Date().toISOString(),
        }, { onConflict: 'user_id,week_start' })
        .select()
        .single()
      if (error) { console.error('[weeklyReview] save:', error); return }

      setLatestReview(saved)
      await loadHistory()

      // 通知 chat 注入这条 review 消息
      onReviewReady?.({ ...saved, parsed: review })
    } catch (e) {
      console.error('[weeklyReview]', e)
      if (!silent) alert('生成失败：' + e.message)
    } finally {
      setGenerating(false)
    }
  }, [user, userGoal, generating, loadHistory, onReviewReady])

  const markAcknowledged = useCallback(async (id) => {
    if (!user || !id) return
    await supabase.from('weekly_reviews')
      .update({ acknowledged_at: new Date().toISOString() })
      .eq('id', id).eq('user_id', user.id)
    loadHistory()
  }, [user, loadHistory])

  return {
    generate, generating,
    history, latestReview,
    markAcknowledged,
    reload: loadHistory,
  }
}
