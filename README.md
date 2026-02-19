# TanStack Start + shadcn/ui

This is a template for a new TanStack Start project with React, TypeScript, and shadcn/ui.

## 依赖

### vite + react 相关

```json

{
  "dependencies": {
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@vitejs/plugin-react": "^5.0.4",
    "typescript": "^5.7.2",
    "vite": "^7.1.7"
    "vite-tsconfig-paths": "^5.1.4"
  }
}
```

### tanstack 相关

`@tanstack/router-plugin` 是什么，在tanstack的模板里没有
ssr query 和 query 是一个东西吗
各个 devtool 的作用

```json
{
  "dependencies": {
    "@tanstack/react-router": "^1.132.0",
    "@tanstack/router-plugin": "^1.132.0",
    "@tanstack/react-start": "^1.132.0",
    "@tanstack/react-router-ssr-query": "^1.131.7",
    // TanStack Start 使用的服务器引擎，提供服务端渲染、API 路由、中间件等全栈功能，自动集成到 TanStack Start，通过文件路由处理 SSR 和 API
    "nitro": "latest"
    // "@tanstack/react-router-devtools": "^1.132.0",
    // "@tanstack/react-devtools": "^0.7.0"
  },
  "devDependencies": {
    // "@tanstack/devtools-vite": "^0.3.11"
  }
}
```

