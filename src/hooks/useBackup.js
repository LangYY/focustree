import { useEffect, useCallback, useRef, useState } from 'react'
import {
  autoBackup,
  listBackups,
  getBackupMeta,
  loadBackup,
  exportAll,
  downloadBackup,
  fullRestore,
} from '../lib/backup'

const AUTO_INTERVAL_MS = 60 * 60 * 1000  // 每小时一次
const LAST_AUTO_KEY = 'ft_last_auto_backup_'
const LAST_MANUAL_KEY = 'ft_last_manual_export_'

/**
 * 备份系统钩子。提供：
 *  - 自动备份（每小时 + 启动 5s 后）
 *  - 手动导出/导入
 *  - 关键操作前快照（preDestructiveBackup）
 *  - 备份列表 / 恢复
 */
export function useBackup(user, onAfterRestore) {
  const [list, setList] = useState([])
  const [lastAuto, setLastAuto] = useState(null)
  const [lastManual, setLastManual] = useState(null)
  const [working, setWorking] = useState(false)
  const [progress, setProgress] = useState(null)

  const refreshList = useCallback(() => {
    if (!user) { setList([]); return }
    const items = listBackups(user.id).map(b => ({ ...b, meta: getBackupMeta(b.key) }))
    setList(items)
  }, [user])

  // 加载时间戳
  useEffect(() => {
    if (!user) return
    const auto = parseInt(localStorage.getItem(LAST_AUTO_KEY + user.id) || '0', 10)
    const manual = parseInt(localStorage.getItem(LAST_MANUAL_KEY + user.id) || '0', 10)
    setLastAuto(auto || null)
    setLastManual(manual || null)
    refreshList()
  }, [user, refreshList])

  // 周期性自动备份
  const intervalRef = useRef(null)
  useEffect(() => {
    if (!user) return
    let cancelled = false

    const runAuto = async () => {
      if (cancelled) return
      const last = parseInt(localStorage.getItem(LAST_AUTO_KEY + user.id) || '0', 10)
      if (Date.now() - last < AUTO_INTERVAL_MS / 2) return  // 距上次不到 30 分钟就跳
      try {
        const result = await autoBackup(user.id, { reason: 'periodic' })
        if (result) {
          const now = Date.now()
          localStorage.setItem(LAST_AUTO_KEY + user.id, String(now))
          setLastAuto(now)
          refreshList()
        }
      } catch (e) {
        console.warn('[useBackup] auto failed:', e.message)
      }
    }

    // 启动 5 秒后一次
    const startTimer = setTimeout(runAuto, 5000)
    // 之后每小时一次
    intervalRef.current = setInterval(runAuto, AUTO_INTERVAL_MS)

    return () => {
      cancelled = true
      clearTimeout(startTimer)
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [user, refreshList])

  // 关键操作前快照（外部钩子）
  const preDestructiveBackup = useCallback(async (reason) => {
    if (!user) return null
    try {
      const result = await autoBackup(user.id, { reason, preDestructive: true })
      refreshList()
      return result
    } catch (e) {
      console.warn('[useBackup] pre-destructive failed:', e.message)
      return null
    }
  }, [user, refreshList])

  // 手动导出
  const exportToFile = useCallback(async () => {
    if (!user || working) return
    setWorking(true)
    try {
      const data = await exportAll(user.id)
      const filename = downloadBackup(data)
      const now = Date.now()
      localStorage.setItem(LAST_MANUAL_KEY + user.id, String(now))
      setLastManual(now)
      return filename
    } finally {
      setWorking(false)
    }
  }, [user, working])

  // 从文件恢复
  const restoreFromFile = useCallback(async (file) => {
    if (!user || working) return
    if (!file) return
    setWorking(true)
    setProgress('读取文件...')
    try {
      const text = await file.text()
      const backup = JSON.parse(text)
      // 先存一份当前状态作为"恢复前快照"
      await autoBackup(user.id, { reason: 'pre-restore', preDestructive: true })
      // 执行恢复
      await fullRestore(backup, user.id, (stage, n, total) => {
        setProgress(`恢复中: ${stage}${total ? ` (${n}/${total})` : ''}`)
      })
      setProgress('完成 ✓')
      refreshList()
      onAfterRestore?.()
      return { ok: true, stats: backup.stats }
    } catch (e) {
      console.error('[restoreFromFile]', e)
      setProgress(`失败：${e.message}`)
      throw e
    } finally {
      setWorking(false)
      setTimeout(() => setProgress(null), 3000)
    }
  }, [user, working, refreshList, onAfterRestore])

  // 从 localStorage 备份恢复
  const restoreFromLocal = useCallback(async (key) => {
    if (!user || working) return
    setWorking(true)
    setProgress('读取备份...')
    try {
      const backup = loadBackup(key)
      await autoBackup(user.id, { reason: 'pre-restore', preDestructive: true })
      await fullRestore(backup, user.id, (stage, n, total) => {
        setProgress(`恢复中: ${stage}${total ? ` (${n}/${total})` : ''}`)
      })
      setProgress('完成 ✓')
      refreshList()
      onAfterRestore?.()
      return { ok: true }
    } catch (e) {
      console.error('[restoreFromLocal]', e)
      setProgress(`失败：${e.message}`)
      throw e
    } finally {
      setWorking(false)
      setTimeout(() => setProgress(null), 3000)
    }
  }, [user, working, refreshList, onAfterRestore])

  return {
    list,
    lastAuto,
    lastManual,
    working,
    progress,
    refreshList,
    preDestructiveBackup,
    exportToFile,
    restoreFromFile,
    restoreFromLocal,
  }
}
