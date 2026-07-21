'use client'

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useChat } from '@ai-sdk/react'
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type DynamicToolUIPart,
  type ToolUIPart,
  type UIMessage,
  type UIMessagePart,
  type UIDataTypes,
  type UITools,
} from 'ai'
import Link from 'next/link'
import { ArrowUp, RotateCcw } from 'lucide-react'
import { Streamdown } from 'streamdown'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  extractProgramProposal,
  formatToolInput,
  humanizeToolName,
  isPinnedToBottom,
  parseCoachError,
  toolInputDetail,
  toolStatusLabel,
  type ProgramProposal,
} from '@/lib/coach/chat-ui'

const EXAMPLE_PROMPTS = [
  'What did I train this week?',
  "Swap tomorrow's pressing for more volume",
  'Preview next week',
]

/** Both static (`tool-*`) and dynamic tool parts, under one roof. */
type AnyToolPart = ToolUIPart | DynamicToolUIPart

function isToolPart(part: UIMessagePart<UIDataTypes, UITools>): part is AnyToolPart {
  return part.type === 'dynamic-tool' || part.type.startsWith('tool-')
}

function toolPartName(part: AnyToolPart): string {
  return part.type === 'dynamic-tool' ? part.toolName : part.type.slice('tool-'.length)
}

/** navigator.onLine as reactive state (true during SSR — no offline flash). */
function useOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener('online', onChange)
      window.addEventListener('offline', onChange)
      return () => {
        window.removeEventListener('online', onChange)
        window.removeEventListener('offline', onChange)
      }
    },
    () => navigator.onLine,
    () => true,
  )
}

/** Compact one-line "the coach did X" status line for auto-running tool
 *  calls — deliberately not a bubble: quiet dot + text, no border/card. */
function ToolChip({ part }: { part: AnyToolPart }) {
  const name = toolPartName(part)
  // Auto-approved calls (approval-requested with isAutomatic) are still
  // in-flight from the user's perspective, so they read as running too.
  const running =
    part.state === 'input-streaming' ||
    part.state === 'input-available' ||
    part.state === 'approval-requested'
  const failed = part.state === 'output-error'
  const detail = toolInputDetail(name, part.input)
  return (
    <p
      className={cn(
        'flex items-center gap-2 text-xs text-muted-foreground',
        failed && 'text-destructive',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          running
            ? 'bg-primary motion-safe:animate-pulse'
            : failed
              ? 'bg-destructive'
              : 'bg-muted-foreground/50',
        )}
      />
      <span className="min-w-0 truncate">
        {toolStatusLabel(name, failed ? 'failed' : running ? 'running' : 'done')}
        {running ? '…' : ''}
        {detail && <span className="text-muted-foreground/70"> · ‘{detail}’</span>}
        {failed ? ' — failed' : ''}
      </span>
    </p>
  )
}

/**
 * Confirm card for program-patch tools: the server marks them
 * `user-approval`, so the stream parks at `approval-requested` until the
 * user answers via addToolApprovalResponse.
 */
