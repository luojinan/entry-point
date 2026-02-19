import { ArrowLeft02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { buttonVariants } from "@/components/ui/button";

export function BackToHome() {
  return (
    <Link to="/" className={buttonVariants({ variant: "ghost", size: "sm" })}>
      <HugeiconsIcon
        icon={ArrowLeft02Icon}
        strokeWidth={2}
        data-icon="inline-start"
      />
      首页
    </Link>
  );
}
