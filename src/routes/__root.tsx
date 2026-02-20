import { TanStackDevtools } from "@tanstack/react-devtools";
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
  useMatches,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";

import { BackToHome } from "@/components/back-to-home";
import { ChatEntry } from "@/components/chat-entry";
import { ThemeToggle } from "@/components/theme-toggle";

import type { AuthUser } from "@/lib/auth";
import { getAuthUser } from "@/lib/auth";
import appCss from "../styles.css?url";

interface RouterContext {
  auth: AuthUser;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  beforeLoad: async () => {
    const auth = await getAuthUser();
    return { auth };
  },
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "TanStack Start Starter",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),

  shellComponent: RootDocument,
});

function RootLayout() {
  const isIndex = useMatches({
    select: (matches) => matches[matches.length - 1]?.fullPath === "/",
  });

  return (
    <div className="flex h-svh min-h-svh flex-col overflow-hidden">
      <header className="flex shrink-0 w-full items-center px-4 pt-3 sm:px-6">
        {!isIndex && <BackToHome />}
        <div className="ml-auto flex items-center gap-1">
          <ChatEntry />
          <ThemeToggle />
        </div>
      </header>
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("theme");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme:dark)").matches))document.documentElement.classList.add("dark")}catch(e){}})()`,
          }}
        />
        {children}
        <TanStackDevtools
          config={{
            position: "bottom-right",
          }}
          plugins={[
            {
              name: "Tanstack Router",
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  );
}
