import { Moon02Icon, Sun02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { buttonVariants } from "@/components/ui/button";

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = () => {
    const next = !isDark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
    setIsDark(next);
  };

  return (
    <button
      type="button"
      className={buttonVariants({ variant: "ghost", size: "icon" })}
      onClick={toggle}
      aria-label="Toggle theme"
    >
      <HugeiconsIcon icon={isDark ? Sun02Icon : Moon02Icon} strokeWidth={2} />
    </button>
  );
}
