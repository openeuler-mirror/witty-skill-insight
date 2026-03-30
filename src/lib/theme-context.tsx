'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextType {
    theme: Theme;
    toggleTheme: () => void;
    isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [theme, setTheme] = useState<Theme>('light');
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        const savedTheme = localStorage.getItem('skill-insight-theme') as Theme;
        if (savedTheme) {
            setTheme(savedTheme);
        }
    }, []);

    useEffect(() => {
        if (mounted) {
            localStorage.setItem('skill-insight-theme', theme);
            document.documentElement.setAttribute('data-theme', theme);
        }
    }, [theme, mounted]);

    const toggleTheme = () => {
        setTheme(prev => prev === 'light' ? 'dark' : 'light');
    };

    if (!mounted) {
        return null;
    }

    return (
        <ThemeContext.Provider value={{ theme, toggleTheme, isDark: theme === 'dark' }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}

export const themes = {
    light: {
        background: '#ffffff',
        backgroundSecondary: '#f8fafc',
        foreground: '#1e293b',
        foregroundSecondary: '#64748b',
        foregroundMuted: '#94a3b8',
        cardBg: 'rgba(255, 255, 255, 0.9)',
        cardBorder: 'rgba(148, 163, 184, 0.25)',
        primary: '#2563eb',
        primaryHover: '#1d4ed8',
        secondary: '#7c3aed',
        accent: '#db2777',
        success: '#16a34a',
        warning: '#d97706',
        error: '#dc2626',
        border: '#e2e8f0',
        borderDark: '#cbd5e1',
        inputBg: '#ffffff',
        inputBorder: '#cbd5e1',
        codeBlockBg: '#f8fafc',
        tableBorder: '#e2e8f0',
        tableRowBorder: '#f1f5f9',
        dropdownBg: '#ffffff',
        dropdownBorder: '#e2e8f0',
        shadowColor: 'rgba(0, 0, 0, 0.1)',
    },
    dark: {
        background: '#0f172a',
        backgroundSecondary: '#1e293b',
        foreground: '#f8fafc',
        foregroundSecondary: '#94a3b8',
        foregroundMuted: '#64748b',
        cardBg: 'rgba(30, 41, 59, 0.7)',
        cardBorder: 'rgba(148, 163, 184, 0.1)',
        primary: '#38bdf8',
        primaryHover: '#7dd3fc',
        secondary: '#818cf8',
        accent: '#f472b6',
        success: '#4ade80',
        warning: '#fbbf24',
        error: '#f87171',
        border: '#334155',
        borderDark: '#475569',
        inputBg: '#0f172a',
        inputBorder: '#334155',
        codeBlockBg: '#1e293b',
        tableBorder: '#334155',
        tableRowBorder: '#1e293b',
        dropdownBg: '#1e293b',
        dropdownBorder: '#334155',
        shadowColor: 'rgba(0, 0, 0, 0.5)',
    }
};

export function getThemeColors(theme: Theme) {
    return themes[theme];
}
