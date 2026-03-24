import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import viteTsConfigPaths from "vite-tsconfig-paths";

/** Fix cheerio resolution in SSR: redirect to ESM build and provide default export */
function cheerioEsmFix() {
  return {
    name: "cheerio-esm-fix",
    enforce: "pre" as const,
    load(id: string) {
      // cheerio's browser build is CJS without default export — redirect to ESM build
      if (id.includes("cheerio/dist/browser/index.js")) {
        const esmPath = id.replace("/browser/", "/esm/");
        // ESM build has no default export — create a namespace wrapper
        return `
import * as cheerioNS from '${esmPath}';
const cheerio = cheerioNS;
export default cheerio;
export * from '${esmPath}';
`;
      }
      return null;
    },
  };
}

const config = defineConfig({
  plugins: [
    cheerioEsmFix(),
    devtools(),
    // cloudflare({ viteEnvironment: { name: 'ssr' } }),
    // 仅在 build 时启用 cloudflare 插件（devtool使用了nodejs环境fs，而cloudflare dev runtime 不支持使用fs）
    process.env.NODE_ENV === 'production' && cloudflare({ viteEnvironment: { name: 'ssr' } }),
    // this is the plugin that enables path aliases
    viteTsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tailwindcss(),
    VitePWA({
      integration: {
        closeBundleOrder: "post",
      },
      strategies: "generateSW",
      registerType: "autoUpdate",
      injectRegister: false,
      devOptions: {
        enabled: false,
      },
      includeAssets: ["favicon.ico", "logo192.png", "logo512.png"],
      manifest: {
        name: "Entry Point",
        short_name: "Entry",
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: "#000000",
        background_color: "#ffffff",
        icons: [
          {
            src: "/logo192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/logo512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: "/",
        runtimeCaching: [],
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
      },
    }),
    tanstackStart(),
    viteReact(),
  ],
});

export default config;
