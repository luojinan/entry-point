# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TanStack Start + shadcn/ui template using React 19, TypeScript, and Tailwind CSS v4.

## Tech Stack

- **Framework**: TanStack Start (full-stack React framework)
- **Router**: TanStack Router (file-based routing with type-safety)
- **UI Components**: shadcn/ui (Base Nova style with Base UI primitives)
- **Styling**: Tailwind CSS v4 with CSS variables
- **Icons**: Hugeicons
- **Build Tool**: Vite

## Key Architecture Points

### Routing System

- File-based routing in `src/routes/` using TanStack Router
- Routes are auto-generated into `src/routeTree.gen.ts` (do not edit manually)
- Root layout defined in `src/routes/__root.tsx` includes:
  - Global head/meta configuration
  - CSS imports
  - TanStack DevTools integration
  - Shell component for HTML structure

### Router Configuration

- Router instance created via `getRouter()` in `src/router.tsx`
- Configured with scroll restoration and preload settings
- Router uses generated route tree from file system

### UI Component System

- shadcn/ui components in `src/components/ui/`
- Configuration in `components.json` with Base Nova style
- Uses Base UI primitives (`@base-ui/react`) instead of Radix
- Path aliases configured: `@/components`, `@/lib`, `@/hooks`, `@/ui`
- Utility function `cn()` in `src/lib/utils.ts` for merging Tailwind classes

### Vite Configuration

Critical plugins loaded in order:

1. `@tanstack/devtools-vite` - Development tools
2. `vite-tsconfig-paths` - Path alias support from tsconfig
3. `@tailwindcss/vite` - Tailwind CSS v4
4. `@tanstack/react-start/plugin/vite` - TanStack Start
5. `@vitejs/plugin-react` - React support

### TypeScript Configuration

- Strict mode enabled
- Path alias: `@/*` maps to `./src/*`
- Module resolution: bundler mode
- Target: ES2022

## Development Workflow

### Code Quality

```bash
pnpm check         # Format with Prettier and fix ESLint issues
pnpm format        # Run Prettier
pnpm lint          # Run ESLint
```

## Important Notes

- TanStack Router generates route types automatically - never manually edit `src/routeTree.gen.ts`
- When adding new routes, create files in `src/routes/` following TanStack Router conventions
- shadcn/ui components use Base UI primitives, not Radix (different API from standard shadcn)
- Tailwind CSS v4 uses native CSS variables instead of JIT compilation
- DevTools are enabled in development (bottom-right corner) with Router panel
- 当箭头函数需要忽略返回值（如 Promise）时，使用花括号写法 `() => { fn() }` 而非 `void` 操作符 `() => void fn()`
