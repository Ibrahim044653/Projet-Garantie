'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { authApi, mfaApi } from '@/lib/api';
import { Landmark, Eye, EyeOff, AlertCircle, ShieldCheck } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // MFA step state
  const [mfaStep, setMfaStep] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);
  const [mfaCode, setMfaCode] = useState('');

  const { isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isAuthenticated) router.push('/dashboard');
  }, [isAuthenticated, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email || !password) {
      setError('Veuillez remplir tous les champs.');
      return;
    }
    setLoading(true);
    try {
      const res = await authApi.login(email, password);
      const data = res.data;

      if (data.mfaRequired === true) {
        // Backend requires MFA — switch to MFA step
        setUserId(data.userId);
        setMfaStep(true);
      } else {
        // Normal login — store token + user and navigate
        sessionStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        router.push('/dashboard');
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'Identifiants incorrects. Veuillez réessayer.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!mfaCode || mfaCode.length !== 6) {
      setError('Veuillez saisir un code à 6 chiffres.');
      return;
    }
    setLoading(true);
    try {
      const res = await mfaApi.validate(userId!, mfaCode);
      const data = res.data;
      sessionStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      router.push('/dashboard');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'Code incorrect ou expiré. Veuillez réessayer.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-900 via-blue-800 to-slate-900 p-4">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full bg-blue-500/20 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-violet-500/20 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo / header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-500/20 border border-blue-400/30 backdrop-blur-sm mb-4">
            <Landmark className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">
            SIGGHY
          </h1>
          <p className="text-blue-200 text-sm mt-1">
            Application Bancaire Interne — Circulaire 04-2017
          </p>
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-8">
          {!mfaStep ? (
            <>
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-slate-800 dark:text-white">Connexion</h2>
                <p className="text-slate-500 dark:text-slate-400 text-sm">
                  Accédez à votre espace de gestion
                </p>
              </div>

              {error && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-5 text-sm text-red-600">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="email" className="form-label">
                    Adresse email
                  </label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="prenom.nom@banque.com"
                    className="form-input"
                    disabled={loading}
                  />
                </div>

                <div>
                  <label htmlFor="password" className="form-label">
                    Mot de passe
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPwd ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="form-input pr-10"
                      disabled={loading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      tabIndex={-1}
                    >
                      {showPwd ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 px-4 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-400 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Connexion en cours...
                    </>
                  ) : (
                    'Se connecter'
                  )}
                </button>
              </form>
            </>
          ) : (
            <>
              <div className="mb-6">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center">
                    <ShieldCheck className="w-5 h-5 text-blue-600" />
                  </div>
                  <h2 className="text-xl font-semibold text-slate-800 dark:text-white">
                    Vérification MFA
                  </h2>
                </div>
                <p className="text-slate-500 dark:text-slate-400 text-sm">
                  Saisissez le code à 6 chiffres de votre application d&apos;authentification.
                </p>
              </div>

              {error && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-5 text-sm text-red-600">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleMfaSubmit} className="space-y-5">
                <div>
                  <label htmlFor="mfaCode" className="form-label">
                    Code TOTP
                  </label>
                  <input
                    id="mfaCode"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="123456"
                    className="form-input tracking-widest text-center text-xl font-mono"
                    disabled={loading}
                    autoFocus
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 px-4 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-400 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Vérification...
                    </>
                  ) : (
                    'Valider'
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => { setMfaStep(false); setMfaCode(''); setError(''); }}
                  className="w-full text-sm text-slate-500 hover:text-slate-700 text-center"
                >
                  ← Retour à la connexion
                </button>
              </form>
            </>
          )}

          <p className="text-center text-xs text-slate-400 dark:text-slate-500 mt-6">
            En vous connectant, vous acceptez les conditions d&apos;utilisation de la
            plateforme bancaire.
          </p>
        </div>

        <p className="text-center text-blue-300 text-xs mt-6">
          © {new Date().getFullYear()} — Tous droits réservés
        </p>
      </div>
    </div>
  );
}
