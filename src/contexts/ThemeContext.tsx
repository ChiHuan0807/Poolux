import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

type Theme = 'light' | 'dark'

interface ThemeContextType {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType>({ theme: 'light', toggleTheme: () => {} })

export function ThemeProvider({ children }: { children: ReactNode }) {
  // 站点整体背景固定为 #FFFFFF，不再跟随系统深色模式。
  // （之前会读 localStorage / prefers-color-scheme 自动切深色，但顶栏并没有暴露切换按钮，
  //  结果深色 OS 的访客会在内页看到深色背景，与「整体白色」不符。）
  // 深色变量仍保留在 index.css 的 [data-theme="dark"] 中，将来要恢复只需改回这里。
  const [theme, setTheme] = useState<Theme>('light')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light')
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)