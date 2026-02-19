import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

// Import the generated route tree
import { routeTree } from "./routeTree.gen";

// Create a new router instance
export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: 24 * 60 * 60 * 1000,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    },
  });

  const router = createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    context: { auth: null },
  });

  setupRouterSsrQueryIntegration({
    router,
    queryClient,
  });

  return router;
};
