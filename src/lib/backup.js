/**
 * 备份与恢复 —— 客户端实现
 *
 * 为什么放客户端：用户对自己数据有 RLS 权限，不需要后端绕一道。
 * 数据完整性：导出包含全部 8 张用户表的全量行，UPSERT/INSERT 时按 schema 还原。
 *
 * ── 文件格式 v1 ──────────────────────────────────────
 * {
 *   "version": 1,
 *   "exported_at": "<ISO>",
 *   "user_id": "<uuid>",
 *   "tables": {
 *     "nodes": [...],
 *     "node_annotations": [...],
 *     "conversations": [...],
 *     "session_summaries": [...],
 *     "user_profile": [...],
 *     "recommendation_log": [...],
 *     "daily_focus": [...],
 *     "weekly_reviews": [...]
 *   }
 * }
 */

import { supabase } from './supabase'

const TABLES = [
  'nodes',
  'node_annotations',
  'conversations',
  'session_summaries',
  'user_profile',
  'recommendation_log',
  'daily_focus',
  'weekly_reviews',
]

// 删除顺序：先无依赖、后被依赖（nodes 最后；先深后浅）
const DELETE_ORDER = [
  'session_summaries',
  'recommendation_log',
  'daily_focus',
  'weekly_reviews',
  'conversations',
  'user_profile',
  'node_annotations',
  'nodes',
]

// 插入顺序：先 user_profile/nodes（被引用），再依赖它们的子表
const INSERT_ORDER = [
  'user_profile',
  'nodes',           // 需特殊处理：按 parent-first 排序
  'node_annotations',
  'conversations',
  'recommendation_log',
  'session_summaries',
  'daily_focus',
  'weekly_reviews',
]

// ── 导出 ──────────────────────────────────────────────

/**
 * 全量拉取该用户的所有表行
 */
export async function exportAll(userId) {
  if (!userId) throw new Error('missing userId')
  const tables = {}
  for (const t of TABLES) {
    const { data, error } = await supabase
      .from(t)
      .select('*')
      .eq('user_id', userId)
    if (error) {
      console.warn(`[backup] ${t}:`, error.message)
      tables[t] = []
    } else {
      tables[t] = data || []
    }
  }
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    user_id: userId,
    tables,
    stats: summarize(tables),
  }
}

function summarize(tables) {
  return Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v?.length || 0]))
}

/**
 * 下载备份为文件
 */
export function downloadBackup(backup, filenamePrefix = 'focustree') {
  const date = (backup.exported_at || new Date().toISOString()).slice(0, 19).replace(/[:T]/g, '-')
  const filename = `${filenamePrefix}-${date}.json`
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  return filename
}

// ── localStorage 自动备份 ────────────────────────────

const KEY_PREFIX = 'ft_backup_'           // 普通自动备份
const KEY_PREFIX_PRE = 'ft_backup_pre_'   // 关键操作前快照
const KEEP_AUTO = 7
const KEEP_PRE = 10
const PRE_TTL_DAYS = 30

export async function autoBackup(userId, opts = {}) {
  if (!userId) return null
  const { reason = 'auto', preDestructive = false } = opts
  const backup = await exportAll(userId)
  backup.reason = reason
  const prefix = preDestructive ? KEY_PREFIX_PRE : KEY_PREFIX
  const key = `${prefix}${userId}_${Date.now()}`
  try {
    localStorage.setItem(key, JSON.stringify(backup))
  } catch (e) {
    // 配额溢出：清掉一些旧的再试
    pruneAuto(userId, true)
    try {
      localStorage.setItem(key, JSON.stringify(backup))
    } catch (e2) {
      console.error('[autoBackup] localStorage full, dropping:', e2)
      return null
    }
  }
  pruneAuto(userId)
  prunePre(userId)
  return { key, backup }
}

/**
 * 列出某用户的所有 localStorage 备份，按时间倒序
 */
export function listBackups(userId) {
  if (!userId) return []
  const auto = []
  const pre  = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key) continue
    if (key.startsWith(KEY_PREFIX_PRE + userId)) {
      const ts = parseInt(key.split('_').pop(), 10)
      if (!isNaN(ts)) pre.push({ key, ts, type: 'pre' })
    } else if (key.startsWith(KEY_PREFIX + userId)) {
      const ts = parseInt(key.split('_').pop(), 10)
      if (!isNaN(ts)) auto.push({ key, ts, type: 'auto' })
    }
  }
  return [...auto.sort((a, b) => b.ts - a.ts), ...pre.sort((a, b) => b.ts - a.ts)]
}

/**
 * 读取某条备份的元数据（不解析整个 backup 节点列表）
 */
export function getBackupMeta(key) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const data = JSON.parse(raw)
    return {
      key,
      exported_at: data.exported_at,
      user_id: data.user_id,
      reason: data.reason,
      stats: data.stats,
    }
  } catch {
    return null
  }
}

