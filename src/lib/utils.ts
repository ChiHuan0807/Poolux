import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** 将用户输入的链接规范为可跳转的外链，避免被当成站内相对路径 */
export function toExternalUrl(raw: string): string {
  const value = (raw || '').trim()
  if (!value) return value
  // 站内锚点 / 相对路径保留原样
  if (value.startsWith('#') || value.startsWith('/')) return value
  // 已有协议（http/https/mailto 等）
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(value)) return value
  // 缺协议的域名：补 https://
  return `https://${value}`
}
