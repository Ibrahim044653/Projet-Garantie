'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from 'react';
import { useRouter } from 'next/navigation';
import type { User, UserRole } from '@/types';
import { authApi } from '@/lib/api';

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasRole: (...roles: UserRole[]) => boolean;
  canEdit: () => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  const loadUser = useCallback(async () => {
    try {
      if (typeof window === 'undefined') {
        setIsLoading(false);
        return;
      }
      const hasToken = !!sessionStorage.getItem('token');
      const cached = localStorage.getItem('user');

      // Sans token ni cache, l'utilisateur n'est pas connecté
      if (!hasToken && !cached) {
        setIsLoading(false);
        return;
      }

      // Restaurer le cache immédiatement pour une UX instantanée
      if (cached) {
        try { setUser(JSON.parse(cached)); } catch { /* ignore */ }
      }
      setIsLoading(false);

      // Valider la session côté serveur
      authApi.me()
        .then((res) => {
          const fresh = res.data.user ?? res.data;
          setUser(fresh);
          localStorage.setItem('user', JSON.stringify(fresh));
        })
        .catch((err) => {
          if (err?.response?.status === 401) {
            setUser(null);
            localStorage.removeItem('user');
            sessionStorage.removeItem('token');
          }
          // Conserver le cache si erreur réseau (backend temporairement inaccessible)
        });
    } catch {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  // Handle 401 events dispatched by the API interceptor
  // (avoids hard window.location redirect which aborts page load mid-hydration)
  useEffect(() => {
    const handle = () => {
      setUser(null);
      router.replace('/login');
    };
    window.addEventListener('sgh:unauthorized', handle);
    return () => window.removeEventListener('sgh:unauthorized', handle);
  }, [router]);

  const login = async (email: string, password: string) => {
    const res = await authApi.login(email, password);
    const { token, user: loggedUser } = res.data;
    if (loggedUser) {
      if (token) sessionStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(loggedUser));
      setUser(loggedUser);
      router.push('/dashboard');
    }
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } catch {
      // ignore
    } finally {
      sessionStorage.removeItem('token');
      localStorage.removeItem('user');
      setUser(null);
      router.push('/login');
    }
  };

  const hasRole = (...roles: UserRole[]) =>
    user !== null && roles.includes(user.role);

  // RESPONSABLE_RISQUES can view but not edit
  const canEdit = () =>
    user !== null && user.role !== 'RESPONSABLE_RISQUES';

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: user !== null,
        login,
        logout,
        hasRole,
        canEdit,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
