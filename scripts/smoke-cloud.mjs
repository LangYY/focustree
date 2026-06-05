const rawUrl = process.argv[2]
const allowUnconfigured = process.argv.includes('--allow-unconfigured')
const requireReadiness = process.argv.includes('--require-readiness')

if (!rawUrl) {
  console.error('Usage: npm run cloud:smoke -- <https://your-domain> [--allow-unconfigured] [--require-readiness]')
  process.exit(1)
}

const baseUrl = rawUrl.replace(/\/+$/, '')

async function fetchText(path, { allowErrorStatus = false } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { 'User-Agent': 'focustree-smoke/1.0' },
  })
  const text = await response.text()
  if (!response.ok && !allowErrorStatus) {
    throw new Error(`${path} returned ${response.status}: ${text.slice(0, 200)}`)
  }
  return { response, text }
}

async function fetchJson(path, options) {
  const { response, text } = await fetchText(path, options)
  try {
    return { response, json: JSON.parse(text) }
  } catch (error) {
    throw new Error(`${path} did not return JSON: ${text.slice(0, 200)}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const checks = []

try {
  const { json: health } = await fetchJson('/health')
  assert(health.ok === true, '/health did not report ok=true')
  checks.push('/health ok')

  if (!allowUnconfigured) {
    assert(health.llm_configured === true, '/health reports llm_configured=false')
    assert(health.public_supabase_configured === true, '/health reports public_supabase_configured=false')
    assert(health.service_supabase_configured === true, '/health reports service_supabase_configured=false')
    assert(health.supabase_configured === true, '/health reports supabase_configured=false')
    checks.push('/health cloud config ok')
  }

  if (requireReadiness) {
    const { response, json: readiness } = await fetchJson('/readiness', { allowErrorStatus: true })
    const failedTables = Object.entries(readiness.database?.tables || {})
      .filter(([, value]) => !value?.ok)
      .map(([table, value]) => `${table}: ${value?.message || 'not ok'}`)
      .join('; ')
    assert(response.ok, `/readiness returned ${response.status}${failedTables ? ` (${failedTables})` : ''}`)
    assert(readiness.ok === true, '/readiness did not report ok=true')
    assert(readiness.database?.ok === true, '/readiness reports database.ok=false')
    checks.push('/readiness database ok')
  }

  const runtime = await fetchText('/runtime-config.js')
  assert(runtime.text.includes('window.__FOCUSTREE_CONFIG__='), '/runtime-config.js missing config assignment')
  if (!allowUnconfigured) {
    assert(runtime.text.includes('supabaseUrl'), '/runtime-config.js missing supabaseUrl')
    assert(!runtime.text.includes('your-project'), '/runtime-config.js still contains placeholder values')
  }
  checks.push('/runtime-config.js ok')

  const root = await fetchText('/')
  assert(root.text.includes('<div id="root"></div>'), 'root page missing React mount node')
  assert(root.text.includes('/runtime-config.js'), 'root page missing runtime config script')
  checks.push('/ page ok')

  const deepLink = await fetchText('/focus/tree')
  assert(deepLink.text.includes('<div id="root"></div>'), 'SPA fallback missing React mount node')
  checks.push('SPA fallback ok')

  console.log(`FocusTree cloud smoke passed for ${baseUrl}`)
  for (const item of checks) console.log(`- ${item}`)
} catch (error) {
  console.error(`FocusTree cloud smoke failed for ${baseUrl}`)
  console.error(error.message || error)
  process.exit(1)
}
