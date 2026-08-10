import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('frontend deploy preserves prior hashed assets after switching dist', () => {
  const script = readFileSync(new URL('../scripts/deploy-ecs.sh', import.meta.url), 'utf8')

  assert.match(script, /cp -an dist\.old\/assets\/\. dist\/assets\//)
})
