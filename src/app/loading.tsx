export default function Loading() {
  return (
    <main className="flex flex-1 items-center justify-center py-12" aria-busy="true">
      <div
        className="size-8 animate-spin rounded-full border-2 border-muted border-t-primary"
        role="status"
        aria-label="Loading"
      />
    </main>
  )
}
