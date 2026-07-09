import { useState } from 'react'
import { supabase, supabaseConfig } from '../../lib/supabase'

export default function AuthPage() {
  const [mode, setMode] = useState('login') // 'login' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  if (!supabaseConfig.isConfigured) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: 'var(--color-surface)',
          color: 'var(--color-ink)',
        }}
      >
        <div
          style={{
            width: 420,
            background: 'var(--color-panel)',
            borderRadius: 16,
            padding: '36px',
            border: '1px solid var(--color-line)',
            boxShadow: 'var(--shadow-soft)',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 10, fontFamily: 'var(--font-display)' }}>还没有连接 Supabase</div>
          <div style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--color-ink-soft)', marginBottom: 18 }}>
            FocusTree 已经启动，但还不能登录和保存数据。配置本地环境变量后重启应用即可使用。
          </div>
          <div
            style={{
              background: 'var(--color-panel-soft)',
              border: '1px solid var(--color-line)',
              borderRadius: 10,
              padding: '14px 16px',
              fontSize: 13,
              lineHeight: 1.8,
              color: 'var(--color-ink-soft)',
              fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
              wordBreak: 'break-all',
            }}
          >
            VITE_SUPABASE_URL<br />
            VITE_SUPABASE_ANON_KEY<br />
            SUPABASE_URL<br />
            SUPABASE_SERVICE_ROLE_KEY<br />
            DEEPSEEK_API_KEY 或 OPENAI_API_KEY
          </div>
        </div>
      </div>
    )
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)

    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
          },
        })
        if (error) throw error
        setMessage('注册成功！请检查邮箱验证链接，然后回来登录。')
        setMode('login')
      }
    } catch (err) {
      setError(err.message || '操作失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  const inputStyle = {
    width: '100%',
    padding: '10px 14px',
    background: 'var(--color-panel)',
    border: '1px solid var(--color-line-strong)',
    borderRadius: 8,
    color: 'var(--color-ink)',
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box',
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'var(--color-surface)',
      }}
    >
      <div
        style={{
          width: 360,
          background: 'var(--color-panel)',
          borderRadius: 16,
          padding: '40px 36px',
          border: '1px solid var(--color-line)',
          boxShadow: 'var(--shadow-lift)',
        }}
      >
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 26, fontWeight: 600, color: 'var(--color-ink)', fontFamily: 'var(--font-display)', letterSpacing: '0.12em' }}>专注树</div>
          <div style={{ fontSize: 13, color: 'var(--color-ink-faint)', marginTop: 6 }}>你的外置大脑</div>
        </div>

        {/* Tab 切换 */}
        <div
          style={{
            display: 'flex',
            background: 'var(--color-panel-soft)',
            borderRadius: 10,
            padding: 4,
            marginBottom: 24,
          }}
        >
          {['login', 'signup'].map(m => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(''); setMessage('') }}
              style={{
                flex: 1,
                padding: '8px 0',
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 500,
                background: mode === m ? 'var(--color-panel)' : 'transparent',
                color: mode === m ? 'var(--color-ink)' : 'var(--color-ink-faint)',
                boxShadow: mode === m ? 'var(--shadow-soft)' : 'none',
                transition: 'all 0.2s',
              }}
            >
              {m === 'login' ? '登录' : '注册'}
            </button>
          ))}
        </div>

        {/* 表单 */}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--color-ink-soft)', marginBottom: 6 }}>
              邮箱
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--color-ink-soft)', marginBottom: 6 }}>
              密码
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              placeholder="至少 6 位"
              minLength={6}
              style={inputStyle}
            />
          </div>

          {error && (
            <div style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 16, textAlign: 'center' }}>
              {error}
            </div>
          )}
          {message && (
            <div style={{ color: 'var(--color-accent)', fontSize: 13, marginBottom: 16, textAlign: 'center' }}>
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '11px 0',
              background: loading ? 'var(--color-ink-ghost)' : 'var(--color-accent)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 15,
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'background 0.2s',
            }}
          >
            {loading ? '处理中…' : mode === 'login' ? '登录' : '注册'}
          </button>
        </form>
      </div>
    </div>
  )
}
