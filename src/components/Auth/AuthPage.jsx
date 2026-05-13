import { useState } from 'react'
import { supabase } from '../../lib/supabase'

export default function AuthPage() {
  const [mode, setMode] = useState('login') // 'login' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

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
        const { error } = await supabase.auth.signUp({ email, password })
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

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#0f1117',
      }}
    >
      <div
        style={{
          width: 360,
          background: '#1a1d27',
          borderRadius: 16,
          padding: '40px 36px',
          border: '1px solid #2d3148',
        }}
      >
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.3 }}>FT</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#e5e7eb' }}>专注树</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>你的外置大脑</div>
        </div>

        {/* Tab 切换 */}
        <div
          style={{
            display: 'flex',
            background: '#0f1117',
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
                background: mode === m ? '#2d3148' : 'transparent',
                color: mode === m ? '#e5e7eb' : '#6b7280',
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
            <label style={{ display: 'block', fontSize: 13, color: '#9ca3af', marginBottom: 6 }}>
              邮箱
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
              style={{
                width: '100%',
                padding: '10px 14px',
                background: '#0f1117',
                border: '1px solid #2d3148',
                borderRadius: 8,
                color: '#e5e7eb',
                fontSize: 14,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', fontSize: 13, color: '#9ca3af', marginBottom: 6 }}>
              密码
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              placeholder="至少 6 位"
              minLength={6}
              style={{
                width: '100%',
                padding: '10px 14px',
                background: '#0f1117',
                border: '1px solid #2d3148',
                borderRadius: 8,
                color: '#e5e7eb',
                fontSize: 14,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {error && (
            <div style={{ color: '#f87171', fontSize: 13, marginBottom: 16, textAlign: 'center' }}>
              {error}
            </div>
          )}
          {message && (
            <div style={{ color: '#4ade80', fontSize: 13, marginBottom: 16, textAlign: 'center' }}>
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '11px 0',
              background: loading ? '#374151' : '#3b82f6',
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