![](https://kingan-md-img.oss-cn-guangzhou.aliyuncs.com/blog/202512181349975.png?x-oss-process=image/format,webp/resize,w_640)

nitro 是 deployment adapter 的一个选项，其他是(Cloudflare/Netlify)云服务平台，但是 nitro 不是云服务平台，例如要部署到Cloundflare，还是需要安装Cloundflare的vite pluin，那nitro vite plugin 的作用是什么？

如果是包装一层 Cloudflare ，我宁愿直接用 cloudflare 吧

### shadcn 组件相关：

[shadcn 依赖tailwindcss](https://ui.shadcn.com/docs/installation/manual#add-dependencies)

```bash
pnpm add class-variance-authority clsx tailwind-merge tw-animate-css
```

tailwind👇

```json
{
  "dependencies": {
    "@tailwindcss/vite": "^4.0.6",
    "tailwindcss": "^4.0.6",
    // 用于创建类型安全的、基于变体的组件样式系统。简化 variants、sizes、colors 等不同状态的类名管理
    // const button = cva("base-class", { variants: { intent: { primary: "bg-blue", secondary: "bg-gray" } } })
    "class-variance-authority": "^0.7.1",
    // 用于条件性地组合类名字符串。支持字符串、对象、数组等多种格式
    // clsx('btn', { 'btn-active': isActive }, ['extra-class'])
    "clsx": "^2.1.1",
    // 智能合并 Tailwind CSS 类名，避免冲突（如 px-2 px-4 会保留后者）。常与 clsx 配合使用
    // twMerge('px-2 py-1', 'px-4') → 'py-1 px-4'
    "tailwind-merge": "^3.4.0",
    // 为 Tailwind CSS 提供预设的动画类（如淡入淡出、滑动等）
    "tw-animate-css": "^1.4.0"
  }
}
```

shadcn + icon 👇

```json
{
  "dependencies": {
    "@base-ui/react": "^1.0.0",
    "@fontsource-variable/inter": "^5.2.8",
    "@hugeicons/core-free-icons": "^3.0.0",
    "@hugeicons/react": "^1.1.2",
    "shadcn": "^3.6.2"
  }
}
```

### 编辑器相关

tanstack
脚本生成的文件添加 格式化禁止/搜索禁止/修改禁止... 标识给编辑器

`.vscode/settings.json`

```json
{
  "files.watcherExclude": {
    "**/routeTree.gen.ts": true
  },
  "search.exclude": {
    "**/routeTree.gen.ts": true
  },
  "files.readonlyInclude": {
    "**/routeTree.gen.ts": true
  }
}
```

`biome.json`

```json
{
  "files": {
    "ignoreUnknown": false,
    "includes": ["**/src/**/*", "!**/src/routeTree.gen.ts"]
  }
}
```

`.zed/settings.json`

```json
{
  // 1. 只有这个配置参数，且会导致目录看到该文件 2. 默认值不会继承需要手动复制再新增
  "file_scan_exclusions": ["src/routeTree.gen.ts"]
}
```

### 部署 cloudflare

[host Cloudflare](https://tanstack.com/start/latest/docs/framework/react/guide/hosting#cloudflare-workers--official-partner)

```json
{
  "scripts": {
    "deploy": "pnpm build && wrangler deploy"
  },
  "devDependencies": {
    "@cloudflare/vite-plugin": "^1.18.0",
    "wrangler": "^4.55.0"
  }
}
```

add `wrangler.jsonc` & set `cloudflare({ viteEnvironment: { name: 'ssr' } })` vite plugin

## shadcn 组件编写示例

在 shadcn 文档中找合适的组件之后，使用 pnpm 下载组件源码，pnpm会根据项目内指定的组件库（baseui）去下载对应的组件源码

```bash
pnpm dlx shadcn@latest add button
```

组件包含样式，在业务代码中和使用普通组件库相同的方式

```tsx
import { Button } from "@/components/ui/button";

export function ButtonDemo() {
  return <Button size="sm">按钮</Button>;
}
```

如果需要二次开发，是 `@/components/myUI/MyButton.tsx` 引入 `@/components/ui/button` ？还是直接修改 `@/components/ui/button`?

👇 增加业务逻辑，处理权限码的按钮，如下：

![](https://kingan-md-img.oss-cn-guangzhou.aliyuncs.com/blog/202512181536208.png?x-oss-process=image/format,webp)

🤔 baseui 是一个只有属性/状态和事件的无样式组件库，例如button组件，只有disable状态控制
，内部没有任何button标签的样式，如：disable状态控制是否触发onclick、是否开启focusableWhenDisabled样式，但是样式是空的，基本无法直接使用

而shadcn则基于tailwindcss给baseui提供样式，编写一套带着样式，以及额外状态的组件源码，由用户通过pnpm下载到自己的业务代码中，此时为正常的基础组件（基础组件过于基础一般都要继承来额外开发 或者直接拉第三方继承shadcn基础组件二次开发过的组件源码...）

业务代码可以再继承一次添加业务状态和逻辑，变为业务组件

## 路由登录拦截

基于 TanStack Router 的 `beforeLoad` 钩子实现，分为两步：

### 1. 根路由获取认证状态

`src/routes/__root.tsx`:

```ts
interface RouterContext {
  auth: AuthUser;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async () => {
    const auth = await getAuthUser();  // 从 Supabase 获取用户信息
    return { auth };  // 存入路由 context
  },
  // ...
});
```

根路由的 `beforeLoad` **只负责获取认证状态并存入 context**，本身不做拦截。

### 2. 需要保护的路由检查并拦截

`src/routes/supabase.tsx`:

```ts
export const Route = createFileRoute("/supabase")({
  beforeLoad: ({ context, location }) => {
    if (!context.auth) {
      throw redirect({
        to: "/login",
        search: { redirect: location.href },  // 携带原始路径，登录后跳回
      });
    }
  },
  component: RouteComponent,
});
```

子路由在 `beforeLoad` 中检查 `context.auth`，未登录则 `throw redirect` 跳转到登录页。

### 设计原理

| 步骤 | 位置 | 作用 |
|------|------|------|
| 1 | `__root.tsx` beforeLoad | 获取用户信息，存入 `context.auth` |
| 2 | 子路由 beforeLoad | 检查 `context.auth`，决定是否重定向 |

- **灵活**：不是所有页面都需要登录（如首页、登录页）
- **按需保护**：每个路由自行决定是否拦截
- `throw redirect` 会中断路由加载，触发跳转

## 主题切换

这个问题涉及两个方案的对比：在 <body> 开头放同步内联 `<script>` vs 在 React 组件中（如 `useEffect`）处理初始主题。

为什么用内联 `<script>`

核心原因：它在浏览器解析 `HTML` 时同步执行，早于任何 CSS 渲染和 React hydration。

SSR 框架（TanStack Start）的页面加载流程是：

```
服务器返回 HTML → 浏览器解析 HTML → 首次绘制（paint）→ 加载 JS → React hydration → useEffect 执行
```

如果在 `useEffect` 中才添加 `.dark` 类，用户会先看到亮色主题闪一下再切换到暗色——这就是 `FOUC（Flash of Unstyled Content）`。而内联 `<script>`
在首次绘制之前就执行了，用户不会感知到切换。

优缺点

优点：
- 彻底消除 `FOUC`，用户体验最好
- 不依赖 `React` 生命周期，即使 JS bundle 加载慢也不会闪烁
- 脚本极小（~200 字节），对性能几乎无影响

缺点：
- 必须用 `dangerouslySetInnerHTML`，触发 `lint` 警告，可读性差
- 脚本内容是字符串，没有类型检查和编辑器支持
- 与 React 的声明式模型不一致——主题状态分散在两个地方（内联脚本做初始化，React 组件做后续交互）

有没有替代方案

如果不用内联 `<script>`，另一个常见做法是利用 `cookie` 在服务端渲染时就输出正确的类名。TanStack Start 支持服务端逻辑，可以在 `beforeLoad` 中读 `cookie`，然后直接在 `<html>` 上加
`className="dark"`。这样完全不需要内联脚本，但会增加服务端逻辑复杂度，且首次访问（无 cookie）仍需回退到系统偏好检测。
