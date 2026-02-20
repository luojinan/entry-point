import { createFileRoute } from "@tanstack/react-router";
import { ComponentExample } from "@/components/component-example";

export const Route = createFileRoute("/components-demo")({
  component: ComponentsDemoPage,
});

function ComponentsDemoPage() {
  return (
    <main className="flex min-h-0 flex-1 overflow-y-auto">
      <ComponentExample />
    </main>
  );
}
