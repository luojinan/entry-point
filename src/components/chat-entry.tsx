import { ChatIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { buttonVariants } from "@/components/ui/button";

export function ChatEntry() {
  return (
    <Link
      to="/chat"
      className={buttonVariants({ variant: "ghost", size: "icon" })}
      aria-label="Open chat"
    >
      <HugeiconsIcon icon={ChatIcon} strokeWidth={2} />
    </Link>
  );
}
