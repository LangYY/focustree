import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sqlDir = path.join(root, 'sql')
const outDir = path.join(root, 'dist')
const outFile = path.join(outDir, 'focustree-supabase.sql')

const files = (await readdir(sqlDir))
  .filter((name) => /^\d+_.*\.sql$/i.test(name))
  .sort((a, b) => a.localeCompare(b))

if (!files.length) {
  console.error('No numbered SQL migrations found in sql/.')
  process.exit(1)
}

if (files[0] !== '000_core_tables.sql') {
  console.error(`First migration must be 000_core_tables.sql, got ${files[0]}.`)
  process.exit(1)
}

const chunks = []
chunks.push('-- FocusTree Supabase schema bundle')
chunks.push(`-- Generated from sql/*.sql on ${new Date().toISOString()}`)
chunks.push('-- Run this whole file in the Supabase SQL Editor for a fresh project.')
chunks.push('')

for (const name of files) {
  const fullPath = path.join(sqlDir, name)
  const content = await readFile(fullPath, 'utf8')
  chunks.push('')
  chunks.push('-- ════════════════════════════════════════════════════════')
  chunks.push(`-- ${name}`)
  chunks.push('-- ════════════════════════════════════════════════════════')
  chunks.push('')
  chunks.push(content.trimEnd())
  chunks.push('')
}

await mkdir(outDir, { recursive: true })
await writeFile(outFile, `${chunks.join('\n')}\n`, 'utf8')

console.log(`Bundled ${files.length} migrations into ${path.relative(root, outFile)}`)
