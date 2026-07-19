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