function ApprovalCard({
  part,
  onRespond,
  disabled,
}: {
  part: AnyToolPart & { state: 'approval-requested' }
  onRespond: (approvalId: string, approved: boolean) => void
  disabled: boolean
}) {
  const name = toolPartName(part)
  const args = formatToolInput(part.input)
  return (
    <div className="rounded-2xl border border-primary/40 bg-card p-4">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">
        Needs your OK
      </p>
      <p className="mt-1 font-display text-lg uppercase leading-tight tracking-wide">
        {humanizeToolName(name)}
      </p>
      {args && (
        <pre className="mt-2 overflow-x-auto font-mono text-xs break-all whitespace-pre-wrap text-muted-foreground">
          {args}
        </pre>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => onRespond(part.approval.id, false)}
        >
          Cancel
        </Button>
        {/* The approval Apply is a live state, not the page's volt CTA — it
            borrows the primary variant only while a decision is pending. */}
        <Button size="sm" disabled={disabled} onClick={() => onRespond(part.approval.id, true)}>
          Apply
        </Button>
      </div>
    </div>
  )
}

/**
 * Result card for a coach-drafted program proposal: the drafting tool ran
 * (no chat approval — creation lands as 'proposed'), so the card's only job
 * is routing the user to the program page where the REAL confirm (Adopt /
 * Decline, owner-only) lives.
 */
function ProposalCard({ proposal }: { proposal: ProgramProposal }) {
  const meta = [
    `${proposal.dayCount} ${proposal.dayCount === 1 ? 'day' : 'days'}/week`,
    proposal.weekCount !== null
      ? `${proposal.weekCount} ${proposal.weekCount === 1 ? 'week' : 'weeks'}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <div className="rounded-2xl border border-primary/40 bg-card p-4">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">
        Proposed program
      </p>
      <p className="mt-1 font-display text-lg uppercase leading-tight tracking-wide">
        {proposal.icon ? `${proposal.icon} ` : ''}
        {proposal.name}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{meta}</p>
      {proposal.description && (
        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{proposal.description}</p>
      )}
      <Link
        href={`/programs/${proposal.programId}`}
        className={cn(buttonVariants({ size: 'sm' }), 'mt-3 w-full rounded-xl')}
      >
        Review &amp; adopt
      </Link>
    </div>
  )
}

/** A tool part in any state → chip, approval card, or outcome line. */
function ToolPartView({
  part,
  onRespond,
  responding,
}: {
  part: AnyToolPart
  onRespond: (approvalId: string, approved: boolean) => void
  responding: boolean
}) {
  const name = toolPartName(part)
  switch (part.state) {
    case 'approval-requested':
      if (part.approval.isAutomatic) return <ToolChip part={part} />
      return (
        <ApprovalCard
          part={part as AnyToolPart & { state: 'approval-requested' }}
          onRespond={onRespond}
          disabled={responding}
        />
      )
    case 'approval-responded':
      return (
        <p className="text-xs text-muted-foreground">
          {humanizeToolName(name)} — {part.approval.approved ? 'applying…' : 'cancelled'}
        </p>
      )
    case 'output-denied':
      return <p className="text-xs text-muted-foreground">{humanizeToolName(name)} — cancelled</p>
    case 'output-available': {
      // A completed draft (create OR revision of a still-proposed draft)
      // becomes the proposal card; anything unverifiable degrades to the chip.
      if (name === 'upsert_program') {
        const proposal = extractProgramProposal(part.input, part.output)
        if (proposal) return <ProposalCard proposal={proposal} />
      }
      return <ToolChip part={part} />
    }
    default:
      return <ToolChip part={part} />
  }
}

interface CoachChatProps {
  /** Optional app context (e.g. "program:<id>") forwarded in the POST body. */
  context?: string
  /** The persisted thread, loaded server-side — seeds the chat on mount. */
  initialMessages?: UIMessage[]
  /** Server action dropping the persisted thread ("New chat"). */
  clearAction?: () => Promise<void>
}

export function CoachChat({ context, initialMessages, clearAction }: CoachChatProps) {
  const [input, setInput] = useState('')
  const online = useOnline()
  const bottomRef = useRef<HTMLDivElement>(null)

  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: '/api/chat',
        // Server-authoritative thread: POST only the tail message (the fresh
        // user message, or the assistant message updated with approval
        // responses). The full array carries every tool input/output and
        // outgrows the request caps after tool-heavy turns; the server
        // reconciles the tail against its stored copy instead.
        prepareSendMessagesRequest: ({ messages: outgoing }) => ({
          body: {
            message: outgoing[outgoing.length - 1],
            ...(context ? { context } : {}),
          },
        }),
      }),
    [context],
  )

  const { messages, setMessages, sendMessage, status, error, addToolApprovalResponse, clearError } =
    useChat({
    transport,
    // The persisted thread (server-loaded) — mount-time seed only; the hook
    // owns the array from here.
    messages: initialMessages,
    // Continue the turn automatically once every pending approval is
    // answered — without this the stream would just sit after Apply/Cancel.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  })

  // An unanswered (human) approval also counts as busy: the stream parks at
  // approval-requested with status back at 'ready', and sending a fresh
  // message then would strand an assistant tool call with no response —
  // exactly the transcript shape the model round-trip rejects. Also keeps
  // the one-volt rule honest: Apply owns the volt while a card is up.
  const pendingApproval = messages.some((message) =>
    message.parts.some(
      (part) =>
        isToolPart(part) && part.state === 'approval-requested' && !part.approval?.isAutomatic,
    ),
  )
  const busy = status === 'submitted' || status === 'streaming' || pendingApproval

  // Whether the user is currently at (or near) the bottom of the page.
  // A window scroll listener rather than an IntersectionObserver on the
  // sentinel: pinned-ness must only change when scrolling happens — content
  // growth moves the sentinel out of view WITHOUT a scroll event, and an
  // observer would race the follow-scroll below and unpin mid-stream.
  // A ref, not state: pinned-ness must not trigger renders.
  const pinnedRef = useRef(true)
  useEffect(() => {
    const onScroll = () => {
      pinnedRef.current = isPinnedToBottom(
        document.documentElement.scrollHeight,
        window.innerHeight,
        window.scrollY,
      )
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Follow the stream only while pinned — a user who scrolled up to re-read
  // stays put (this was the "screen jumps up and down" bug: every chunk and
  // tool-part height change yanked the viewport back down). Instant, not
  // smooth: per-token smooth scrolling is its own jank.
  useEffect(() => {
    if (pinnedRef.current) bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, status])

  const coachError = error ? parseCoachError(error) : null
  const offline = !online || coachError?.kind === 'offline'

  const submit = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || busy || offline) return
    clearError()
    // Sending always re-pins: the user asked a question, show the answer.
    pinnedRef.current = true
    void sendMessage({ text: trimmed })
    setInput('')
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }

  return (
    <>
      <main className="mx-auto w-full max-w-md flex-1 px-5">
        {messages.length === 0 ? (
          /* Empty state: what the coach is for, plus tappable starters. */
          <div className="flex min-h-[60dvh] flex-col justify-center">
            <h2 className="font-display text-2xl uppercase leading-none tracking-wide">
              Ask your coach
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              It can read your workouts and programs, and propose plan changes — nothing is applied
              without your OK.
            </p>
            <div className="mt-6 space-y-2">
              {EXAMPLE_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => submit(prompt)}
                  disabled={busy || offline}
                  className="w-full rounded-2xl border border-border bg-card p-4 text-left text-sm transition-colors active:bg-muted/60 disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            {clearAction && (
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  disabled={busy}
                  onClick={async () => {
                    clearError()
                    await clearAction()
                    setMessages([])
                  }}
                >
                  <RotateCcw aria-hidden="true" className="size-3.5" />
                  New chat
                </Button>
              </div>
            )}
            {messages.map((message) => (
              <div key={message.id} className="space-y-2">
                {message.parts.map((part, index) => {
                  if (part.type === 'text') {
                    if (!part.text) return null
                    return message.role === 'user' ? (
                      <p
                        key={index}
                        className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-primary/15 px-4 py-2.5 text-sm whitespace-pre-wrap"
                      >
                        {part.text}
                      </p>
                    ) : (
                      <div
                        key={index}
                        className="w-fit max-w-[92%] rounded-2xl rounded-bl-md border border-border bg-card px-4 py-2.5 text-sm"
                      >
                        {/* Streaming-aware markdown (tables, lists, code) —
                            the coach quotes numbers and set schemes, and raw
                            asterisks read as bugs. */}
                        <Streamdown>{part.text}</Streamdown>
                      </div>
                    )
                  }
                  if (isToolPart(part)) {
                    return (
                      <ToolPartView
                        key={part.toolCallId}
                        part={part}
                        responding={busy}
                        onRespond={(approvalId, approved) =>
                          addToolApprovalResponse({ id: approvalId, approved })
                        }
                      />
                    )
                  }
                  return null
                })}
              </div>
            ))}

            {/* Streaming indicator: same live voice as the in-progress cards. */}
            {status === 'submitted' && (
              <p className="flex items-center gap-2 text-xs font-semibold tracking-widest uppercase text-primary">
                <span aria-hidden="true" className="relative flex size-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-60 motion-safe:animate-ping" />
                  <span className="relative inline-flex size-2 rounded-full bg-primary" />
                </span>
                Thinking
              </p>
            )}
          </div>
        )}

        <div ref={bottomRef} />
      </main>

      {/* Bottom-anchored composer, same surface treatment as the app bar. */}
      <div className="sticky bottom-0 border-t border-border bg-background/80 px-safe pb-safe backdrop-blur-md">
        <div className="mx-auto w-full max-w-md px-5 py-3">
          {offline ? (
            <p role="status" className="pb-2 text-center text-sm text-warning">
              Coach needs a connection.
            </p>
          ) : (
            coachError && (
              <p role="alert" className="pb-2 text-center text-sm text-destructive">
                {coachError.message}
              </p>
            )
          )}
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              submit(input)
            }}
          >
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about your training…"
              aria-label="Message the coach"
              autoComplete="off"
              enterKeyHint="send"
              className="h-11 min-w-0 flex-1 rounded-2xl border border-input bg-card px-4 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            {/* The page's one volt button. */}
            <Button
              type="submit"
              size="icon"
              aria-label="Send"
              disabled={busy || offline || !input.trim()}
              className="rounded-2xl"
            >
              <ArrowUp aria-hidden="true" className="size-5" />
            </Button>
          </form>
        </div>
      </div>
    </>
  )
}
