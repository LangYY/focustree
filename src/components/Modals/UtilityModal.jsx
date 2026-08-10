import { Archive, Database, History, Lightbulb, X } from 'lucide-react'
import { useEffect } from 'react'

const CONFIG = {
  memory: ['AI 记忆', Lightbulb],
  recommendations: ['推荐记录', Archive],
  history: ['会话历史', History],
  backup: ['数据备份', Database],
}

export default function UtilityModal({ kind, learnedPatterns = [], recommendations = [], sessions = [], backup, onClose }) {
  const [title, Icon] = CONFIG[kind] || ['工具', Database]

  useEffect(() => {
    const onKeyDown = event => {
      if (event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="ft-utility-modal" onMouseDown={event => { if (event.currentTarget === event.target) onClose?.() }}>
      <section className="ft-utility-modal-panel" role="dialog" aria-modal="true" aria-labelledby="ft-utility-modal-title">
        <header className="ft-utility-modal-head">
          <div className="ft-utility-modal-title"><Icon size={16} /><h2 id="ft-utility-modal-title">{title}</h2></div>
          <button type="button" onClick={onClose} aria-label="关闭"><X size={16} /></button>
        </header>
        <div className="ft-utility-modal-content">
          {kind === 'memory' ? <MemoryList patterns={learnedPatterns} /> : null}
          {kind === 'recommendations' ? <RecommendationList items={recommendations} /> : null}
          {kind === 'history' ? <HistoryList items={sessions} /> : null}
          {kind === 'backup' ? <BackupActions backup={backup} /> : null}
        </div>
      </section>
    </div>
  )
}

function MemoryList({ patterns }) {
  return (
    <div className="ft-utility-list">
      {patterns.length ? patterns.map((pattern, index) => (
        <div className="ft-utility-row" key={pattern.id || index}><Lightbulb size={15} /><span>{pattern.observation || pattern.text || '未命名记忆'}</span><small>{pattern.topic || '长期'}</small></div>
      )) : <UtilityEmpty icon={Lightbulb} text="还没有沉淀的记忆。" />}
    </div>
  )
}

function RecommendationList({ items }) {
  return (
    <div className="ft-utility-list">
      {items.length ? items.slice(0, 30).map((item, index) => (
        <div className="ft-utility-row" key={item.id || index}><Archive size={15} /><span>{item.message || item.reply || '一条推荐'}</span><small>{item.derived_outcome || item.outcome || '待办'}</small></div>
      )) : <UtilityEmpty icon={Archive} text="还没有推荐记录。" />}
    </div>
  )
}

function HistoryList({ items }) {
  return (
    <div className="ft-utility-list">
      {items.length ? items.map((item, index) => (
        <div className="ft-utility-row" key={item.session_id || index}><History size={15} /><span>{item.summary || '未命名会话'}</span><small>{item.count || 0} 条</small></div>
      )) : <UtilityEmpty icon={History} text="还没有历史会话。" />}
    </div>
  )
}

function BackupActions({ backup }) {
  return (
    <div className="ft-utility-list">
      <div className="ft-backup-card"><Database size={18} /><div><strong>本地自动备份</strong><span>{backup?.lastAuto ? `上次自动备份：${new Date(backup.lastAuto).toLocaleString('zh-CN')}` : '自动备份保存在浏览器本地。'}</span></div></div>
      <button type="button" className="ft-primary-button" onClick={backup?.exportToFile}>导出 JSON 数据</button>
      <label className="ft-upload-button">从文件恢复<input type="file" accept="application/json" onChange={event => backup?.restoreFromFile?.(event.target.files?.[0])} /></label>
    </div>
  )
}

function UtilityEmpty({ icon: Icon, text }) {
  return <div className="ft-utility-empty"><Icon size={24} /><span>{text}</span></div>
}
