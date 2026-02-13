'use client';

import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); // Clear previous error
    
    if (!username.trim()) {
      setError('请输入邮箱地址');
      return;
    }
    
    try {
        const res = await fetch('/api/auth/apikey', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username.trim() })
        });
        
        const data = await res.json();
        
        if (res.ok) {
            login(data.username, data.apiKey);
            router.push('/');
        } else {
            // Show error from API
            setError(data.error || '登录失败，请重试');
        }
    } catch (err) {
        console.error(err);
        setError('网络错误，请检查连接');
    }
  };

  return (
    <div className="login-container">
      <div className="login-box">
        {/* Logo Section */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1.5rem', marginBottom: '2.5rem' }}>
             <div style={{
                background: 'linear-gradient(135deg, #38bdf8, #818cf8)',
                color: 'white',
                fontWeight: 'bold',
                fontSize: '1.8rem',
                padding: '0.8rem 1.2rem',
                borderRadius: '0.75rem',
                whiteSpace: 'nowrap',
                boxShadow: '0 10px 15px -3px rgba(56, 189, 248, 0.4), 0 4px 6px -2px rgba(56, 189, 248, 0.2)'
            }}>
                Witty-Skill
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
                <h1 style={{ fontSize: '3rem', fontWeight: '800', color: '#f8fafc', margin: 0, lineHeight: 1, letterSpacing: '-0.02em', textShadow: '0 2px 4px rgba(0,0,0,0.3)' }}>Insight</h1>
                <span style={{ fontSize: '1rem', color: '#94a3b8', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: '0.25rem' }}>智能体技能评估、分析与优化</span>
            </div>
        </div>

        <form className="login-form">
          <div style={{ marginBottom: '1rem' }}>
            <label className="login-label" htmlFor="username">
              邮箱地址
            </label>
            <input
              className="login-input"
              id="username"
              type="email"
              placeholder="your.email@example.com"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setError(''); }}
              style={error ? { borderColor: '#ef4444' } : {}}
            />
            {/* Error Message */}
            {error && (
              <div style={{
                color: '#ef4444',
                fontSize: '0.875rem',
                marginTop: '0.5rem',
                padding: '0.5rem 0.75rem',
                background: 'rgba(239, 68, 68, 0.1)',
                borderRadius: '0.375rem',
                border: '1px solid rgba(239, 68, 68, 0.3)'
              }}>
                ⚠️ {error}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <button
              className="login-btn"
              type="button"
              onClick={handleLogin}
            >
              Sign In
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
