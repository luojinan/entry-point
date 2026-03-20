# Cloudflare Workers SSR 搜索项目 - 实现方案

## 背景

pansou 项目现有 83 个 Node.js 搜索插件（`pluginsNodejs/`），每个插件继承 `BasePlugin`，通过 `search(keyword, ext)` 返回搜索结果。目标是将这些插件运行在 Cloudflare Workers 上，构建一个 SSR + API 的搜索服务。

---

## 项目结构

```
pansou-workers/
├── wrangler.toml              # Workers 配置
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts               # Worker 入口（fetch handler）
│   ├── router.ts              # 路由分发
│   ├── types.ts               # 类型定义
│   ├── plugins/
│   │   ├── base.ts            # BasePlugin 适配 Workers (Web Crypto)
│   │   ├── search-all.ts      # 聚合搜索（带超时预算）
│   │   ├── registry.ts        # 插件注册表（懒加载）
│   │   └── plugins/           # 83 个插件（CJS → ESM 转换）
│   │       ├── duoduo.ts
│   │       ├── pansearch.ts
│   │       ├── hunhepan.ts
│   │       └── ...
│   ├── api/
│   │   ├── search.ts          # /api/search 接口
│   │   ├── health.ts          # /api/health
│   │   └── plugins.ts         # /api/plugins（插件列表）
│   ├── ssr/
│   │   ├── layout.ts          # HTML 外壳模板
│   │   ├── home.ts            # 首页（搜索框）
│   │   └── results.ts         # 搜索结果页（SSR）
│   └── middleware/
│       ├── cors.ts            # CORS 头
│       ├── cache.ts           # 缓存中间件
│       └── rate-limit.ts      # 限流
```

---

## 1. wrangler.toml 配置

```toml
name = "pansou-workers"
main = "src/index.ts"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]  # 关键：启用 Node.js 兼容层

[[kv_namespaces]]
binding = "SEARCH_CACHE"
id = "<your-kv-id>"

[vars]
MAX_PLUGINS = "30"
DEFAULT_TIMEOUT = "15000"
```

> `nodejs_compat` 使 `Buffer`、`crypto.createHash` 等 Node.js API 在 Workers 中可用，cheerio 也能正常工作。

---

## 2. 类型定义 (types.ts)

```typescript
interface SearchResult {
  uniqueId: string
  title: string
  content: string
  links: Array<{ type: string; url: string; password?: string }>
  datetime: string
  tags: string[]
  channel: string
}

interface Env {
  SEARCH_CACHE: KVNamespace
  MAX_PLUGINS?: string
  DEFAULT_TIMEOUT?: string
}

type CloudType =
  | 'quark' | 'uc' | 'baidu' | 'aliyun' | 'xunlei'
  | 'tianyi' | '115' | '123' | 'pikpak' | 'mobile'
  | 'weiyun' | 'lanzou' | 'jianguoyun' | 'magnet' | 'ed2k'
  | 'others'
```

---

## 3. BasePlugin 适配 (plugins/base.ts)

关键改动：`node:crypto` → Web Crypto API，`require` → `import`

