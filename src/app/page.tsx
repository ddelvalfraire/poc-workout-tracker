import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { requireUserId } from "@/lib/auth";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function HomePage() {
  await requireUserId(); // middleware also guards; this is defense-in-depth

  return (
    <main className="mx-auto w-full max-w-md p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Workout Tracker</h1>
        <UserButton />
      </header>
      <Link href="/workout/new" className={cn(buttonVariants(), "mt-8 w-full")}>
        + Start Workout
      </Link>
      <p className="mt-4 text-sm text-muted-foreground">History — coming soon.</p>
    </main>
  );
}
