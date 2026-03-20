# 且慢 PMDJ API 模拟接口设计文档

## 概述

本文档描述了三个核心且慢（qieman.com）PMDJ 服务接口的模拟实现，用于调研和开发阶段的 API 对接测试。

## 技术栈

- **框架**: TanStack React Start (file-based routing)
- **运行时**: Cloudflare Workers
- **语言**: TypeScript
- **响应格式**: 统一 JSON 封装 (`{ code, message, data }`)

## 文件结构

```
src/
├── lib/
│   └── qieman/
│       ├── types.ts           # TypeScript 类型定义
│       └── mock-data.ts       # Mock 数据集中管理
└── routes/
    └── api/
        └── qieman/
            ├── long-win.ts           # 长赢计划主信息
            ├── long-win-plan.ts      # 长赢投资方案
            └── long-win-assets.ts    # 长赢资产汇总
```

## 接口清单

### 1. 长赢计划主信息

**路径**: `/api/qieman/long-win`
**方法**: `GET`
**原始路径**: `/pmdj/v2/long-win`

**查询参数**:
- `userPropertyId` (必填): 用户持仓ID
- `extClassify` (可选): 是否扩展分类，默认 true

**响应示例**:
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 717772,
    "userPropertyId": 1679634,
    "userId": 1784030,
    "type": "LONG_WIN",
    "investType": "E",
    "unitAmount": 100,
    "savings": 2000,
    "capitalAccountId": "CAC05B55OCGQ9T",
    "status": "FOLLOW",
    "followedAdjustments": [...],
    "extUnitInfo": [...],
    "prodCode": "LONG_WIN"
  }
}
```

**核心字段说明**:
- `status`: 跟车状态 (FOLLOW=跟随中)
- `followedAdjustments`: 历史调仓记录列表
- `extUnitInfo`: 持仓组合配置（资产类别、基金代码等）
- `advicePhase`: 建议阶段 (cover=补仓期)

---

### 2. 长赢投资方案

**路径**: `/api/qieman/long-win-plan`
**方法**: `GET`
**原始路径**: `/pmdj/v2/long-win/plan`

**查询参数**:
- `prodCode` (必填): 产品代码，如 `LONG_WIN`

**响应示例**:
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "establishDate": 1435680000000,
    "tradeLimit": {
      "minUnitAmount": 100,
      "maxUnitAmount": 1000000
    },
    "composition": [
      {
        "className": "A股",
        "classCode": "CHINA_STOCK",
        "unit": 74,
        "accProfitRate": 0.506,
        "percent": 0.458,
        "compList": [
          {
            "fund": {
              "fundCode": "100032",
              "fundName": "富国中证红利指数增强A",
              "nav": "1.0280",
              "navDate": "2026-03-12"
            },
            "variety": "中证红利",
            "nav": 1.028,
            "dailyReturn": 0.0078,
            "planUnit": 13,
            "percent": 0.0785
          }
        ]
      }
    ]
  }
}
```

**核心字段说明**:
- `composition`: 资产配置组合（A股、债券等）
- `compList`: 每个资产类别下的具体基金列表
- `planUnit`: 计划配置单位数
- `accProfitRate`: 累计收益率

---

### 3. 长赢资产汇总

**路径**: `/api/qieman/long-win-assets`
**方法**: `GET`
**原始路径**: `/pmdj/v2/long-win/ca/assets-summary`

**查询参数**:
- `capitalAccountId` (必填): 资金账户ID
- `classify` (可选): 是否分类，默认 true
- `useV2OrderApi` (可选): 是否使用V2订单API，默认 true