```typescript
// MD5：node:crypto → Web Crypto
async function md5(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hash = await crypto.subtle.digest('MD5', data)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0')).join('')
}

// generateUniqueID 变为 async（因 Web Crypto digest 是异步的）
async function generateUniqueID(pluginName: string, ...parts: string[]): Promise<string> {
  const hash = await md5(parts.join('|'))
  return `${pluginName}-${hash.slice(0, 16)}`
}

// AES-128-CBC 解密（miaoso、sdso 插件使用）
async function aes128CbcDecrypt(ciphertextBase64: string, keyStr: string, ivStr: string): Promise<string> {
  const keyData = new TextEncoder().encode(keyStr)
  const iv = new TextEncoder().encode(ivStr)
  const ciphertext = base64ToUint8Array(ciphertextBase64)
  const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'AES-CBC' }, false, ['decrypt'])
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, cryptoKey, ciphertext)
  return new TextDecoder().decode(decrypted)
}

// fetch 系列无需改动，Workers 原生支持 fetch
function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 10000): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  return fetch(url, { ...options, signal: ctrl.signal })
    .finally(() => clearTimeout(timer))
}

function fetchWithRetry(url: string, options: RequestInit, { timeout = 10000, retries = 2 } = {}) {
  // 指数退避重试，逻辑与原版 base.js 完全相同
  for (let i = 0; i <= retries; i++) {
    try { return fetchWithTimeout(url, options, timeout) }
    catch (err) { if (i === retries) throw err }
    await sleep(2 ** i * 200)
  }
}

// 以下函数为纯 JS 字符串操作，无需任何改动直接搬过来：
// - getRandomUA()         随机 User-Agent
// - filterByKeyword()     关键词过滤
// - deduplicateResults()  去重
// - cleanHTML()           去 HTML 标签
// - determineCloudType()  从 URL 判断网盘类型
// - extractPassword()     提取密码
// - convertDiskType()     diskType 映射

abstract class BasePlugin {
  name: string
  priority: number
  constructor(name: string, priority = 3)
  abstract search(keyword: string, ext?: object): Promise<SearchResult[]>
}
```

---

## 4.特殊处理的插件

| 插件 | 问题 | 方案 |
|------|------|------|
| `qqpd.js` | 使用 `fs`/`path` 读写文件 | 改用 Workers KV 存取 |
| `miaoso.js` / `sdso.js` | `crypto.createDecipheriv` AES | `nodejs_compat` 或 Web Crypto |
| `pansearch.js` | 模块作用域 `buildIdCache` | 保留（隔离区内存），或改用 KV |

---

## 5. 插件注册表 (plugins/registry.ts)

```typescript
import { Duoduo } from './plugins/duoduo'
import { Pansearch } from './plugins/pansearch'
import { Hunhepan } from './plugins/hunhepan'
// ... 83 个 import

const ENTRIES = [
  { name: 'duoduo',    priority: 2, factory: () => new Duoduo() },
  { name: 'pansearch', priority: 3, factory: () => new Pansearch() },
  { name: 'hunhepan',  priority: 3, factory: () => new Hunhepan() },
  // ... 全部插件
]

// 懒加载缓存：首次调用时才实例化，同一隔离区内复用
const cache = new Map<string, BasePlugin>()

function getPlugin(name: string): BasePlugin | null {
  if (cache.has(name)) return cache.get(name)!
  const entry = ENTRIES.find(e => e.name === name)
  if (!entry) return null
  const inst = entry.factory()
  cache.set(name, inst)
  return inst
}

function getAllPlugins(): BasePlugin[] {
  return ENTRIES.map(e => getPlugin(e.name)!)
}

function getPluginsByNames(names: string[]): BasePlugin[] {
  return names.map(n => getPlugin(n)).filter(Boolean) as BasePlugin[]
}

function getPluginList(): Array<{ name: string; priority: number }> {
  return ENTRIES.map(e => ({ name: e.name, priority: e.priority }))
}
```

---

## 6. 聚合搜索 (plugins/search-all.ts)

Workers 有 **30 秒墙钟限制**，不能无限制并行所有插件。采用「两阶段优先级执行 + 超时预算」：

```typescript
async function searchAll(keyword: string, plugins: BasePlugin[], options = {}) {
  const { timeout = 15000, maxPlugins = 30 } = options

  // 按优先级排序，取前 N 个
  const selected = [...plugins]
    .sort((a, b) => a.priority - b.priority)
    .slice(0, maxPlugins)

  // 阶段一：高优先级插件（priority 1-2）先跑
  const high = selected.filter(p => p.priority <= 2)
  const low  = selected.filter(p => p.priority > 2)

  const startTime = Date.now()
  const highResults = await runBatch(high, keyword, timeout)

  // 阶段二：低优先级插件 —— 仅在剩余时间充足时执行
  const remaining = 25000 - (Date.now() - startTime)  // 预留 5 秒给响应组装
  let lowResults: SearchResult[] = []
  if (remaining > 3000) {
    lowResults = await runBatch(low, keyword, Math.min(timeout, remaining - 1000))
  }

  return deduplicateResults([...highResults, ...lowResults])
}

async function runBatch(plugins: BasePlugin[], keyword: string, timeout: number) {
  const tasks = plugins.map(p =>
    Promise.race([
      p.search(keyword).catch(() => []),     // 单个插件错误不影响整体
      sleep(timeout).then(() => [])           // 超时返回空数组
    ])
  )
  const settled = await Promise.allSettled(tasks)
  return settled
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => (r as PromiseFulfilledResult<SearchResult[]>).value)
    .filter(r => r.links?.length > 0)          // 只保留有链接的结果
}
```

