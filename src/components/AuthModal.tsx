'use client';

import React, { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabase';
import { X, LogIn, UserPlus, LogOut, CheckCircle2, AlertCircle, Sparkles } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const { user, profile, configured, signIn, signUp, signOut } = useAuth();
  const [tab, setTab] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setLoading(true);

    try {
      if (tab === 'signup') {
        if (!displayName.trim()) {
          setErrorMsg('Please enter a display name');
          setLoading(false);
          return;
        }
        const res = await signUp(email, password, displayName);
        if (res.error) {
          setErrorMsg(res.error);
        } else if (res.message) {
          setSuccessMsg(res.message);
        } else {
          setSuccessMsg('Account created successfully!');
          setTimeout(() => onClose(), 1200);
        }
      } else {
        const res = await signIn(email, password);
        if (res.error) {
          setErrorMsg(res.error);
        } else {
          onClose();
        }
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    setLoading(true);
    await signOut();
    setLoading(false);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog auth-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <Sparkles size={18} className="modal-sparkle" />
            <span>{user ? 'Account & Profile' : configured ? 'Sign in to Canvas' : 'Supabase Setup'}</span>
          </div>
          <button className="icon-btn-ghost" onClick={onClose} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {user ? (
            /* User Profile & Sign Out */
            <div className="profile-view">
              <div className="profile-card">
                <div className="profile-avatar-large">
                  {profile?.avatar_url ? (
                    <img src={profile.avatar_url} alt={profile.display_name} />
                  ) : (
                    <span>{(profile?.display_name || user.email || 'U')[0].toUpperCase()}</span>
                  )}
                </div>
                <div className="profile-details">
                  <h4>{profile?.display_name || 'Anonymous User'}</h4>
                  <p>{user.email}</p>
                  <span className="profile-badge">Collaborator</span>
                </div>
              </div>

              <div className="profile-meta">
                <div className="meta-item">
                  <span className="meta-label">Status</span>
                  <span className="meta-value online">Cloud Active</span>
                </div>
                <div className="meta-item">
                  <span className="meta-label">User ID</span>
                  <span className="meta-value code">{user.id.slice(0, 12)}…</span>
                </div>
              </div>

              <button
                className="btn-danger w-full"
                onClick={handleSignOut}
                disabled={loading}
              >
                <LogOut size={16} /> Sign out
              </button>
            </div>
          ) : !configured ? (
            /* Supabase Not Configured Guide */
            <div className="unconfigured-guide">
              <div className="info-banner">
                <AlertCircle size={20} className="text-amber" />
                <div>
                  <strong>Local Canvas Active</strong>
                  <p>
                    Canvas is currently running in resilient local mode with <code>localStorage</code> and tab-to-tab <code>BroadcastChannel</code> synchronization.
                  </p>
                </div>
              </div>

              <div className="setup-steps">
                <h5>To enable multi-user cloud collaboration:</h5>
                <ol>
                  <li>
                    Create a free project at{' '}
                    <a href="https://supabase.com" target="_blank" rel="noreferrer">
                      supabase.com
                    </a>
                  </li>
                  <li>
                    Add your credentials to <code>.env.local</code>:
                    <pre>
{`NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key`}
                    </pre>
                  </li>
                  <li>
                    Run <code>sql/migration.sql</code> in the Supabase SQL Editor.
                  </li>
                </ol>
              </div>

              <button className="btn-secondary w-full" onClick={onClose}>
                Continue in Local Mode
              </button>
            </div>
          ) : (
            /* Sign In / Sign Up Form */
            <form onSubmit={handleSubmit} className="auth-form">
              <div className="auth-tabs">
                <button
                  type="button"
                  className={`tab-btn ${tab === 'signin' ? 'active' : ''}`}
                  onClick={() => { setTab('signin'); setErrorMsg(null); }}
                >
                  <LogIn size={15} /> Sign In
                </button>
                <button
                  type="button"
                  className={`tab-btn ${tab === 'signup' ? 'active' : ''}`}
                  onClick={() => { setTab('signup'); setErrorMsg(null); }}
                >
                  <UserPlus size={15} /> Sign Up
                </button>
              </div>

              {errorMsg && (
                <div className="auth-alert error">
                  <AlertCircle size={16} />
                  <span>{errorMsg}</span>
                </div>
              )}

              {successMsg && (
                <div className="auth-alert success">
                  <CheckCircle2 size={16} />
                  <span>{successMsg}</span>
                </div>
              )}

              {tab === 'signup' && (
                <div className="form-group">
                  <label htmlFor="display_name">Display name</label>
                  <input
                    id="display_name"
                    type="text"
                    required
                    placeholder="e.g. Maya Lin"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </div>
              )}

              <div className="form-group">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  required
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  required
                  minLength={6}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <button type="submit" className="btn-primary w-full" disabled={loading}>
                {loading ? 'Please wait…' : tab === 'signin' ? 'Sign In' : 'Create Account'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
