import { ArrowRight, Leaf, LockKeyhole, Mail, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { supabase, supabaseConfig } from '../../lib/supabase'
import { formatAuthErrorMessage, withAuthTimeout } from '../../lib/authSession'

export default function AuthPage({ initialError = '' }) {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [loginLinkLoading, setLoginLinkLoading] = useState(false)
  const [loginLinkCooldown, setLoginLinkCooldown] = useState(0)
  const [error, setError] = useState(initialError)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (initialError) setError(initialError)
  }, [initialError])

  useEffect(() => {
    if (loginLinkCooldown <= 0) return undefined
    const timer = window.setInterval(() => {
      setLoginLinkCooldown(value => Math.max(0, value - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [loginLinkCooldown])

  if (!supabaseConfig.isConfigured) return <MissingConfig />

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setMessage('')
    const normalizedEmail = email.trim()
    if (!normalizedEmail) {
      setError('请先输入邮箱。')
      return
    }
    if (password.length < 6) {
      setError('密码至少需要 6 位。')
      return
    }
    setLoading(true)
    try {
      if (mode === 'login') {
        const { error: authError } = await withAuthTimeout(() => supabase.auth.signInWithPassword({ email: normalizedEmail, password }))
        if (authError) throw authError
      } else {
        const { error: authError } = await withAuthTimeout(() => supabase.auth.signUp({ email: normalizedEmail, password, options: { emailRedirectTo: window.location.origin } }))
        if (authError) throw authError
        setMessage('注册成功！请检查邮箱验证链接，然后回来登录。')
        setMode('login')
      }
    } catch (authError) {
      setError(formatAuthErrorMessage(authError))
    } finally {
      setLoading(false)
    }
  }

  async function handleSendLoginLink() {
    const normalizedEmail = email.trim()
    setError('')
    setMessage('')
    if (!normalizedEmail) {
      setError('请先输入邮箱，再发送登录链接。')
      return
    }
    if (loginLinkCooldown > 0) return

    setLoginLinkLoading(true)
    try {
      const { error: authError } = await withAuthTimeout(() => supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: { emailRedirectTo: window.location.origin },
      }))
      if (authError) throw authError
      setMessage(`登录链接已发送到 ${normalizedEmail}，请去邮箱点击链接完成登录。`)
      setLoginLinkCooldown(60)
    } catch (authError) {
      setError(formatAuthErrorMessage(authError))
    } finally {
      setLoginLinkLoading(false)
    }
  }

  return (
    <div className="ft-auth-page">
      <div className="ft-auth-orbit ft-auth-orbit-one" />
      <div className="ft-auth-orbit ft-auth-orbit-two" />
      <main className="ft-auth-card">
        <div className="ft-auth-brand"><span className="ft-auth-mark"><Leaf size={24} strokeWidth={1.5} /></span><span className="ft-eyebrow">FOCUSTREE</span><h1>专注树</h1><p>把脑子里的事，长成一棵能走的树。</p></div>
        <div className="ft-auth-tabs"><button type="button" className={mode === 'login' ? 'is-active' : ''} onClick={() => switchMode('login', setMode, setError, setMessage, setLoginLinkCooldown)}>登录</button><button type="button" className={mode === 'signup' ? 'is-active' : ''} onClick={() => switchMode('signup', setMode, setError, setMessage, setLoginLinkCooldown)}>注册</button></div>
        <form className="ft-auth-form" onSubmit={handleSubmit}>
          <label><span>邮箱</span><div className="ft-auth-input"><Mail size={16} /><input type="email" value={email} onChange={event => setEmail(event.target.value)} required placeholder="you@example.com" /></div></label>
          <label><span>密码</span><div className="ft-auth-input"><LockKeyhole size={16} /><input type="password" value={password} onChange={event => setPassword(event.target.value)} required minLength={6} placeholder="至少 6 位" /></div>{mode === 'signup' ? <small className="ft-auth-field-hint">至少 6 位即可，先用一个你记得住的密码。</small> : null}</label>
          {error ? <div className="ft-auth-message is-error">{error}</div> : null}
          {message ? <div className="ft-auth-message is-success">{message}</div> : null}
          <button className="ft-auth-submit" type="submit" disabled={loading}>{loading ? '处理中…' : mode === 'login' ? '进入专注树' : '创建账户'}<ArrowRight size={16} /></button>
        </form>
        {mode === 'login' ? <section className="ft-auth-link-panel" aria-label="免密码登录">
          <div className="ft-auth-link-heading"><strong>不想记密码？</strong><span>邮箱登录链接</span></div>
          <p>发送一次性登录链接到上面的邮箱，打开邮件即可进入专注树。</p>
          <button type="button" className="ft-auth-link-button" onClick={handleSendLoginLink} disabled={loading || loginLinkLoading || loginLinkCooldown > 0}>
            {loginLinkLoading ? '发送中…' : loginLinkCooldown > 0 ? `${loginLinkCooldown} 秒后可重发` : '发送登录链接'}
          </button>
        </section> : null}
        <div className="ft-auth-demo-note"><span>演示提示</span><p>注册只需邮箱，收到验证邮件后点击一次链接，通常 30 秒完成；不用准备手机号。</p></div>
        <div className="ft-auth-note"><Sparkles size={14} />你的数据只属于你，目标和树都会保存在自己的账户里。</div>
      </main>
    </div>
  )
}

function MissingConfig() {
  return <div className="ft-auth-page"><main className="ft-config-card"><span className="ft-auth-mark"><Leaf size={24} strokeWidth={1.5} /></span><span className="ft-eyebrow">FOCUSTREE / SETUP</span><h1>先把这棵树接上土壤</h1><p>FocusTree 已经启动，但还不能登录和保存数据。配置本地环境变量后重启应用即可使用。</p><code>VITE_SUPABASE_URL{`\n`}VITE_SUPABASE_ANON_KEY{`\n`}SUPABASE_URL{`\n`}SUPABASE_SERVICE_ROLE_KEY{`\n`}DEEPSEEK_API_KEY 或 OPENAI_API_KEY</code></main></div>
}

function switchMode(next, setMode, setError, setMessage, setLoginLinkCooldown) {
  setMode(next)
  setError('')
  setMessage('')
  setLoginLinkCooldown(0)
}