**响应示例**:
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "totalAssets": 15234.56,
    "totalProfit": 3456.78,
    "totalProfitRate": 0.2935,
    "yesterdayProfit": 123.45,
    "totalInvest": 11777.78,
    "holdingAssets": [
      {
        "fundCode": "100032",
        "fundName": "富国中证红利指数增强A",
        "shares": 1234.56,
        "nav": 1.028,
        "marketValue": 1269.13,
        "cost": 1100.0,
        "profit": 169.13,
        "profitRate": 0.1538,
        "dailyProfit": 9.87,
        "variety": "中证红利",
        "className": "A股"
      }
    ],
    "cashAssets": [
      {
        "fundCode": "511990",
        "fundName": "华宝添益",
        "shares": 265.94,
        "nav": 100.0,
        "marketValue": 265.94
      }
    ]
  }
}
```

**核心字段说明**:
- `totalAssets`: 总资产
- `totalProfit`: 累计收益
- `totalProfitRate`: 总收益率
- `holdingAssets`: 持仓基金明细（份额、市值、盈亏等）
- `cashAssets`: 现金类资产（货币基金等）

---

## 统一响应格式

### 成功响应 (2xx)
```json
{
  "code": 0,
  "message": "success",
  "data": { /* 实际数据 */ }
}
```

### 错误响应 (4xx/5xx)
```json
{
  "code": 400,
  "message": "Missing required parameter: userPropertyId"
}
```

### CORS 支持
所有接口自动添加 CORS 头：
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

---

## 使用示例

### 1. 获取长赢计划信息
```bash
curl "http://localhost:2190/api/qieman/long-win?userPropertyId=1679634"
```

### 2. 获取投资方案
```bash
curl "http://localhost:2190/api/qieman/long-win-plan?prodCode=LONG_WIN"
```

### 3. 获取资产汇总
```bash
curl "http://localhost:2190/api/qieman/long-win-assets?capitalAccountId=CAC05B55OCGQ9T&classify=true"
```

---

## Mock 数据说明

所有 mock 数据来源于真实抓包的 base64 响应体解码，保留了完整的数据结构：

- **长赢计划**: 包含 26 条历史调仓记录，状态为跟随中
- **投资方案**: A股 74% + 债券 26% 配置，包含 4 只基金
- **资产汇总**: 总资产 15,234.56 元，收益率 29.35%

数据已做脱敏处理，可直接用于开发测试。

---

## 后续扩展

### 对接真实 API
1. 在 `wrangler.jsonc` 中添加环境变量：
   ```json
   "vars": {
     "QIEMAN_API_BASE": "https://qieman.com",
     "QIEMAN_AUTH_TOKEN": "your_token_here"
   }
   ```

2. 修改路由文件，从 mock 数据切换到真实请求：
   ```typescript
   // 替换 mockLongWinData
   const response = await fetch(
     `${env.QIEMAN_API_BASE}/pmdj/v2/long-win?userPropertyId=${userPropertyId}`,
     {
       headers: {
         Authorization: `Bearer ${env.QIEMAN_AUTH_TOKEN}`,
       },
     }
   );
   const data = await response.json();
   return jsonResponse(data);
   ```

### 添加更多接口
参考现有模式，在 `src/routes/api/qieman/` 下创建新文件：
- `asset-detail.ts` - 资金账户详情
- `dismiss-tag.ts` - 调仓解散标签
- `dividend-methods.ts` - 分红方式设置

---

## 测试与部署

### 本地开发
```bash
pnpm dev
# 访问 http://localhost:2190/api/qieman/long-win?userPropertyId=1679634
```

### 构建部署
```bash
pnpm build
wrangler deploy
```

### 健康检查
```bash
curl http://localhost:2190/api/health
```

---

## 注意事项

1. **参数校验**: 所有必填参数缺失时返回 400 错误
2. **错误处理**: 统一捕获异常并返回 500 错误
3. **CORS 预检**: 支持 OPTIONS 请求
4. **类型安全**: 使用 TypeScript 类型定义确保数据结构一致性
5. **数据隔离**: Mock 数据集中管理，便于维护和更新

---

## 相关文件

- 类型定义: `src/lib/qieman/types.ts`
- Mock 数据: `src/lib/qieman/mock-data.ts`
- API 工具: `src/lib/api-utils.ts`
- 路由配置: `src/routes/api/qieman/*.ts`