---

## 7. Worker 入口与路由 (index.ts / router.ts)

```typescript
// src/index.ts
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    try {
      // CORS 预检
      if (request.method === 'OPTIONS') return handleCORS()

      // ---- API 路由 ----
      if (path === '/api/search')   return withCors(await handleSearch(request, env, ctx))
      if (path === '/api/health')   return withCors(await handleHealth())
      if (path === '/api/plugins')  return withCors(await handlePlugins())

      // ---- SSR 页面 ----
      if (path === '/')             return renderHomePage()
      if (path === '/search')       return await renderResultsPage(request, env, ctx)

      return new Response('Not Found', { status: 404 })
    } catch (err) {
      console.error('Unhandled error:', err)
      return new Response(JSON.stringify({ code: 500, message: 'Internal error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      })
    }
  }
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Content-Type')
  return new Response(response.body, { status: response.status, headers })
}
```

---

## 8. 搜索 API (api/search.ts)

```typescript
// GET  /api/search?kw=电影名&plugins=duoduo,pansearch&cloud_types=quark,baidu&refresh=true
// POST /api/search  { "kw": "电影名", "plugins": "duoduo,pansearch" }

async function handleSearch(request: Request, env: Env, ctx: ExecutionContext) {
  // 1. 解析参数（同时支持 GET query 和 POST JSON）
  const params = request.method === 'GET'
    ? parseQueryParams(new URL(request.url))
    : await request.json()

  const { kw, plugins: pluginNames, cloud_types, refresh } = params
  if (!kw?.trim()) return json({ code: 400, message: '缺少搜索关键词 kw' }, 400)

  // 2. 查缓存（除非 refresh=true）
  const cacheKey = `search|${kw}|${pluginNames || 'all'}|${cloud_types || 'all'}`
  if (!refresh) {
    const cached = await env.SEARCH_CACHE.get(cacheKey, 'json')
    if (cached) return json({ code: 0, data: cached, cached: true })
  }

  // 3. 选择插件
  const plugins = pluginNames
    ? getPluginsByNames(pluginNames.split(','))
    : getAllPlugins()

  // 4. 执行搜索
  const results = await searchAll(kw, plugins, {
    timeout: Number(env.DEFAULT_TIMEOUT) || 15000,
    maxPlugins: Number(env.MAX_PLUGINS) || 30
  })

  // 5. 按网盘类型过滤（可选）
  let filtered = results
  if (cloud_types) {
    const types = new Set(cloud_types.split(','))
    filtered = results
      .map(r => ({ ...r, links: r.links.filter(l => types.has(l.type)) }))
      .filter(r => r.links.length > 0)
  }

  // 6. 构造响应
  const data = {
    total: filtered.length,
    results: filtered,
    merged_by_type: groupByCloudType(filtered)  // 按网盘类型聚合
  }

  // 7. 异步写缓存（ctx.waitUntil 不阻塞响应返回）
  ctx.waitUntil(
    env.SEARCH_CACHE.put(cacheKey, JSON.stringify(data), { expirationTtl: 3600 })
  )

  return json({ code: 0, message: 'success', data })
}

function groupByCloudType(results: SearchResult[]): Record<string, any[]> {
  const grouped: Record<string, any[]> = {}
  for (const r of results) {
    for (const link of r.links) {
      if (!grouped[link.type]) grouped[link.type] = []
      grouped[link.type].push({
        url: link.url,
        password: link.password,
        title: r.title,
        datetime: r.datetime,
        source: r.channel
      })
    }
  }
  return grouped
}
```

