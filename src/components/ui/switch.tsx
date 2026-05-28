"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import type * as React from "react";

import { cn } from "@/lib/utils";

function Switch({
  className,
  ...props
}: SwitchPrimitive.Root.Props & React.RefAttributes<HTMLElement>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer data-checked:bg-primary data-unchecked:bg-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-all outline-none focus-visible:ring-[3px] aria-invalid:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="bg-background data-checked:translate-x-4 data-unchecked:translate-x-0 pointer-events-none block size-4 rounded-full shadow-sm transition-transform"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
