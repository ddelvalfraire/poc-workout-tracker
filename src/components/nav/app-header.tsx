import type { ReactNode } from "react";

interface AppHeaderProps {
  title: ReactNode;
  /** Leading slot, e.g. a back link. */
  leading?: ReactNode;
  /** Trailing slot, e.g. a cancel link or account button. */
  trailing?: ReactNode;
}

/**
 * Sticky top app bar — the native nav-bar pattern. Pads for the status-bar
 * safe area in standalone mode and keeps a translucent surface as content
 * scrolls under it. Title uses the display font (via the h1 base rule).
 */
export function AppHeader({ title, leading, trailing }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/80 px-safe pt-safe backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-md items-center gap-2 px-5">
        {leading}
        <h1 className="min-w-0 flex-1 truncate text-xl uppercase tracking-tight">{title}</h1>
        {trailing}
      </div>
    </header>
  );
}