---

## 9. 其他 API 接口

```typescript
// GET /api/health
async function handleHealth() {
  return json({
    status: 'ok',
    runtime: 'cloudflare-workers',
    plugin_count: getPluginList().length,
    plugins: getPluginList().map(p => p.name)
  })
}

// GET /api/plugins
async function handlePlugins() {
  return json({
    code: 0,
    data: getPluginList()  // [{ name: "duoduo", priority: 2 }, ...]
  })
}
```

---

## 10. SSR 页面渲染 (ssr/)

Workers 无 DOM，采用字符串模板拼接 HTML：

```typescript
// ===== 通用 HTML 壳 =====
function renderLayout(title: string, body: string): Response {
  return new Response(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - PanSou</title>
  <style>${GLOBAL_CSS}</style>
</head>
<body>
  <header><nav><a href="/">PanSou</a></nav></header>
  <main>${body}</main>
  <footer><p>Powered by Cloudflare Workers</p></footer>
</body></html>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  })
}

// ===== 首页 =====
function renderHomePage(): Response {
  return renderLayout('首页', `
    <h1>网盘资源搜索</h1>
    <p>同时搜索 78+ 数据源</p>
    <form action="/search" method="GET">
      <input name="kw" placeholder="输入搜索关键词..." required autofocus>
      <button type="submit">搜索</button>
    </form>
    <p>支持: 夸克 | UC | 百度 | 阿里云盘 | 迅雷 | 115 | 123盘 | PikPak | 磁力</p>
  `)
}

// ===== 搜索结果页 =====
async function renderResultsPage(request: Request, env: Env, ctx: ExecutionContext) {
  const kw = new URL(request.url).searchParams.get('kw') || ''
  if (!kw.trim()) return Response.redirect('/', 302)

  // 复用搜索逻辑（与 API 共享 searchAll）
  const plugins = getAllPlugins()
  const results = await searchAll(kw, plugins, { timeout: 15000, maxPlugins: 30 })

  // 异步缓存
  ctx.waitUntil(env.SEARCH_CACHE.put(`ssr|${kw}`, JSON.stringify(results), { expirationTtl: 3600 }))

  return renderLayout(`"${kw}" 搜索结果`, `
    <form action="/search" method="GET">
      <input name="kw" value="${escapeHtml(kw)}" required>
      <button>搜索</button>
    </form>
    <p>共找到 ${results.length} 条结果</p>
    ${results.map(r => `
      <div class="card">
        <h3>${escapeHtml(r.title)}</h3>
        <span class="date">${r.datetime || ''}</span>
        <p>${escapeHtml((r.content || '').slice(0, 200))}</p>
        <div class="links">
          ${r.links.map(l => `
            <a href="${escapeHtml(l.url)}" target="_blank" rel="noopener" class="badge ${l.type}">
              ${cloudTypeLabel(l.type)}
              ${l.password ? `<span class="pwd">密码: ${escapeHtml(l.password)}</span>` : ''}
            </a>
          `).join(' ')}
        </div>
        ${r.tags?.length ? `<div class="tags">${r.tags.map(t => `<span>${escapeHtml(t)}</span>`).join('')}</div>` : ''}
      </div>
    `).join('')}
  `)
}
```

---

## 11. 流式 SSR（可选优化）

搜索耗时较长时，先发送 HTML 壳 + loading，结果就绪后注入：

