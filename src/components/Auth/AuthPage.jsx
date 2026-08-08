import { ArrowRight, Leaf, LockKeyhole, Mail, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { supabase, supabaseConfig } from '../../lib/supabase'

export default function AuthPage() {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  if (!supabaseConfig.isConfigured) return <MissingConfig />

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)
    try {
      if (mode === 'login') {
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
        if (authError) throw authError
      } else {
        const { error: authError } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } })
        if (authError) throw authError
        setMessage('注册成功！请检查邮箱验证链接，然后回来登录。')
        setMode('login')
      }
    } catch (authError) {
      setError(authError.message || '操作失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="ft-auth-page">
      <div className="ft-auth-orbit ft-auth-orbit-one" />
      <div className="ft-auth-orbit ft-auth-orbit-two" />
      <main className="ft-auth-card">
        <div className="ft-auth-brand"><span className="ft-auth-mark"><Leaf size={24} strokeWidth={1.5} /></span><span className="ft-eyebrow">FOCUSTREE</span><h1>专注树</h1><p>把脑子里的事，长成一棵能走的树。</p></div>
        <div className="ft-auth-tabs"><button type="button" className={mode === 'login' ? 'is-active' : ''} onClick={() => switchMode('login', setMode, setError, setMessage)}>登录</button><button type="button" className={mode === 'signup' ? 'is-active' : ''} onClick={() => switchMode('signup', setMode, setError, setMessage)}>注册</button></div>
        <form className="ft-auth-form" onSubmit={handleSubmit}>
          <label><span>邮箱</span><div className="ft-auth-input"><Mail size={16} /><input type="email" value={email} onChange={event => setEmail(event.target.value)} required placeholder="you@example.com" /></div></label>
          <label><span>密码</span><div className="ft-auth-input"><LockKeyhole size={16} /><input type="password" value={password} onChange={event => setPassword(event.target.value)} required minLength={6} placeholder="至少 6 位" /></div></label>
          {error ? <div className="ft-auth-message is-error">{error}</div> : null}
          {message ? <div className="ft-auth-message is-success">{message}</div> : null}
          <button className="ft-auth-submit" type="submit" disabled={loading}>{loading ? '处理中…' : mode === 'login' ? '进入专注树' : '创建账户'}<ArrowRight size={16} /></button>
        </form>
        <div className="ft-auth-note"><Sparkles size={14} />你的数据只属于你，目标和树都会保存在自己的账户里。</div>
      </main>
    </div>
  )
}

function MissingConfig() {
  return <div className="ft-auth-page"><main className="ft-config-card"><span className="ft-auth-mark"><Leaf size={24} strokeWidth={1.5} /></span><span className="ft-eyebrow">FOCUSTREE / SETUP</span><h1>先把这棵树接上土壤</h1><p>FocusTree 已经启动，但还不能登录和保存数据。配置本地环境变量后重启应用即可使用。</p><code>VITE_SUPABASE_URL{`\n`}VITE_SUPABASE_ANON_KEY{`\n`}SUPABASE_URL{`\n`}SUPABASE_SERVICE_ROLE_KEY{`\n`}DEEPSEEK_API_KEY 或 OPENAI_API_KEY</code></main></div>
}

function switchMode(next, setMode, setError, setMessage) {
  setMode(next)
  setError('')
  setMessage('')
}
