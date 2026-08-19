/**
 * Storybook stand-in for `@clerk/nextjs`.
 *
 * `NavDrawer` renders `<UserButton />`, which throws outside a
 * `<ClerkProvider>`: "UserButton can only be used within the <ClerkProvider />
 * component." Wrapping the preview in a real provider would mean shipping a
 * publishable key and a network round-trip to render a component catalog, so
 * the specifier is aliased here instead (see `.storybook/main.ts`).
 *
 * The stub renders the same 28px circular avatar Clerk lays out, so the
 * drawer's footer row keeps its real geometry — a placeholder that changes the
 * layout is worse than no placeholder.
 */
import type { ReactNode } from "react";

/** Clerk's avatar button, at Clerk's own size. */
export function UserButton() {
  return (
    <span
      aria-label="Account (Storybook stand-in for Clerk's UserButton)"
      role="img"
      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
    >
      DD
    </span>
  );
}

export function ClerkProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function SignedIn({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function SignedOut(props: { children: ReactNode }) {
  // Signed-out content never renders in the catalog: every story is an
  // authenticated view. `props` is accepted so the JSX type-checks.
  void props;
  return null;
}

export function SignOutButton({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}