```typescript
async function renderResultsStreaming(request: Request, env: Env, ctx: ExecutionContext) {
  const kw = new URL(request.url).searchParams.get('kw') || ''
  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()
  const write = (s: string) => writer.write(new TextEncoder().encode(s))

  ctx.waitUntil((async () => {
    try {
      // 1. 先发 HTML 头 + loading 状态
      await write(`<!DOCTYPE html><html><head>...</head><body>`)
      await write(`<div id="results">搜索中...</div>`)

      // 2. 执行搜索
      const results = await searchAll(kw, getAllPlugins(), { timeout: 15000, maxPlugins: 30 })

      // 3. 用 inline script 替换 loading 为实际结果
      const html = renderResultCards(results)
      await write(`<script>document.getElementById('results').innerHTML=${JSON.stringify(html)}</script>`)

      // 4. 关闭 HTML
      await write(`</body></html>`)
    } finally {
      await writer.close()
    }
  })())

  return new Response(readable, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  })
}
```

---

## 12. 缓存策略（三层）

```
Layer 1: Cloudflare CDN 边缘缓存 (Cache API)
  → 最快，命中时不执行 Worker 代码
  → TTL: 5~15 分钟
  → 适合：热门搜索词

Layer 2: Workers KV
  → 跨边缘节点共享（最终一致）
  → TTL: 1 小时
  → ctx.waitUntil() 异步写入，不阻塞响应
  → 适合：搜索结果 JSON

Layer 3: 隔离区内存（模块作用域变量）
  → 如 pansearch 的 buildIdCache
  → 生命周期 = 隔离区存活时间（几分钟到几小时）
  → 零延迟，但不跨隔离区共享
  → 适合：短期缓存（buildId、token 等）
```

### 缓存中间件伪代码

```typescript
async function withCache(request: Request, env: Env, ctx: ExecutionContext, handler: () => Promise<Response>) {
  const cache = caches.default
  const cacheKey = new Request(request.url)

  // 1. 查 CDN 边缘缓存
  let resp = await cache.match(cacheKey)
  if (resp) return addHeader(resp, 'X-Cache', 'HIT-EDGE')

  // 2. 查 KV
  const kvKey = `cache:${new URL(request.url).pathname + new URL(request.url).search}`
  const kvCached = await env.SEARCH_CACHE.get(kvKey, 'text')
  if (kvCached) {
    resp = new Response(kvCached, { headers: { 'Content-Type': 'application/json' } })
    ctx.waitUntil(cache.put(cacheKey, resp.clone()))  // 回填 CDN 缓存
    return addHeader(resp, 'X-Cache', 'HIT-KV')
  }

  // 3. 执行实际逻辑
  resp = await handler()

  // 4. 异步写入两层缓存
  if (resp.status === 200) {
    ctx.waitUntil(Promise.all([
      cache.put(cacheKey, resp.clone()),
      env.SEARCH_CACHE.put(kvKey, await resp.clone().text(), { expirationTtl: 3600 })
    ]))
  }

  return addHeader(resp, 'X-Cache', 'MISS')
}
```

---

## 13. 限流 (middleware/rate-limit.ts)

```typescript
async function checkRateLimit(request: Request, env: Env): Promise<Response | null> {
  if (!env.RATE_LIMIT_KV) return null  // 未配置则跳过

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const key = `ratelimit:${ip}`
  const WINDOW = 60       // 60 秒窗口
  const MAX_REQ = 30      // 每窗口最多 30 次

  const current = await env.RATE_LIMIT_KV.get(key, 'json') as { count: number; start: number } | null
  const now = Math.floor(Date.now() / 1000)

  if (current && (now - current.start) < WINDOW) {
    if (current.count >= MAX_REQ) {
      return json({ code: 429, message: '请求频率过高' }, 429)
    }
    await env.RATE_LIMIT_KV.put(key, JSON.stringify({ count: current.count + 1, start: current.start }), { expirationTtl: WINDOW })
  } else {
    await env.RATE_LIMIT_KV.put(key, JSON.stringify({ count: 1, start: now }), { expirationTtl: WINDOW })
  }

  return null  // 放行
}
```

---

## 14. Node.js 兼容性汇总

