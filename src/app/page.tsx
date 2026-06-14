import { UserButton } from "@clerk/nextjs";
import { requireUserId } from "@/lib/auth";

export default async function HomePage() {
  await requireUserId(); // middleware also guards; this is defense-in-depth

  return (
    <main className="mx-auto w-full max-w-md p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Workout Tracker</h1>
        <UserButton />
      </header>
      <p className="mt-8 text-sm text-muted-foreground">
        Start Workout and History land in the next phases.
      </p>
    </main>
  );
}
