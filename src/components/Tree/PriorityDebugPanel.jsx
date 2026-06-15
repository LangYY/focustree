import { useMemo, useState } from 'react'
import { computePriorityMetaMap, getPriorityMeta } from '../../lib/priorityEngine'

const SIGNAL_LABELS = {
  baseline: '基础值',
  manual_priority: '用户优先级',
  goal_alignment: '目标契合',
  necessity: '必要性',
  delay_cost: '延误损失',
  deadline_pressure: '期限压力',
  status_gate: '状态修正',
}

const STALE_LABELS = {
  goal_changed: '目标已改变',
  node_changed: '节点内容已改变',
  unconfirmed_analysis: '分析尚未确认',
  missing_analysis: '尚无 AI 分析',
}

export default function PriorityDebugPanel({ treeData, goal, onClose }) {
  const [comparisonDraft, setComparisonDraft] = useState('')
  const [comparisonGoal, setComparisonGoal] = useState(null)
  const [selectedId, setSelectedId] = useState(null)

  const nodes = useMemo(() => flattenTree(treeData).filter(node => node.type !== 'root'), [treeData])
  const currentMeta = useMemo(
    () => computePriorityMetaMap(treeData, { goal }),
    [goal, treeData]
  )
  const comparisonMeta = useMemo(
    () => comparisonGoal
      ? computePriorityMetaMap(treeData, { goal: comparisonGoal })
      : null,
    [comparisonGoal, treeData]
  )
  const rows = useMemo(() => nodes.map(node => {
    const meta = getPriorityMeta(currentMeta, node)
    const alternate = comparisonMeta ? getPriorityMeta(comparisonMeta, node) : null
    return {
      node,
      meta,
      alternate,
      delta: alternate && meta ? alternate.branchPriority - meta.branchPriority : null,
    }
  }).sort((a, b) => (b.meta?.branchPriority || 0) - (a.meta?.branchPriority || 0)), [comparisonMeta, currentMeta, nodes])

  const selected = rows.find(row => String(row.node.id) === String(selectedId)) || rows[0] || null
  const staleCount = rows.filter(row => row.meta?.staleReasons?.length).length

  const runComparison = () => {
    const text = comparisonDraft.trim()
    setComparisonGoal(text ? {
      version: `debug-${text}`,
      text,
      outcome: text,
      kind: 'long_term',
      constraints: [],
      exclude: [],
    } : null)
  }

  return (
    <aside className="w-[390px] flex-shrink-0 border-l border-gray-800 bg-gray-950 text-gray-200 flex flex-col overflow-hidden">
      <div className="h-11 px-3 border-b border-gray-800 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">优先级审计</div>
          <div className="text-[10px] text-gray-600">priority-v2 · {rows.length} 个节点</div>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-200 px-2" title="关闭审计视图">×</button>
      </div>

      <div className="p-3 border-b border-gray-800 space-y-2">
        <div className="text-[11px] text-gray-500">当前目标</div>
        <div className="text-xs text-gray-300 line-clamp-2">{goal?.text || '未设置，目标信号按中性值处理'}</div>
        <div className="flex gap-1.5">
          <input
            value={comparisonDraft}
            onChange={event => setComparisonDraft(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') runComparison() }}
            placeholder="输入相反或替代目标进行比较"
            className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs outline-none focus:border-cyan-700"
          />
          <button onClick={runComparison} className="rounded border border-cyan-800 px-2 text-xs text-cyan-300 hover:bg-cyan-950/60">比较</button>
        </div>
        {comparisonGoal && (
          <div className="flex items-center justify-between text-[10px] text-cyan-400">
            <span className="truncate">对照：{comparisonGoal.text}</span>
            <button onClick={() => { setComparisonGoal(null); setComparisonDraft('') }} className="ml-2 text-gray-600 hover:text-gray-300">清除</button>
          </div>
        )}
        {staleCount > 0 && (
          <div className="text-[10px] text-amber-400/90">{staleCount} 个节点的 AI 判断已过期或尚未确认，当前使用本地信号回退。</div>
        )}
      </div>

      <div className="flex-1 min-h-0 grid grid-rows-[minmax(150px,42%)_1fr]">
        <div className="overflow-y-auto border-b border-gray-800">
          <div className="sticky top-0 bg-gray-950/95 grid grid-cols-[1fr_42px_42px_42px] gap-1 px-3 py-1.5 text-[10px] text-gray-600 border-b border-gray-900">
            <span>节点</span><span>直接</span><span>枝干</span><span>{comparisonGoal ? '变化' : '培育'}</span>
          </div>
          {rows.map(row => (
            <button
              key={row.node.id}
              onClick={() => setSelectedId(row.node.id)}
              className={`w-full grid grid-cols-[1fr_42px_42px_42px] gap-1 px-3 py-2 text-left text-[11px] border-b border-gray-900/80 hover:bg-gray-900 ${selected?.node.id === row.node.id ? 'bg-gray-900' : ''}`}
            >
              <span className="truncate" style={{ paddingLeft: `${Math.min(row.meta?.depth || 0, 5) * 7}px` }}>{row.node.name}</span>
              <Score value={row.meta?.directPriority} />
              <Score value={row.meta?.branchPriority} strong />
              {comparisonGoal ? <Delta value={row.delta} /> : <Score value={row.meta?.cultivationScore} />}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto p-3">
          {!selected ? (
            <div className="text-xs text-gray-600">树中还没有可分析节点。</div>
          ) : (
            <NodeAudit row={selected} comparisonGoal={comparisonGoal} />
          )}
        </div>
      </div>
    </aside>
  )
}

function NodeAudit({ row, comparisonGoal }) {
  const { node, meta, alternate, delta } = row
  return (
    <div className="space-y-3 text-[11px]">
      <div>
        <div className="text-sm text-gray-100">{node.name}</div>
        <div className="mt-1 grid grid-cols-3 gap-1.5">
          <Metric label="直接优先级" value={meta?.directPriority} />
          <Metric label="枝干优先级" value={meta?.branchPriority} />
          <Metric label="培育程度" value={meta?.cultivationScore} />
        </div>
      </div>

      <div>
        <div className="mb-1 text-gray-500">输入信号贡献</div>
        <div className="space-y-1">
          {(meta?.signalBreakdown || []).map(signal => (
            <div key={signal.key} className="grid grid-cols-[1fr_42px_50px] gap-2">
              <span className="text-gray-400">{SIGNAL_LABELS[signal.key] || signal.key}</span>
              <span className="text-right text-gray-500">{signal.score}</span>
              <span className="text-right text-cyan-400">+{signal.contribution}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Metric
          label={meta?.analysisConfidence == null ? '本地综合置信度' : 'AI 判断置信度'}
          value={Math.round(((meta?.analysisConfidence ?? meta?.confidence) || 0) * 100)}
          suffix="%"
        />
        <Metric label="关系类型" text={meta?.relationType || 'normal'} />
      </div>
      {meta?.analysisReason && <div className="text-gray-500">AI 解释：{meta.analysisReason}</div>}
      <div>
        <div className="mb-1 text-gray-500">数据状态</div>
        <div className={meta?.staleReasons?.length ? 'text-amber-400' : 'text-emerald-400'}>
          {meta?.staleReasons?.length
            ? meta.staleReasons.map(reason => STALE_LABELS[reason] || reason).join('、')
            : '已确认且仍然有效'}
        </div>
      </div>

      {comparisonGoal && (
        <div className="border-t border-gray-800 pt-2">
          <div className="text-gray-500">目标改变后的枝干分数</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-lg text-gray-200">{alternate?.branchPriority ?? 0}</span>
            <Delta value={delta} />
          </div>
          <div className="mt-1 text-[10px] text-gray-600">对照目标：{comparisonGoal.text}</div>
        </div>
      )}
    </div>
  )
}

function Metric({ label, value, text, suffix = '' }) {
  return (
    <div className="rounded border border-gray-800 bg-gray-900/60 px-2 py-1.5">
      <div className="text-[10px] text-gray-600">{label}</div>
      <div className="mt-0.5 text-gray-200">{text ?? `${Number(value || 0).toFixed(1)}${suffix}`}</div>
    </div>
  )
}

function Score({ value, strong = false }) {
  return <span className={`text-right tabular-nums ${strong ? 'text-gray-200' : 'text-gray-500'}`}>{Math.round(value || 0)}</span>
}

function Delta({ value }) {
  const number = Math.round((value || 0) * 10) / 10
  const className = number > 0 ? 'text-emerald-400' : number < 0 ? 'text-rose-400' : 'text-gray-600'
  return <span className={`text-right tabular-nums ${className}`}>{number > 0 ? '+' : ''}{number}</span>
}

function flattenTree(tree) {
  if (!tree) return []
  const output = []
  const walk = node => {
    output.push(node)
    for (const child of node.children || []) walk(child)
  }
  walk(tree)
  return output
}