| 原 Node.js API | 涉及文件数 | Workers 适配方案 |
|----------------|-----------|-----------------|
| `require('crypto')` MD5 | base.js + 6 插件 | `nodejs_compat` 直接可用，或用 Web Crypto `crypto.subtle.digest('MD5', ...)` |
| `require('crypto')` AES-128-CBC | 2 插件 (miaoso, sdso) | `nodejs_compat` 直接可用，或用 `crypto.subtle.importKey` + `crypto.subtle.decrypt` |
| `Buffer.from()` | 7 插件 | `nodejs_compat` 提供 Buffer，或用 `Uint8Array` + `TextEncoder` + `atob/btoa` |
| `require('cheerio')` | 51 插件 | 正常工作，esbuild 打包即可（~200KB） |
| `require('fs')` / `require('path')` | 仅 qqpd.js | 改用 Workers KV 存取用户配置，或排除该插件 |
| CommonJS `require` / `module.exports` | 全部 83 个 | 机械式转为 ESM `import` / `export` |

---

## 15. 打包体积估算

```
cheerio（含 htmlparser2）    ~200KB minified
83 个插件代码                 ~100KB
框架代码（路由/SSR/中间件）     ~20KB
─────────────────────────────
总计                          ~320KB (未压缩)

Workers 限制：免费 1MB / 付费 10MB（压缩后）
→ 320KB 远在限制之内
```

---

## 16. API 接口汇总

| 方法 | 路径 | 参数 | 说明 |
|------|------|------|------|
| GET/POST | `/api/search` | `kw`(必填), `plugins`, `cloud_types`, `timeout`, `max_plugins`, `refresh` | 搜索接口 |
| GET | `/api/plugins` | 无 | 获取插件列表（名称+优先级） |
| GET | `/api/health` | 无 | 健康检查 |
| GET | `/` | 无 | SSR 首页 |
| GET | `/search` | `kw`(必填) | SSR 搜索结果页 |

### 搜索接口示例

```bash
# GET 方式
curl "https://pansou.example.com/api/search?kw=流浪地球&plugins=duoduo,pansearch&cloud_types=quark,baidu"

# POST 方式
curl -X POST "https://pansou.example.com/api/search" \
  -H "Content-Type: application/json" \
  -d '{"kw":"流浪地球","plugins":"duoduo,pansearch","cloud_types":"quark,baidu"}'
```

### 响应格式

```json
{
  "code": 0,
  "message": "success",
  "cached": false,
  "data": {
    "total": 42,
    "results": [
      {
        "uniqueId": "duoduo-a1b2c3d4",
        "title": "流浪地球2 4K",
        "content": "导演: 郭帆 / 主演: 吴京...",
        "links": [
          { "type": "quark", "url": "https://pan.quark.cn/s/xxx", "password": "abc1" },
          { "type": "baidu", "url": "https://pan.baidu.com/s/yyy", "password": "" }
        ],
        "datetime": "2024-01-15T00:00:00Z",
        "tags": ["4K", "科幻"],
        "channel": "duoduo"
      }
    ],
    "merged_by_type": {
      "quark": [
        { "url": "https://pan.quark.cn/s/xxx", "password": "abc1", "title": "流浪地球2 4K", "source": "duoduo" }
      ],
      "baidu": [...]
    }
  }
}
```

---

## 17. 实现步骤（推荐顺序）

1. **初始化项目** - `wrangler init`，配置 `wrangler.toml`、`package.json`、`tsconfig.json`
2. **转换 base.ts** - 纯函数直接搬，crypto 相关适配 Web Crypto 或启用 `nodejs_compat`
3. **先转 2~3 个代表性插件验证** - 选一个 API 类（hunhepan）、一个 cheerio 类（duoduo）、一个 crypto 类（miaoso）
4. **实现 search-all + /api/search** - 端到端跑通搜索链路
5. **批量转换剩余 80 个插件** - 可写脚本自动 CJS→ESM 转换
6. **实现 SSR 页面** - 首页 + 结果页
7. **添加缓存层** - KV + Cache API
8. **添加限流和错误处理**
9. **处理 qqpd.js** - KV 适配或排除
10. **部署测试** - `wrangler deploy`
