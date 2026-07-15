/** 是否为离线 APK 构建 */
export const IS_OFFLINE = import.meta.env.VITE_OFFLINE === 'true'

/** 离线资源根路径（相对 base，适配 file/capacitor） */
export function offlineAsset(path: string) {
  const clean = path.replace(/^\.?\//, '')
  return `./offline/${clean}`
}