/// <reference types="vite/client" />

declare module 'https://unpkg.com/@waline/client@v3/dist/waline.js' {
  interface WalineInstance {
    destroy: () => void
  }
  interface WalineOptions {
    el: string | HTMLElement
    serverURL: string
    dark?: string | boolean
    login?: 'enable' | 'disable' | 'force'
    lang?: string
    locale?: Record<string, string>
    [key: string]: unknown
  }
  export function init(options: WalineOptions): WalineInstance
}
