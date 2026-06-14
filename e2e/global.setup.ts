import { test as setup } from '@playwright/test'
import { clerkSetup } from '@clerk/testing/playwright'

// Fetches a Clerk Testing Token (using CLERK_SECRET_KEY) so the browser sign-in
// flow bypasses bot protection. Runs once before the chromium project.
setup('clerk setup', async () => {
  await clerkSetup({
    publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  })
})
