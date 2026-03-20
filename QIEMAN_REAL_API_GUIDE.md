# 且慢 API 真实数据对接指南

## 当前状态

✅ 已完成 Mock 数据实现
✅ 已完成真实 API 客户端框架
⚠️ 需要配置有效的认证信息才能使用真实 API

## 快速切换 Mock / 真实 API

### 方式 1: 使用 Mock 数据（默认）

```jsonc
// wrangler.jsonc
{
  "vars": {
    "QIEMAN_USE_MOCK": "true",  // 或者不设置，默认为 true
    "QIEMAN_API_TOKEN": ""       // 可以为空
  }
}
```

### 方式 2: 使用真实 API

```jsonc
// wrangler.jsonc
{
  "vars": {
    "QIEMAN_USE_MOCK": "false",
    "QIEMAN_API_TOKEN": "eyJ2ZXIiOiJ2MSIsImFsZyI6IkhTNTEyIn0..."  // 填入有效的 JWT Token
  }
}
```

## 获取有效的 Token

### 方法 1: 从浏览器抓包

1. 打开且慢网站并登录
2. 打开浏览器开发者工具 (F12)
3. 切换到 Network 标签
4. 访问长赢计划页面
5. 找到任意 API 请求，复制 `Authorization` header 中的 Bearer Token

### 方法 2: 从 req.txt 更新

```bash
# 从最新的抓包文件中提取 token
grep -m 1 '"authorization":' req.txt | sed 's/.*Bearer //' | sed 's/".*//'
```

## 测试真实 API

### 1. 配置 Token

编辑 `wrangler.jsonc`:

```jsonc
{
  "vars": {
    "QIEMAN_USE_MOCK": "false",
    "QIEMAN_API_TOKEN": "你的_Token_这里"
  }
}
```

### 2. 启动开发服务器

```bash
pnpm dev
```

### 3. 测试接口

```bash
# 测试长赢计划信息
curl "http://localhost:2190/api/qieman/long-win?userPropertyId=1679634"

# 测试投资方案
curl "http://localhost:2190/api/qieman/long-win-plan?prodCode=LONG_WIN"

# 测试资产汇总
curl "http://localhost:2190/api/qieman/long-win-assets?capitalAccountId=CAC05B55OCGQ9T"
```

## 注意事项

### Token 过期问题

JWT Token 通常有过期时间（从 req.txt 看是 2026年5月）。如果遇到 401 错误，需要重新获取 Token。

### x-sign 签名问题

⚠️ **当前签名算法是占位实现**

且慢 API 需要 `x-sign` 签名验证。从 req.txt 看，签名格式类似：
```
177339402090673EAC1F009ABBC0B1C35705E58F15ED6
```

签名可能包含：
- 时间戳
- 请求路径
- 某种密钥的哈希

**需要逆向或咨询且慢获取真实的签名算法。**

当前实现位于 `src/lib/qieman/client.ts` 的 `generateSign()` 方法：

```typescript
private generateSign(timestamp: number, path: string): string {
  // TODO: 实现真实的签名算法
  return `${timestamp}${Math.random().toString(36).substring(2).toUpperCase()}`;
}
```

### 测试结果

从之前的测试看：
- ✅ Token 有效（HTTP 200）
- ❌ 但响应为空（可能是签名验证失败）

## 解决方案

### 临时方案：使用固定的有效签名

如果你有一个最近的有效签名，可以临时硬编码：

```typescript
// src/lib/qieman/client.ts
private generateSign(timestamp: number, path: string): string {
  // 使用 req.txt 中的有效签名（仅用于测试）
  return "177339402090673EAC1F009ABBC0B1C35705E58F15ED6";
}
```

### 长期方案：实现真实签名算法

需要分析且慢的前端代码或联系且慢技术支持获取签名规则。

## 环境变量完整列表

```jsonc
{
  "vars": {
    // 且慢 API 配置
    "QIEMAN_USE_MOCK": "true",           // "true" 使用 mock, "false" 使用真实 API
    "QIEMAN_API_TOKEN": "",              // JWT Bearer Token

    // 其他服务配置
    "AI_BASE_URL": "https://api.xiaomimimo.com/v1",
    "SUPABASE_PROJECT_REF": "knclktpgdzpxdooyprdv",
    "TG_CHANNELS": "..."
  }
}
```

## 文件结构

```
src/lib/qieman/
├── types.ts          # TypeScript 类型定义
├── mock-data.ts      # Mock 数据
└── client.ts         # API 客户端（支持真实 API）

src/routes/api/qieman/
├── long-win.ts       # 长赢计划接口（支持 Mock/真实切换）
├── long-win-plan.ts  # 投资方案接口（支持 Mock/真实切换）
└── long-win-assets.ts # 资产汇总接口（支持 Mock/真实切换）
```

## 下一步

1. **获取有效的 Token** - 从浏览器或最新抓包文件
2. **实现签名算法** - 分析前端代码或咨询且慢
3. **测试真实 API** - 验证数据结构是否与 Mock 一致
4. **更新 Mock 数据** - 如果真实数据结构有变化

## 常见问题

### Q: 为什么返回空响应？
A: 可能是 x-sign 签名验证失败。需要实现正确的签名算法。

### Q: Token 从哪里获取？
A: 登录且慢网站后，从浏览器开发者工具的 Network 标签中任意 API 请求的 Authorization header 复制。

### Q: 如何验证 Token 是否有效？
A: 使用 curl 直接请求且慢 API：
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
     "https://qieman.com/pmdj/v2/long-win?userPropertyId=1679634"
```

### Q: Mock 数据和真实数据结构一样吗？
A: Mock 数据来自真实抓包解码，结构完全一致。但真实数据会实时更新。
