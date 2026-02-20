# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TanStack Start + shadcn/ui full-stack template using React 19, TypeScript, and Tailwind CSS v4. Deployed to Cloudflare Workers.

## Tech Stack

- **Framework**: TanStack Start (full-stack React framework with SSR)
- **Router**: TanStack Router (file-based routing with type-safety)
- **Data Fetching**: TanStack React Query
- **UI Components**: shadcn/ui (Base Nova style with Base UI primitives, NOT Radix)
- **Styling**: Tailwind CSS v4 with native CSS variables (OKLch color space)
- **Icons**: Hugeicons (`@hugeicons/react` + `@hugeicons/core-free-icons`)
- **Auth & Database**: Supabase (magic link auth, Postgres)
- **AI**: Vercel AI SDK with OpenAI-compatible provider
- **Code Quality**: Biome (linter + formatter, replaces ESLint/Prettier)
- **Build**: Vite 7
- **Deploy**: Cloudflare Workers via Wrangler

## Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands.

MUST USE CDP 9222

Core workflow:
1. `agent-browser --cdp 9222 open <url>` - Navigate to page
2. `agent-browser --cdp 9222 snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser --cdp 9222 click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes

## Commands

```bash
pnpm dev            # Dev server on port 2190
pnpm build          # Production build
pnpm preview        # Preview production build locally
pnpm deploy         # Build and deploy to Cloudflare Workers
pnpm check          # Biome: format + lint with auto-fixes (run before commits)
pnpm format         # Biome: format only
pnpm lint           # Biome: lint only
```

No test runner is configured. Validate with `pnpm lint && pnpm build`.

## Key Architecture

### Routing

- File-based routes in `src/routes/` → auto-generates `src/routeTree.gen.ts` (never edit manually)
- Root layout (`src/routes/__root.tsx`):
  - `beforeLoad` fetches auth state from Supabase, provides it as router context
  - Includes global head/meta, CSS imports, TanStack DevTools, theme script
  - `shellComponent` renders the HTML document structure
- Route layout contract (required for new pages):
  - App shell is fixed-height (`h-svh`) with `overflow-hidden` at root level
  - Each route page must own scrolling via a route root container:
    - `className="flex min-h-0 flex-1 overflow-y-auto"`
  - Put width/padding wrappers inside that scroll container (`mx-auto max-w-* p-*`)
  - For sticky bottom UI (like chat composer), keep page scroll at route root and use inner `min-h-0 + overflow-hidden + sticky bottom-0`
- Router instance in `src/router.tsx` integrates TanStack Query via `setupRouterSsrQueryIntegration`

### Authentication Pattern

- `src/lib/auth.ts` exports `getAuthUser()` and `requireAuth()`
- Root route's `beforeLoad` calls `getAuthUser()` → all routes access `context.auth`
- Protected routes call `requireAuth()` in their own `beforeLoad` to redirect unauthenticated users
- Login via Supabase magic link (OTP) at `/login`

### UI Components

- shadcn/ui components live in `src/components/ui/` (Base UI primitives, NOT Radix — different API)
- Add new components: `pnpm dlx shadcn@latest add <component>`
- Variants via `class-variance-authority` (CVA)
- Class merging utility `cn()` in `src/lib/utils.ts` (clsx + tailwind-merge)
- Path aliases: `@/components`, `@/ui`, `@/lib`, `@/hooks`

### Theming

- CSS variables defined in `src/styles.css` (light/dark modes)
- Inline script in root layout prevents FOUC by setting `dark` class before paint
- `ThemeToggle` component reads/writes `localStorage("theme")`, falls back to `prefers-color-scheme`

### AI Chat

- Server handler at `src/routes/api/chat.ts` using Vercel AI SDK `streamText`
- Client UI at `src/routes/chat.tsx` using `@ai-sdk/react` `useChat` hook
- Provider configured in `src/lib/ai-provider.ts` (OpenAI-compatible endpoint)

### Vite Plugin Order (critical)

1. `@tanstack/devtools-vite`
2. `@cloudflare/vite-plugin` (SSR environment)
3. `vite-tsconfig-paths`
4. `@tailwindcss/vite`
5. `@tanstack/react-start/plugin/vite`
6. `@vitejs/plugin-react`

### Environment Variables

- `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` — Supabase client
- `AI_API_KEY` / `AI_BASE_URL` / `AI_MODEL` — AI provider (server-only)

## Code Conventions

- Biome enforces formatting (spaces) and linting; config excludes `*.gen.ts` and `src/styles.css`
- Arrow functions ignoring return values use braces: `() => { fn() }` not `() => void fn()`
- Conventional Commits: `feat:`, `fix:`, `chore:`
- UI component filenames: lowercase kebab-case (e.g., `alert-dialog.tsx`)
