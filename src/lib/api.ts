// API 基础地址，生产环境改为你的后端域名
export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001'

async function parseJsonResponse(res: Response) {
  const text = await res.text()
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    // 常见于 API 未启动 / 路由未部署：服务器回退返回 index.html
    throw new Error(
      res.ok
        ? `接口返回了非 JSON 响应（${res.status}）。请确认后端已启动并包含该路由：${res.url}`
        : `请求失败（${res.status}）：接口可能未部署或路径错误`,
    )
  }
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`接口返回了无效 JSON（${res.status}）`)
  }
}

export async function apiFetch(path: string, options: RequestInit = {}) {
  const { headers: userHeaders, body, ...rest } = options
  // 当 body 是 FormData 时不设置 Content-Type，让浏览器自动带 multipart boundary
  const baseHeaders: Record<string, string> = body instanceof FormData
    ? {}
    : { 'Content-Type': 'application/json' }
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    body,
    credentials: 'include',
    headers: { ...baseHeaders, ...userHeaders as any },
  })
  const data = await parseJsonResponse(res)
  if (!res.ok) throw new Error(data.error || '请求失败')
  return data
}

// 通用上传：支持指定任意 upload 端点
export async function apiUploadTo(endpoint: string, file: File) {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  })
  const data = await parseJsonResponse(res)
  if (!res.ok) throw new Error(data.error || '上传失败')
  return data
}

// 兼容旧调用：resources upload
export async function apiUpload(file: File) {
  return apiUploadTo('/api/resources/upload', file)
}