import { getDerivedWeightMeta, getNodeDueState } from '../../lib/treeUtils.js'

export function buildBoardColumns(treeData, metaById = new Map(), filter = 'all') {
  const projects = Array.isArray(treeData?.children)
    ? treeData.children.filter(node => node?.type === 'project')
    : []

  return projects.map(project => {
    const tasks = []
    collectProjectTasks(project, '', tasks)

    const visibleTasks = tasks
      .filter(task => matchesBoardFilter(task, filter))
      .map(task => ({
        ...task,
        meta: getDerivedWeightMeta(metaById, task) || {},
        due: getNodeDueState(task),
      }))
      .sort((a, b) => (b.meta.directPriority || 0) - (a.meta.directPriority || 0))

    return {
      key: project.id,
      project,
      tasks: visibleTasks,
    }
  })
}

function collectProjectTasks(node, categoryName, tasks) {
  const nextCategoryName = node.type === 'category' ? node.name : categoryName
  if (node.type === 'task') {
    tasks.push({ ...node, categoryName: nextCategoryName || '项目直达' })
    return
  }
  node.children?.forEach(child => collectProjectTasks(child, nextCategoryName, tasks))
}

function matchesBoardFilter(task, filter) {
  if (filter === 'active') return task.status === 'active'
  if (filter === 'due') return Boolean(getNodeDueState(task))
  return true
}
