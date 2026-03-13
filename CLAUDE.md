**Deploy**: Cloudflare Workers via Wrangler

before edit you should run `pnpm run dev` to open tanstack watch

## Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands.

MUST USE autoconnect

Core workflow:
1. `agent-browser --autoconnect open <url>` - Navigate to page
2. `agent-browser --autoconnect snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser --autoconnect click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes
