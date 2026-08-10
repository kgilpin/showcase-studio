import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PhoneFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <div
        aria-hidden
        className="scene-glow absolute -inset-10 rounded-[999px] bg-[var(--gradient-accent)] opacity-60 blur-[70px]"
      />
      <div
        className="relative aspect-[9/19.5] w-full overflow-hidden rounded-[2.6rem] border border-border bg-card p-[6px]"
        style={{ boxShadow: "var(--shadow-device)" }}
      >
        <div className="relative h-full w-full overflow-hidden rounded-[2.2rem] bg-background">
          {children}
        </div>
      </div>
    </div>
  );
}
