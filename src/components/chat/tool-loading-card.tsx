import { Card, CardContent } from "@/components/ui/card";

export function ToolLoadingCard({ label }: { label: string }) {
  return (
    <Card size="sm">
      <CardContent className="py-3">
        <p className="text-muted-foreground animate-pulse text-sm">{label}</p>
      </CardContent>
    </Card>
  );
}
