// AI calls are proxied server-side to avoid exposing the API key in the browser.
// For now, this is a placeholder — we'll add the backend route in a later step.

export async function sendMessage({ messages, treeContext }) {
  // TODO: replace with actual API call once backend proxy is set up
  const systemPrompt = buildSystemPrompt(treeContext)

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, system: systemPrompt }),
  })

  if (!response.ok) {
    throw new Error(`AI request failed: ${response.statusText}`)
  }

  const data = await response.json()
  return data.content
}

function buildSystemPrompt(treeContext) {
  return `你是「专注树」的 Focus Agent，帮助自由职业者理清工作优先级。

当前项目树状态：
${treeContext ? JSON.stringify(treeContext, null, 2) : '暂无数据'}

你的职责：
1. 当用户问「现在该做什么」时，根据树状态推荐最重要的 1-3 件事
2. 当用户说完成了某件事时，确认并建议更新树的状态
3. 当用户抛出想法时，帮助归类到合适的项目/分类下
4. 回答简短，用中文，不超过 150 字`
}
