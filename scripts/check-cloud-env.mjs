const required = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
]

const provider = process.env.LLM_PROVIDER === 'openai' ? 'openai' : 'deepseek'
const providerRequired = provider === 'openai' ? ['OPENAI_API_KEY'] : ['DEEPSEEK_API_KEY']

const missing = [...required, ...providerRequired].filter((key) => {
  const value = process.env[key]
  return !value || value.includes('your-project') || value.includes('your-') || value === 'sk-xxx'
})

if (missing.length) {
  console.error(`Missing cloud environment variables: ${missing.join(', ')}`)
  process.exit(1)
}

console.log(`Cloud environment looks complete. LLM provider: ${provider}`)
