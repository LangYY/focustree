import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAgentRequestBody, resolveAttemptModel, resolveModel } from '../server/agent.js'

test('agent always resolves the user-facing model to DeepSeek V4 Flash', () => {
  assert.equal(resolveModel('auto', '请帮我规划本周任务', 'deepseek'), 'deepseek-v4-flash')
  assert.equal(resolveModel('chat', '短命令', 'openai'), 'deepseek-v4-flash')
  assert.equal(resolveModel('reasoner', '复杂分析', 'deepseek'), 'deepseek-v4-flash')
})

test('agent request uses maximum reasoning and the expanded flash token budget', () => {
  const body = buildAgentRequestBody('system', [{ role: 'user', content: 'hello' }], 'deepseek-v4-flash')
  assert.equal(body.model, 'deepseek-v4-flash')
  assert.equal(body.reasoning_effort, 'max')
  assert.equal(body.max_tokens, 16000)
  assert.equal('temperature' in body, false)
})

test('empty or unparsable flash responses retry internally with the pro model', () => {
  assert.equal(resolveAttemptModel('deepseek-v4-flash', 0, null), 'deepseek-v4-flash')
  assert.equal(resolveAttemptModel('deepseek-v4-flash', 1, 'empty_content'), 'deepseek-v4-pro')
  assert.equal(resolveAttemptModel('deepseek-v4-flash', 2, 'parse'), 'deepseek-v4-pro')
})
