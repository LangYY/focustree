import { createClient } from '@supabase/supabase-js'

const runtimeConfig = typeof window !== 'undefined' ? window.__FOCUSTREE_CONFIG__ : null
const supabaseUrl = runtimeConfig?.supabaseUrl || import.meta.env.VITE_SUPABASE_URL
const supabaseKey = runtimeConfig?.supabaseAnonKey || import.meta.env.VITE_SUPABASE_ANON_KEY

function isPlaceholder(value) {
  return !value || String(value).includes('your-project') || String(value).includes('your-publishable-key')
}

export const supabaseConfig = {
  isConfigured: !isPlaceholder(supabaseUrl) && !isPlaceholder(supabaseKey),
  missingReason: '请先在 .env 里配置 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY。',
}

function unavailableResult() {
  return Promise.resolve({
    data: null,
    error: new Error(supabaseConfig.missingReason),
  })
}

function createUnavailableQuery() {
  const query = {
    select: () => query,
    insert: () => query,
    update: () => query,
    upsert: () => query,
    delete: () => query,
    eq: () => query,
    is: () => query,
    gte: () => query,
    lte: () => query,
    order: () => query,
    single: unavailableResult,
    maybeSingle: unavailableResult,
    then: (resolve, reject) => unavailableResult().then(resolve, reject),
  }
  return query
}

function createUnavailableClient() {
  return {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signInWithPassword: unavailableResult,
      signUp: unavailableResult,
      signOut: () => Promise.resolve({ error: null }),
    },
    from: () => createUnavailableQuery(),
  }
}

export const supabase = supabaseConfig.isConfigured
  ? createClient(supabaseUrl, supabaseKey)
  : createUnavailableClient()
