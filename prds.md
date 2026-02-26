# TG Search API 实施方案

## 概述

将 PanSou Go 项目的 Telegram 频道搜索功能移植到 TanStack Start 项目，作为服务端 API 路由部署到 Cloudflare Workers。

## 技术栈

- **HTML 解析**: cheerio (jQuery 风格 API，与 Go 的 goquery 最接近)
- **运行环境**: Cloudflare Workers (nodejs_compat 已启用)
- **默认频道**: tgsearchers4

## 架构

```
客户端请求
    ↓
GET /api/tg-search?kw=关键词&channels=频道1,频道2
    ↓
API 路由处理器 (src/routes/api/tg-search.ts)
    ↓
搜索服务 (src/lib/tg-search/search.ts)
    ├─ 并行抓取: https://t.me/s/{channel}?q={keyword}
    ├─ 使用 cheerio 解析 HTML (src/lib/tg-search/parser.ts)
    ├─ 使用正则提取链接 (src/lib/tg-search/regex.ts)
    ├─ 合并去重结果
    └─ 返回 SearchResponse
```

## 文件结构

```
src/lib/tg-search/
  types.ts          # 类型定义 (SearchResult, Link, MergedLink 等)
  regex.ts          # 正则模式 + getLinkType + extractPassword + extractNetDiskLinks + URL 清理函数
  parser.ts         # 使用 cheerio 解析 HTML (parseSearchResults, extractTitle 等)
  search.ts         # 搜索编排 (fetchChannelHtml, searchTG, mergeResultsByType)

src/routes/api/
  tg-search.ts      # API 路由处理器 (GET + POST)
```

## API 接口

### GET /api/tg-search

**查询参数:**
- `kw` (必需): 搜索关键词
- `channels` (可选): 逗号分隔的频道列表，默认 `tgsearchers4`
- `res` (可选): 结果类型
  - `merged_by_type` (默认): 按网盘类型分组
  - `results`: 返回详细结果列表
  - `all`: 返回两者

**示例:**
```bash
curl "http://localhost:2190/api/tg-search?kw=test"
curl "http://localhost:2190/api/tg-search?kw=test&channels=ch1,ch2&res=results"
```

### POST /api/tg-search

**请求体:**
```json
{
  "keyword": "test",
  "channels": ["tgsearchers4"],
  "result_type": "merged_by_type"
}
```

**响应格式:**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total": 10,
    "merged_by_type": {
      "baidu": [
        {
          "url": "https://pan.baidu.com/s/xxx",
          "password": "1234",
          "note": "资源标题",
          "datetime": "2024-01-01T00:00:00Z",
          "source": "tg:tgsearchers4",
          "images": ["https://..."]
        }
      ],
      "quark": [...]
    }
  }
}
```

## 支持的网盘类型 (13种)

1. baidu - 百度网盘
2. quark - 夸克网盘
3. aliyun - 阿里云盘
4. tianyi - 天翼云盘
5. uc - UC网盘
6. mobile - 移动云盘
7. 115 - 115网盘
8. pikpak - PikPak
9. xunlei - 迅雷网盘
10. 123 - 123网盘
11. magnet - 磁力链接
12. ed2k - ED2K链接
13. others - 其他

## 实施步骤

### Phase 1: 基础 (types + regex)
1. 创建 `src/lib/tg-search/types.ts`
2. 创建 `src/lib/tg-search/regex.ts` - 移植所有正则模式和工具函数

### Phase 2: 解析器 (需要 cheerio)
3. 安装 cheerio: `pnpm add cheerio`
4. 创建 `src/lib/tg-search/parser.ts` - 移植所有 HTML 解析逻辑

### Phase 3: 搜索编排
5. 创建 `src/lib/tg-search/search.ts` - fetch + parse + merge 管道

### Phase 4: API 路由
6. 创建 `src/routes/api/tg-search.ts` - 暴露为 HTTP API
7. 更新 `wrangler.jsonc` 添加 `TG_CHANNELS` 环境变量

### Phase 5: 测试验证
8. 本地测试: `pnpm dev` 然后 `curl http://localhost:2190/api/tg-search?kw=test`
9. 运行 `pnpm check` (Biome lint + format)
10. 部署测试: `pnpm deploy`

## 环境变量

在 `wrangler.jsonc` 中添加:
```json
{
  "vars": {
    "TG_CHANNELS": "tgsearchers4"
  }
}
```

## 依赖项

- `cheerio`: ^1.0.0 (HTML 解析)

## 范围排除

以下 Go 项目功能**不包含**在此次移植中:
- 插件系统 (80+ 插件)
- 缓存系统 (两级磁盘+内存缓存)
- 身份验证 (JWT 认证)
- 前端 UI (仅 API)
- 基于评分的排序 (仅按时间排序)

## 关键移植文件

**源文件 (Go):**
- `pansou/util/regex_util.go` (819行) - 所有正则模式和 URL 清理
- `pansou/util/parser_util.go` (844行) - HTML 解析逻辑
- `pansou/util/http_util.go` (126行) - URL 构建和抓取
- `pansou/service/search_service.go` (1280行) - 搜索编排
- `pansou/model/response.go` (69行) - 数据结构

**目标文件 (TypeScript):**
- `src/lib/tg-search/types.ts` - 类型定义
- `src/lib/tg-search/regex.ts` - 正则和链接提取
- `src/lib/tg-search/parser.ts` - cheerio HTML 解析
- `src/lib/tg-search/search.ts` - 搜索编排
- `src/routes/api/tg-search.ts` - API 路由

## 已知问题 (待修复)

### 问题 1: 默认频道 `tgsearchers4` 无法获取内容

**发现时间:** 2026-02-26

**现象:**
- 使用默认频道 `tgsearchers4` 搜索任何关键词均返回 `total: 0`，`merged_by_type: {}`
- API 响应状态码正常 (200)，但数据为空

**根因分析:**
- 直接 fetch `https://t.me/s/tgsearchers4?q=xxx` 返回 HTTP 200，但 HTML 内容中不包含任何 `tgme_widget_message_wrap` 元素（HTML 长度仅约 9.7KB）
- 同样的 fetch 逻辑对其他公开频道（如 `durov`、`shareAliyun`）可以正常获取消息（HTML 长度约 135KB，包含 19-20 条消息）
- 说明频道 `tgsearchers4` 可能已不存在、已转为私有、或被 Telegram 限制

**验证结果:**
- `shareAliyun` 频道搜索 "斗破苍穹" 正常返回 20 条结果
- GET 和 POST 接口均正常工作
- `merged_by_type` 正确将链接归类到 `aliyun` 类型，数据结构符合预期

**影响:**
- 默认配置下 API 不返回任何有效数据
- 用户必须手动指定 `channels` 参数才能获取结果

**待修复方案:**
1. 更换默认频道列表为有效的公开资源频道（如 `shareAliyun` 等）
2. 添加频道可用性检测机制 — fetch 后检查 HTML 是否包含消息内容，若为空则记录警告
3. 添加多频道 fallback：当某个频道无结果时，尝试从备用频道列表获取
4. 在 `search.ts` 的 `catch` 块中添加更详细的日志（当前错误被静默吞掉）
5. 考虑在 `wrangler.jsonc` 的 `TG_CHANNELS` 环境变量中配置可用频道列表
