import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'

const { app } = await import('../server/index.js')
const assetsDir = new URL('../dist/assets/', import.meta.url)

function currentAsset(extension) {
  const name = readdirSync(assetsDir).find((entry) => entry.startsWith('index-') && entry.endsWith(`.${extension}`))
  assert.ok(name, `expected a current index ${extension} asset in dist`)
  return readFileSync(new URL(name, assetsDir), 'utf8')
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return server.address().port
}

test('legacy hashed entry assets never receive the SPA HTML fallback', async () => {
  const server = createServer(app)
  const port = await listen(server)

  try {
    for (const { extension, contentType } of [
      { extension: 'js', contentType: /^text\/javascript/i },
      { extension: 'css', contentType: /^text\/css/i },
    ]) {
      const response = await fetch(`http://127.0.0.1:${port}/assets/BPqB6IAJ.${extension}`)
      const body = await response.text()

      assert.equal(response.status, 200)
      assert.match(response.headers.get('content-type') || '', contentType)
      assert.equal(body, currentAsset(extension))
      assert.doesNotMatch(body, /<!doctype html/i)
    }
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
