'use client'

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
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
import { CoachMarkdown } from './coach-markdown'
import { AppHeader } from '@/components/app-header'
import { CoachDisclosure } from './coach-disclosure'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  chipsFor,
  daySeparatorMessage,
  extractProgramProposal,
  formatToolInput,
  humanizeToolName,
  isPinnedToBottom,
  messageTimestamp,
  parseCoachError,
  starterPrompts,
  toolInputDetail,
  toolStatusMessage,
  type ProgramProposal,
} from '@/lib/coach/chat-ui'
import { describeToolCall } from '@/lib/coach/describe-tool-call'
import { renderToolCall } from '@/lib/coach/render-tool-call'
import { renderLine } from '@/lib/message'
import { useTranslations } from 'next-intl'

/** Both static (`tool-*`) and dynamic tool parts, under one roof. */
type AnyToolPart = ToolUIPart | DynamicToolUIPart

function isToolPart(part: UIMessagePart<UIDataTypes, UITools>): part is AnyToolPart {
  return part.type === 'dynamic-tool' || part.type.startsWith('tool-')
}

function toolPartName(part: AnyToolPart): string {
  return part.type === 'dynamic-tool' ? part.toolName : part.type.slice('tool-'.length)
}

/** Outgoing user message stamped with the send time — the client half of the
 *  day-separator timestamps (the server stamps assistant messages). Module
 *  scope: the stamp happens at send time, outside render. */
