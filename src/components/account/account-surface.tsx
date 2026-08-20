import { useTranslations } from 'next-intl'
import { Section } from '@/components/ui/section'
import { DividerList, DividerRow } from '@/components/ui/divider-list'
import {
  countSignInMethods,
  providerLabel,
  type AccountOverview,
} from '@/lib/workos/account-model'

/**
 * The account surface's rows, split from the route so every state is
 * previewable without a live session.
 *
 * The states that matter here are ones the app cannot easily be driven into
 * on demand — MFA on, MFA required, an unverified email — because they
 * depend on WorkOS environment settings rather than on app data.
 * A presentational component with stories is the only honest way to review
 * that copy before shipping it.
 *
 * Zoned YOU → SIGNING IN → the terminal destructive row, which is where every
 * mature account surface puts deletion. Rows are read-only status for now:
 * each editor lands as its own drill-down, and a chevron only appears once it
 * has somewhere to go.
 */
export function AccountSurface({ account }: { account: AccountOverview }) {
  const t = useTranslations('Account')

  const name = [account.firstName, account.lastName].filter(Boolean).join(' ')
  const providers = account.connectedAccounts.map(providerLabel)
  const methodCount = countSignInMethods(account)

  return (
    <>
      <Section title={t('youZone')}>
        <DividerList className="mt-1">
          <ValueRow label={t('nameLabel')} hint={t('nameHint')}>
            {name || <Muted>{t('valueNotSet')}</Muted>}
          </ValueRow>
          <ValueRow
            label={t('emailLabel')}
            hint={account.emailVerified ? t('emailHintVerified') : t('emailHintUnverified')}
          >
            <span className="truncate">{account.email}</span>
          </ValueRow>
        </DividerList>
      </Section>

      <Section title={t('signingInZone')}>
        <DividerList className="mt-1">
          <ValueRow
            label={t('connectedAccountsLabel')}
            hint={
              methodCount === 1
                ? t('connectedAccountsHintSoleMethod')
                : t('connectedAccountsHintMultiple')
            }
          >
            {providers.length > 0 ? (
              providers.join(', ')
            ) : (
              <Muted>{t('connectedAccountsNone')}</Muted>
            )}
          </ValueRow>

          {/* Omitted entirely — not disabled — where MFA is off for the
              environment: a dead control the user could never enable would
              leak deployment state and promise something we cannot keep. */}
          {account.mfaAvailable && (
            <DividerRow
              href="/settings/account/mfa"
              trailing={
                <span className="text-sm">
                  {account.hasMfaFactor ? t('mfaStateOn') : <Muted>{t('mfaStateOff')}</Muted>}
                </span>
              }
            >
              <div className="min-w-0">
                <p className="font-medium">{t('mfaLabel')}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {account.mfaRequired ? t('mfaHintRequired') : t('mfaHintOptional')}
                </p>
              </div>
            </DividerRow>
          )}
        </DividerList>
      </Section>

      {/* Terminal and separated. The consequences and the type-to-confirm
          gate live on the destination, which stays exactly as shipped — this
          only moves where it is entered from. */}
      <Section title={t('dangerZone')} className="mt-10">
        <DividerList className="mt-1">
          <DividerRow href="/settings/delete-account">
            <div className="min-w-0">
              <p className="font-medium text-destructive">{t('deleteLabel')}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{t('deleteHint')}</p>
            </div>
          </DividerRow>
        </DividerList>
      </Section>
    </>
  )
}

/** A read-only status row: label + hint left, current value right. */
function ValueRow({
  label,
  hint,
  children,
}: {
  label: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <li className="flex items-center justify-between gap-4 py-4">
      <div className="min-w-0">
        <p className="font-medium">{label}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>
      </div>
      <div className="min-w-0 shrink-0 text-sm">{children}</div>
    </li>
  )
}

/** Absent values speak in the muted ink — words, never a chip. */
function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>
}
