'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';

interface AuthContextType {
  user: string | null;
  apiKey: string | null;
  login: (username: string, apiKey?: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Check localStorage on mount
    const storedUser = localStorage.getItem('user_id');
    const storedApiKey = localStorage.getItem('api_key');
    if (storedUser) {
      setUser(storedUser);
      if (storedApiKey) setApiKey(storedApiKey);
    } else {
        // If not logged in and not on login page, redirect
        if (pathname !== '/login') {
            router.push('/login');
        }
    }
  }, [pathname, router]);

  const login = (username: string, key?: string) => {
    localStorage.setItem('user_id', username);
    setUser(username);
    if (key) {
        localStorage.setItem('api_key', key);
        setApiKey(key);
    }
    router.push('/');
  };

  const logout = () => {
    localStorage.removeItem('user_id');
    localStorage.removeItem('api_key');
    setUser(null);
    setApiKey(null);
    router.push('/login');
  };

  return (
    <AuthContext.Provider value={{ user, apiKey, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
