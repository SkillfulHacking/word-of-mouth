import type { CSSProperties, ReactNode } from "react";
import { themeVars } from "@/lib/themes";

/** Restyles just this block in an event's theme, so several events can sit side by side on one page. */
export function ThemeScope({ theme, children, className = "", style }: { theme: string; children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={`theme-scope ${className}`} style={{ ...(themeVars(theme) as CSSProperties), ...style }}>
      {children}
    </div>
  );
}
