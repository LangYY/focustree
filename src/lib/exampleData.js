import { branchColorAt } from './branchPalette.js'

export const EXAMPLE_GOAL = Object.freeze({
  text: '在 9 月前发布 3 条视频，同时稳住现金流',
  outcome: '发布 3 条视频并完成本月求职与回款闭环',
  kind: 'stage',
  start_date: '2026-08-10',
  deadline: '2026-09-01',
  constraints: ['每周保留时间处理求职和回款'],
  exclude: ['暂不扩张副业功能'],
  source: 'example',
})

const EXAMPLE_TIMESTAMP = '2026-08-10T09:00:00.000Z'

const NODE_DEFINITIONS = [
  { key: 'content', name: 'B 站频道：熊猫团团', type: 'project', colorIndex: 0, current_priority: 'high', target_completion_date: '2026-09-15' },
  { key: 'content-planning', parent: 'content', name: '内容策划', type: 'category', current_priority: 'high', target_completion_date: '2026-08-18' },
  { key: 'content-research', parent: 'content-planning', name: '调研同类频道标题', type: 'task', status: 'done', current_priority: 'normal', target_completion_date: '2026-08-05', completed_at: '2026-08-05T15:00:00.000Z' },
  { key: 'content-topic', parent: 'content-planning', name: '定下下三期主题', type: 'task', current_priority: 'high', target_completion_date: '2026-08-12' },
  { key: 'content-intro', parent: 'content-planning', name: '写第 1 集冷开场', type: 'task', current_priority: 'urgent', target_completion_date: '2026-08-15' },
  { key: 'content-production', parent: 'content', name: '第 1 集制作', type: 'category', current_priority: 'normal', target_completion_date: '2026-09-01' },
  { key: 'content-script', parent: 'content-production', name: '完成脚本初稿', type: 'task', current_priority: 'high', target_completion_date: '2026-08-18' },
  { key: 'content-storyboard', parent: 'content-production', name: '画分镜', type: 'task', status: 'dormant', current_priority: 'low', target_completion_date: '2026-08-25' },
  { key: 'content-voice', parent: 'content-production', name: '录制配音', type: 'task', current_priority: 'normal', target_completion_date: '2026-08-28' },

  { key: 'cash', name: '现金流与求职', type: 'project', colorIndex: 1, current_priority: 'urgent', target_completion_date: '2026-08-20' },
  { key: 'job-search', parent: 'cash', name: '求职投递', type: 'category', current_priority: 'urgent', target_completion_date: '2026-08-16' },
  { key: 'job-resume', parent: 'job-search', name: '更新简历核心经历', type: 'task', status: 'done', current_priority: 'high', target_completion_date: '2026-08-08', completed_at: '2026-08-08T11:00:00.000Z' },
  { key: 'job-applications', parent: 'job-search', name: '投递 3 个合适岗位', type: 'task', current_priority: 'urgent', target_completion_date: '2026-08-13' },
  { key: 'client-work', parent: 'cash', name: '外包客户', type: 'category', current_priority: 'high', target_completion_date: '2026-08-22' },
  { key: 'client-quote', parent: 'client-work', name: '发报价单并确认回款', type: 'task', current_priority: 'urgent', target_completion_date: '2026-08-11' },
  { key: 'client-scope', parent: 'client-work', name: '确认交付范围', type: 'task', status: 'dormant', current_priority: 'low', target_completion_date: '2026-08-28' },

  { key: 'side', name: '独立产品副线', type: 'project', colorIndex: 2, status: 'dormant', current_priority: 'low', target_completion_date: '2026-10-01' },
  { key: 'tool-build', parent: 'side', name: '小工具开发', type: 'category', current_priority: 'normal', target_completion_date: '2026-09-20' },
  { key: 'tool-prototype', parent: 'tool-build', name: '做出可点击原型', type: 'task', current_priority: 'normal', target_completion_date: '2026-09-10' },
  { key: 'tool-landing', parent: 'tool-build', name: '写一页介绍页', type: 'task', status: 'dormant', current_priority: 'low', target_completion_date: '2026-09-20' },
  { key: 'validation', parent: 'side', name: '市场验证', type: 'category', status: 'dormant', current_priority: 'low', target_completion_date: '2026-09-30' },
  { key: 'interviews', parent: 'validation', name: '找 5 个人聊需求', type: 'task', status: 'dormant', current_priority: 'low', target_completion_date: '2026-09-30' },
]

export function buildExampleNodes(idFactory = () => crypto.randomUUID()) {
  const ids = new Map()
  return NODE_DEFINITIONS.map((definition, index) => {
    const id = idFactory(definition.key)
    ids.set(definition.key, id)
    const isProject = definition.type === 'project'
    const status = definition.status || 'active'
    return {
      id,
      parent_id: definition.parent ? ids.get(definition.parent) : null,
      name: definition.name,
      type: definition.type,
      color: isProject ? branchColorAt(definition.colorIndex) : null,
      weight: definition.current_priority === 'urgent' ? 1.35 : definition.current_priority === 'high' ? 1.1 : .8,
      status,
      current_priority: definition.current_priority,
      target_completion_date: definition.target_completion_date,
      position: (index + 1) * 1000,
      expanded: true,
      last_active_at: status === 'dormant' ? '2026-07-20T09:00:00.000Z' : EXAMPLE_TIMESTAMP,
      completed_at: definition.completed_at || null,
    }
  })
}
