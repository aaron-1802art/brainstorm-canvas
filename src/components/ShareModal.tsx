'use client';

import React, { useState } from 'react';
import { useAuth } from '@/lib/auth';
import type { BoardMember, BoardRole } from '@/lib/types';
import { X, Copy, Check, UserPlus, Shield, User, Trash2, Link as LinkIcon } from 'lucide-react';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  boardId: string;
  boardTitle: string;
  userRole: BoardRole;
  members: BoardMember[];
  onInvite: (email: string, role: BoardRole) => Promise<string | null>;
  onRemoveMember?: (memberId: string) => Promise<void>;
  onUpdateRole?: (memberId: string, role: BoardRole) => Promise<void>;
}

export function ShareModal({
  isOpen,
  onClose,
  boardId,
  boardTitle,
  userRole,
  members,
  onInvite,
  onRemoveMember,
  onUpdateRole,
}: ShareModalProps) {
  const { user, configured } = useAuth();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<BoardRole>('editor');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const isOwner = userRole === 'owner';
  const canManage = isOwner || userRole === 'editor';

  const shareUrl = typeof window !== 'undefined'
    ? `${window.location.origin}${window.location.pathname}?board=${boardId}`
    : `https://canvas.app?board=${boardId}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    setErrorMsg(null);
    setSuccessMsg(null);
    setLoading(true);

    try {
      const err = await onInvite(inviteEmail.trim(), inviteRole);
      if (err) {
        setErrorMsg(err);
      } else {
        setSuccessMsg(`Invitation sent to ${inviteEmail}`);
        setInviteEmail('');
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to send invitation');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog share-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <Shield size={18} />
            <span>Share &ldquo;{boardTitle}&rdquo;</span>
          </div>
          <button className="icon-btn-ghost" onClick={onClose} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {/* Shareable Link Box */}
          <div className="share-link-section">
            <label>Shareable Link</label>
            <div className="share-link-input-group">
              <input type="text" readOnly value={shareUrl} className="share-link-input" />
              <button
                type="button"
                className={`btn-copy ${copied ? 'copied' : ''}`}
                onClick={handleCopyLink}
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <p className="share-link-hint">
              Collaborators with this link can join your brainstorming canvas in real time.
            </p>
          </div>

          {/* Invite Collaborator (for owners/editors) */}
          {configured && user && canManage && (
            <div className="invite-section">
              <label>Invite by Email</label>
              <form onSubmit={handleInviteSubmit} className="invite-form">
                <input
                  type="email"
                  required
                  placeholder="colleague@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="invite-input"
                />
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as BoardRole)}
                  className="role-select"
                >
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button type="submit" className="btn-primary" disabled={loading}>
                  <UserPlus size={15} /> Invite
                </button>
              </form>

              {errorMsg && <div className="auth-alert error mt-2">{errorMsg}</div>}
              {successMsg && <div className="auth-alert success mt-2">{successMsg}</div>}
            </div>
          )}

          {/* Board Members List */}
          <div className="members-section">
            <label>Board Members ({members.length || 1})</label>
            <div className="members-list">
              {members.length > 0 ? (
                members.map((m) => (
                  <div key={m.id} className="member-row">
                    <div className="member-info">
                      <div className="member-avatar">
                        <User size={14} />
                      </div>
                      <div>
                        <div className="member-name">{m.profile?.display_name || m.profile?.email || 'Collaborator'}</div>
                        <div className="member-role-label">{m.role}</div>
                      </div>
                    </div>

                    <div className="member-actions">
                      {isOwner && m.user_id !== user?.id && onUpdateRole && (
                        <select
                          value={m.role}
                          onChange={(e) => onUpdateRole(m.id, e.target.value as BoardRole)}
                          className="role-select-sm"
                        >
                          <option value="editor">Editor</option>
                          <option value="viewer">Viewer</option>
                        </select>
                      )}
                      {isOwner && m.user_id !== user?.id && onRemoveMember && (
                        <button
                          className="icon-btn-danger"
                          title="Remove member"
                          onClick={() => onRemoveMember(m.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="member-row">
                  <div className="member-info">
                    <div className="member-avatar">
                      <User size={14} />
                    </div>
                    <div>
                      <div className="member-name">{user?.email || 'You (Active Session)'}</div>
                      <div className="member-role-label">{userRole}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