function stampedUserMessage(text: string): { text: string; metadata: { createdAt: number } } {
  return { text, metadata: { createdAt: Date.now() } }
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
  const t = useTranslations('CoachChat')
  const name = toolPartName(part)
  // Auto-approved calls (approval-requested with isAutomatic) are still
  // in-flight from the user's perspective, so they read as running too.
  const running =
    part.state === 'input-streaming' ||
    part.state === 'input-available' ||
    part.state === 'approval-requested'
  const failed = part.state === 'output-error'
  const detail = toolInputDetail(name, part.input)
  // No catalog phrase (unknown tool, or a failed call): the humanized
  // protocol identifier stands in — never raw snake_case, never invented copy.
  const status = toolStatusMessage(name, failed ? 'failed' : running ? 'running' : 'done')
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
        {status !== null ? t(status.key) : humanizeToolName(name)}
        {running ? '…' : ''}
        {detail && (
          <span className="text-muted-foreground/70"> {t('toolDetail', { detail })}</span>
        )}
        {failed ? t('toolFailed') : ''}
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
  const t = useTranslations('CoachChat')
  const tCommon = useTranslations('Common')
  const tTool = useTranslations('CoachToolCall')
  const name = toolPartName(part)
  const args = formatToolInput(part.input)
  return (
    <div className="rounded-2xl border border-primary/40 bg-card p-4">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">
        {t('pendingApprovalLabel')}
      </p>
      {/* The trust-critical line: a human sentence built from the tool input
          (describeToolCall), not the tool's name or raw JSON. Body text, not
          font-display — a change description is read, not shouted. */}
      <p className="mt-1 text-[15px] font-medium leading-snug">
        {renderToolCall(tTool, describeToolCall(name, part.input))}
      </p>
      {args && (
        /* The raw args, demoted: still one tap away for anyone who wants to
           verify the exact payload, never the headline. */
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground select-none">
            {t('detailsSummary')}
          </summary>
          <pre className="mt-1 overflow-x-auto font-mono text-xs break-all whitespace-pre-wrap text-muted-foreground">
            {args}
          </pre>
        </details>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => onRespond(part.approval.id, false)}
        >
          {tCommon('cancel')}
        </Button>
        {/* The approval Apply is a live state, not the page's volt CTA — it
            borrows the primary variant only while a decision is pending. */}
        <Button size="sm" disabled={disabled} onClick={() => onRespond(part.approval.id, true)}>
          {t('applyAction')}
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
  const t = useTranslations('CoachChat')
  const meta = [
    t('proposalDays', { days: proposal.dayCount }),
    proposal.weekCount !== null ? t('proposalWeeks', { weeks: proposal.weekCount }) : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <div className="rounded-2xl border border-primary/40 bg-card p-4">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">
        {t('proposalTitle')}
      </p>
      <p className="mt-1 font-display text-lg uppercase leading-tight tracking-wide">
        {proposal.icon ? `${proposal.icon} ` : ''}
        {proposal.name ?? t('proposalUntitled')}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{meta}</p>
      {proposal.description && (
        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{proposal.description}</p>
      )}
      <Link
        href={`/programs/${proposal.programId}`}
        className={cn(buttonVariants({ size: 'sm' }), 'mt-3 w-full rounded-xl')}
      >
        {t('reviewAction')}
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
  const t = useTranslations('CoachChat')
  const tTool = useTranslations('CoachToolCall')
  const name = toolPartName(part)
  const summary = () => renderToolCall(tTool, describeToolCall(name, part.input))
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
          {part.approval.approved
            ? t('approvalApplied', { tool: summary() })
            : t('approvalCancelled', { tool: summary() })}
        </p>
      )
    case 'output-denied':
      return (
        <p className="text-xs text-muted-foreground">
          {t('approvalCancelled', { tool: summary() })}
        </p>
      )
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
  /** Header leading slot (the nav drawer), passed through from the page. */
  leading?: ReactNode
  /** The context program's name (cheap server-side title read) — personalizes
   *  the empty-state starters; absent → generic examples. */
  programName?: string
  /** The persisted thread, loaded server-side — seeds the chat on mount. */
  initialMessages?: UIMessage[]
  /** Server action dropping the persisted thread ("New chat"). */
  clearAction?: () => Promise<void>
}

export function CoachChat({
  context,
  leading,
  programName,
  initialMessages,
  clearAction,
}: CoachChatProps) {
  const t = useTranslations('CoachChat')
  const [input, setInput] = useState('')
  const online = useOnline()
  const bottomRef = useRef<HTMLDivElement>(null)
  // "Now" for the day-separator labels, pinned at mount (render must stay
  // pure). Only staler-than-a-day labels would misread, and a chat left open
  // across midnight re-mounts long before that matters here.
  const [mountedAt] = useState(() => Date.now())

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
    void sendMessage(stampedUserMessage(trimmed))
    setInput('')
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }

  const starters = starterPrompts(programName)
  // Follow-up chips only for a settled turn: stream done, nothing awaiting
  // approval, no error banner competing for the same attention.
  const followUps =
    status === 'ready' && !pendingApproval && !error ? chipsFor(messages[messages.length - 1]) : []

  return (
    <>
      <AppHeader
        title={t('title')}
        leading={leading}
        trailing={
          clearAction && messages.length > 0 ? (
            /* "New chat" lives in the app bar, not the scroll — reachable at
               any thread length. */
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
              {t('newChatAction')}
            </Button>
          ) : undefined
        }
      />
      {/* Structural AI disclosure (Utah proactive tier): a quiet hairline
          strip on the surface itself — never per-message banners. The
          first-open interstitial below carries the full caveat once. */}
      <p className="border-b border-border px-5 py-1.5 text-center text-xs text-muted-foreground">
        {t('disclosureStrip')}
      </p>
      <CoachDisclosure />
      <main className="mx-auto w-full max-w-md flex-1 px-5">
        {messages.length === 0 ? (
          /* Empty state: what the coach is for, plus tappable starters. */
          <div className="flex min-h-[60dvh] flex-col justify-center">
            <h2 className="font-display text-2xl uppercase leading-none tracking-wide">
              {t('emptyTitle')}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {t('capabilityDescription')}
            </p>
            <div className="mt-6 space-y-2">
              {starters.map((starter) => {
                const prompt = renderLine(t, starter)
                return (
                <button
                  key={starter.key}
                  type="button"
                  onClick={() => submit(prompt)}
                  disabled={busy || offline}
                  className="w-full rounded-2xl border border-border bg-card p-4 text-left text-sm transition-colors active:bg-muted/60 disabled:opacity-50"
                >
                  {prompt}
                </button>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            {messages.map((message, messageIndex) => (
              <div key={message.id} className="space-y-2">
                {/* Calendar-day divider — only when messages carry createdAt
                    metadata (threads persisted before timestamps get none). */}
                {(() => {
                  const separator = daySeparatorMessage(
                    messageIndex === 0
                      ? null
                      : messageTimestamp(messages[messageIndex - 1].metadata),
                    messageTimestamp(message.metadata),
                    mountedAt,
                  )
                  return separator ? (
                    <p className="py-2 text-center text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                      {renderLine(t, separator)}
                    </p>
                  ) : null
                })()}
                {message.parts.map((part, index) => {
                  if (part.type === 'text') {
                    if (!part.text) return null
                    return message.role === 'user' ? (
                      <p
                        key={index}
                        /* Neutral surface, not volt: user bubbles are content,
                           and volt is reserved for action/achievement. */
                        className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-sm whitespace-pre-wrap"
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
                            asterisks read as bugs. Hardened wrapper, never
                            bare <Streamdown>: model output is untrusted (see
                            coach-markdown.tsx). */}
                        <CoachMarkdown>{part.text}</CoachMarkdown>
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

            {/* Contextual follow-ups for the settled turn — tapping one just
                sends it as the next user message. */}
            {followUps.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {followUps.map((followUp) => {
                  const chip = renderLine(t, followUp)
                  return (
                    <button
                      key={followUp.key}
                      type="button"
                      onClick={() => submit(chip)}
                      disabled={busy || offline}
                      className="rounded-full border border-border bg-card px-3.5 py-1.5 text-xs text-muted-foreground transition-colors active:bg-muted/60 disabled:opacity-50"
                    >
                      {chip}
                    </button>
                  )
                })}
              </div>
            )}

            {/* Streaming indicator: same live voice as the in-progress cards. */}
            {status === 'submitted' && (
              <p className="flex items-center gap-2 text-xs font-semibold tracking-widest uppercase text-primary">
                <span aria-hidden="true" className="relative flex size-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-60 motion-safe:animate-ping" />
                  <span className="relative inline-flex size-2 rounded-full bg-primary" />
                </span>
                {t('thinkingStatus')}
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
              {t('offlineNotice')}
            </p>
          ) : coachError?.kind === 'paywall' ? (
            // The free-taste is used up: the message is the sell, and the CTA
            // is the whole point — a plain error line would waste the moment.
            <p
              role="alert"
              className="flex flex-wrap items-center justify-center gap-2 pb-2 text-center text-sm"
            >
              <span className="text-muted-foreground">{coachError.message}</span>
              <Link href={coachError.upgrade} className="font-medium underline">
                {t('paywallCta')}
              </Link>
            </p>
          ) : (
            coachError && (
              <p role="alert" className="pb-2 text-center text-sm text-destructive">
                {/* The server's own message is text it authored (the 429
                    daily-cap copy especially) and renders verbatim; anything
                    unrecognised falls back to this surface's own line. */}
                {coachError.kind === 'server' ? coachError.message : t('errorGeneric')}
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
              placeholder={t('composerPlaceholder')}
              aria-label={t('composerLabel')}
              autoComplete="off"
              enterKeyHint="send"
              className="h-11 min-w-0 flex-1 rounded-2xl border border-input bg-card px-4 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden"
            />
            {/* The page's one volt button. */}
            <Button
              type="submit"
              size="icon"
              aria-label={t('sendLabel')}
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
