'use client';

import { useState, useEffect } from 'react';
import { KeyRound, ShieldAlert, Check, AlertCircle, Loader2 } from 'lucide-react';
import { useTranslation } from '@/i18n/context';

export default function ProfileForm() {
  const { t, localizeError } = useTranslation();
  const [user, setUser] = useState<{ name: string; email: string; role: string } | null>(null);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    async function loadUser() {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          if (data.authenticated) {
            setUser(data.user);
          }
        }
      } catch (err) {
        console.error('Failed to load user info', err);
      }
    }
    loadUser();
  }, []);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: t('profile.passwordMismatch') });
      return;
    }

    if (newPassword.length < 6) {
      setMessage({ type: 'error', text: t('profile.passwordMinLength') });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword, newPassword })
      });

      const data = await res.json();
      if (res.ok) {
        setMessage({ type: 'success', text: t('profile.passwordSuccess') });
        setOldPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setMessage({ type: 'error', text: localizeError(data.error) || t('common.error') });
      }
    } catch (err) {
      setMessage({ type: 'error', text: t('auth.networkError') });
    } finally {
      setLoading(false);
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'ADMIN': return t('auth.adminRole');
      case 'SELLER': return t('auth.sellerRole');
      case 'MANAGER': return t('auth.sellerRole');
      default: return t('auth.customerRole');
    }
  };


  if (!user) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto space-y-6">
      {/* User Info card */}
      <div className="glass-panel rounded-2xl p-6 border border-white/5 space-y-4 animate-fade-in">
        <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
          <span>{t('profile.userInfo')}</span>
        </h3>
        <div className="space-y-2.5 text-xs text-slate-400">
          <div className="flex justify-between">
            <span className="font-semibold">{t('profile.name')}:</span>
            <span className="text-slate-200 font-bold">{user.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-semibold">{t('profile.email')}:</span>
            <span className="text-slate-200 font-bold">{user.email}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-semibold">{t('profile.role')}:</span>
            <span className="text-primary-focus font-bold">{getRoleLabel(user.role)}</span>
          </div>
        </div>
      </div>

      {/* Change Password Form */}
      <div className="glass-panel rounded-2xl p-6 border border-white/5 space-y-4">
        <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" />
          <span>{t('profile.changePassword')}</span>
        </h3>

        {message && (
          <div className={`flex items-center gap-3 rounded-xl border p-3.5 text-xs ${
            message.type === 'success' 
              ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400' 
              : 'border-red-500/25 bg-red-500/10 text-red-400'
          }`}>
            {message.type === 'success' ? <Check className="h-4.5 w-4.5 flex-shrink-0" /> : <AlertCircle className="h-4.5 w-4.5 flex-shrink-0" />}
            <span>{message.text}</span>
          </div>
        )}

        <form onSubmit={handleChangePassword} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] text-slate-400 font-bold uppercase">{t('profile.oldPassword')}</label>
            <input
              type="password"
              className="w-full rounded-xl px-4 py-2.5 text-xs glass-input"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] text-slate-400 font-bold uppercase">{t('profile.newPassword')}</label>
            <input
              type="password"
              className="w-full rounded-xl px-4 py-2.5 text-xs glass-input"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] text-slate-400 font-bold uppercase">{t('profile.confirmPassword')}</label>
            <input
              type="password"
              className="w-full rounded-xl px-4 py-2.5 text-xs glass-input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full btn-primary py-2.5 text-xs flex items-center justify-center gap-2"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <KeyRound className="h-4 w-4" />
            )}
            <span>{t('profile.saveChanges')}</span>
          </button>
        </form>
      </div>
    </div>

  );
}