export function loadBackup(key) {
  const raw = localStorage.getItem(key)
  if (!raw) throw new Error('备份不存在')
  return JSON.parse(raw)
}

function pruneAuto(userId, aggressive = false) {
  const auto = listBackups(userId).filter(b => b.type === 'auto')
  const keepN = aggressive ? Math.max(2, KEEP_AUTO - 3) : KEEP_AUTO
  const toDelete = auto.slice(keepN)
  for (const b of toDelete) localStorage.removeItem(b.key)
}

function prunePre(userId) {
  const pre = listBackups(userId).filter(b => b.type === 'pre')
  const cutoff = Date.now() - PRE_TTL_DAYS * 24 * 3600 * 1000
  const toDelete = pre.filter((b, i) => b.ts < cutoff || i >= KEEP_PRE)
  for (const b of toDelete) localStorage.removeItem(b.key)
}

// ── 恢复 ──────────────────────────────────────────────

/**
 * 全量恢复：先清空当前用户所有数据，再 INSERT 备份
 *
 * progress(stage, n, total) 可选回调
 */
export async function fullRestore(backup, userId, progress) {
  if (!backup || backup.version !== 1) throw new Error('不支持的备份版本')
  if (!backup.tables) throw new Error('备份格式错误，缺少 tables')

  // 跨用户恢复：把所有行的 user_id 改成当前用户
  const remap = backup.user_id !== userId
  const tables = remap ? remapUserId(backup.tables, userId) : backup.tables

  // 1. 删除现有数据
  progress?.('清空当前数据...', 0, 0)
  for (const t of DELETE_ORDER) {
    if (t === 'nodes') {
      // nodes 自引用，需要按深度倒序删
      const { data: rows } = await supabase.from('nodes').select('id, parent_id').eq('user_id', userId)
      const sorted = sortNodesByDepthDesc(rows || [])
      for (const n of sorted) {
        await supabase.from('nodes').delete().eq('id', n.id).eq('user_id', userId)
      }
    } else {
      await supabase.from(t).delete().eq('user_id', userId)
    }
  }

  // 2. 插入备份数据
  let total = INSERT_ORDER.length
  let done = 0
  for (const t of INSERT_ORDER) {
    done++
    const rows = tables[t] || []
    progress?.(t, done, total)
    if (!rows.length) continue

    if (t === 'nodes') {
      // nodes 要按 parent-first 顺序插入避免 FK
      const sorted = sortNodesByParentFirst(rows)
      for (const n of sorted) {
        const { error } = await supabase.from('nodes').insert(stripRuntime(n))
        if (error) console.warn('[restore] nodes insert:', n.name, error.message)
      }
    } else {
      // 批量插入；失败逐行 fallback
      const cleaned = rows.map(stripRuntime)
      const { error } = await supabase.from(t).insert(cleaned)
      if (error) {
        console.warn(`[restore] ${t} batch insert failed, trying one-by-one:`, error.message)
        for (const r of cleaned) {
          const { error: e } = await supabase.from(t).insert(r)
          if (e) console.warn(`[restore] ${t} skip:`, e.message)
        }
      }
    }
  }
  progress?.('完成', total, total)
  return { tables_restored: INSERT_ORDER.length, remapped: remap }
}

function remapUserId(tables, newUserId) {
  const out = {}
  for (const [t, rows] of Object.entries(tables)) {
    out[t] = rows.map(r => ({ ...r, user_id: newUserId }))
  }
  return out
}

function stripRuntime(row) {
  // 去掉前端附加的运行时字段，避免 INSERT 报错
  const { children, annotations, ...rest } = row
  return rest
}

// nodes 排序辅助（避免依赖 treeUtils 的复杂版本）
function sortNodesByDepthDesc(nodes) {
  const parentOf = {}
  nodes.forEach(n => { parentOf[n.id] = n.parent_id })
  const cache = {}
  function depth(id) {
    if (cache[id] !== undefined) return cache[id]
    const pid = parentOf[id]
    cache[id] = pid && parentOf[pid] !== undefined ? 1 + depth(pid) : 0
    return cache[id]
  }
  return [...nodes].sort((a, b) => depth(b.id) - depth(a.id))
}

function sortNodesByParentFirst(nodes) {
  const sorted = []
  const remaining = [...nodes]
  const inserted = new Set()
  let pass = 0
  while (remaining.length > 0 && pass < nodes.length + 1) {
    pass++
    for (let i = remaining.length - 1; i >= 0; i--) {
      const n = remaining[i]
      if (!n.parent_id || inserted.has(n.parent_id)) {
        sorted.push(n)
        inserted.add(n.id)
        remaining.splice(i, 1)
      }
    }
  }
  return [...sorted, ...remaining]
}
