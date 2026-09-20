// 部署 zip 的读取与校验工具（package-api / package-web 共用）。
//
// 为什么统一用 tar 生成 zip：PowerShell 的 Compress-Archive 写出的条目分隔符是 '\'，
// 上传到 Linux 宝塔解压会得到一堆带反斜杠的怪文件名。Windows 10+ 自带 bsdtar，
// 它的条目分隔符是 '/'，解压正常。
import { readFileSync } from 'fs'

/** 读取 zip 中央目录里的条目名（够用即可，不依赖第三方库） */
export function listZipNames(file) {
  const buf = readFileSync(file)
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 65558; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('不是有效的 zip 文件')
  const count = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  const names = []
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break
    const len = buf.readUInt16LE(off + 28)
    const extra = buf.readUInt16LE(off + 30)
    const comment = buf.readUInt16LE(off + 32)
    names.push(buf.toString('utf8', off + 46, off + 46 + len))
    off += 46 + len + extra + comment
  }
  return names
}

/** 条目名里出现 '\' 说明包是用 Compress-Archive 打的，Linux 解压必然出错，必须拦下 */
export function findBackslashEntries(names) {
  return names.filter((n) => n.includes('\\'))
}

/**
 * 校验 zip 的顶层内容：出现不该上传的东西（数据库 / 上传目录 / 密钥 / 后端目录）就抛错。
 * 只比顶层名字，不递归 —— 上传包里这些目录一旦存在就说明打错包了。
 */
export function assertNoForbidden(names, forbidden, label) {
  const bad = names.filter((n) => {
    const top = n.replace(/^\.\//, '').split('/')[0]
    return forbidden.includes(top)
  })
  if (bad.length > 0) {
    throw new Error(`[${label}] 压缩包里混入了不该上传的内容，已中止：\n  ${[...new Set(bad)].join('\n  ')}`)
  }
}
