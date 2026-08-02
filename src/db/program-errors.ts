/**
 * A caller tried to move a 'proposed' program through a normal lifecycle path.
 * The ONLY exits from 'proposed' are the owner's explicit adoptProgram /
 * declineProgram — the forced confirm ("we always force the user to confirm").
 *
 * Lives in its own module (not db/programs.ts) so the MCP layer's
 * `instanceof` check keeps a real class identity even in tests that mock
 * '@/db/programs'. Message is caller-safe; the MCP layer surfaces it verbatim
 * as a ToolError.
 */
export class ProposedProgramError extends Error {
  constructor(programId: string) {
    super(
      `Program ${programId} is a proposal — it must be adopted (adopt as draft or adopt & activate) or declined by the owner before any other status change or instantiation`,
    )
    this.name = 'ProposedProgramError'
  }
}

/**
 * The coach bridge tried to full-replace a program that is not its own
 * still-unadopted draft. Coach mutations through `upsert_program` are scoped
 * to rows with `authorActor = 'coach'` AND `status = 'proposed'` — owner
 * programs and adopted plans are reachable only through the approval-gated
 * patch tools ("we always force the user to confirm"). Same module/identity
 * rationale as ProposedProgramError above.
 */
export class NotCoachProposalError extends Error {
  constructor(programId: string) {
    super(
      `Program ${programId} is not a coach-drafted proposal — the coach may only replace its own still-proposed drafts; use the granular program patch tools (user-approved) for adopted or owner-authored programs`,
    )
    this.name = 'NotCoachProposalError'
  }
}

/**
 * A share link was requested for a program whose visibility is 'private'.
 * Minting is gated on visibility link|public so a private program can never
 * hold a live token — flipping visibility is the explicit first step. Same
 * module/identity rationale as ProposedProgramError above.
 */
export class NotSharableProgramError extends Error {
  constructor(programId: string) {
    super(
      `Program ${programId} is private — set its visibility to 'link' or 'public' before creating a share link`,
    )
    this.name = 'NotSharableProgramError'
  }
}

/**
 * A signed-in owner tried to adopt their own share link. Adopting your own
 * program would mint a proposal attributed to yourself — meaningless, and a
 * duplicate factory. The public page shows owners a "this is your program"
 * note instead; this error is the server-side backstop.
 */
export class OwnSharedProgramError extends Error {
  constructor() {
    super('This share link points at your own program — there is nothing to adopt')
    this.name = 'OwnSharedProgramError'
  }
}
