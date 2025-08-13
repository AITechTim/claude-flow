/**
 * useTheme - Hook for managing dark/light theme
 */

import { useState, useEffect, useCallback } from 'react';

type Theme = 'light' | 'dark';

export function useTheme() {
  // Initialize theme from localStorage or system preference
  const [theme, setTheme] = useState<Theme>(() => {
    // Check localStorage first
    const savedTheme = localStorage.getItem('theme') as Theme | null;
    if (savedTheme) {
      return savedTheme;
    }

    // Fall back to system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }

    return 'light';
  });

  // Update theme and persist to localStorage
  const setThemeAndPersist = useCallback((newTheme: Theme) => {
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    
    // Update document class for CSS styling
    document.documentElement.className = newTheme;
    
    // Update meta theme-color for mobile browsers
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', newTheme === 'dark' ? '#1a1a1a' : '#ffffff');
    }
  }, []);

  // Toggle between themes
  const toggleTheme = useCallback(() => {
    setThemeAndPersist(theme === 'light' ? 'dark' : 'light');
  }, [theme, setThemeAndPersist]);

  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    const handleChange = (e: MediaQueryListEvent) => {
      // Only auto-switch if no theme is explicitly set
      const savedTheme = localStorage.getItem('theme');
      if (!savedTheme) {
        setThemeAndPersist(e.matches ? 'dark' : 'light');
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [setThemeAndPersist]);

  // Apply theme to document on mount and theme changes
  useEffect(() => {
    document.documentElement.className = theme;
    
    // Update meta theme-color for mobile browsers
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', theme === 'dark' ? '#1a1a1a' : '#ffffff');
    }
  }, [theme]);

  return {
    theme,
    setTheme: setThemeAndPersist,
    toggleTheme,
    isDark: theme === 'dark'
  };
}