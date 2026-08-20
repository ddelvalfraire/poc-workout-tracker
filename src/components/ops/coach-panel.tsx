import type { OpsResult } from '@/lib/ops/types'
import type { LangfuseSnapshot, LangfuseTracesSnapshot } from '@/lib/ops/langfuse'
import { shortDayLabel, timeAgo } from '@/lib/ops/time'
import { fillDailySeries } from '@/lib/ops/series'
import { OpsPanel, statusOf } from './panel'
import { CoachChart, type CoachChartPoint } from './coach-chart'
import { useTranslations } from 'next-intl'

/**
 * Coach panel: "what is the coach doing and costing?" — 14-day traces/cost
 * composite chart over a recent-generations table (time, name, model,
 * latency, tokens, cost). Daily metrics and the traces list are separate
 * Langfuse calls; the table degrades to a note when only it fails.
 */

const CHART_WINDOW_DAYS = 14

/** Vendor deep link and the locale the ops board formats numbers in — both
 *  identifiers, not copy. */
const LANGFUSE_DASHBOARD_URL = 'https://cloud.langfuse.com/'
const NUMBER_LOCALE = 'en-US'

interface CoachPanelProps {
  daily: OpsResult<LangfuseSnapshot>
  traces: OpsResult<LangfuseTracesSnapshot>
  className?: string
}

/** Builds dense chart points from Langfuse's sparse newest-first days. */
function chartPoints(snapshot: LangfuseSnapshot): CoachChartPoint[] {
  const traceRows = snapshot.days.map((d) => ({ day: d.date, value: d.traces }))
  const costRows = snapshot.days.map((d) => ({ day: d.date, value: d.totalCost }))
  const traceSeries = fillDailySeries(traceRows, CHART_WINDOW_DAYS)
  const costSeries = fillDailySeries(costRows, CHART_WINDOW_DAYS)
  return traceSeries.map((point, i) => ({
    label: shortDayLabel(point.day),
    traces: point.value,
    cost: Math.round((costSeries[i]?.value ?? 0) * 10_000) / 10_000,
  }))
}

const timeFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'UTC',
})

export function CoachPanel({ daily, traces, className }: CoachPanelProps) {
  const t = useTranslations('CoachPanel')
  return (
    <OpsPanel
      id="coach"
      title={t('title')}
      status={statusOf(daily)}
      staleAt={daily.ok ? daily.staleAt : undefined}
      envVar="LANGFUSE_PUBLIC_KEY"
      link={{ href: LANGFUSE_DASHBOARD_URL, label: t('linkLabel') }}
      className={className}
    >
      {daily.ok && (
        <>
          <dl className="flex flex-wrap gap-x-8 gap-y-2">
            <Headline label={t('traces14dLabel')} value={String(daily.data.totalTraces)} />
            <Headline
              label={t('cost14dLabel')}
              value={t('costAmount', { amount: daily.data.totalCost.toFixed(2) })}
            />
            <Headline
              label={t('cost7dLabel')}
              value={t('costAmount', { amount: daily.data.totalCost7d.toFixed(2) })}
            />
          </dl>

          <div className="mt-4">
            <CoachChart points={chartPoints(daily.data)} />
          </div>

          <section aria-label={t('generationsLabel')} className="mt-5">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {t('generationsTitle')}
            </h3>
            {!traces.ok ? (
              <p className="mt-2 text-sm text-muted-foreground">
                {t('tracesUnavailable')}
              </p>
            ) : traces.data.traces.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">{t('empty')}</p>
            ) : (
              <div
                /* A horizontally scrolling region must be reachable by keyboard:
                   without tabindex a keyboard user cannot scroll it at all. */
                tabIndex={0}
                className="mt-2 overflow-x-auto"
              >
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="pb-2 pr-3 font-medium">{t('column.time')}</th>
                      <th className="pb-2 pr-3 font-medium">{t('column.name')}</th>
                      <th className="pb-2 pr-3 font-medium">{t('column.model')}</th>
                      <th className="pb-2 pr-3 text-right font-medium">{t('column.latency')}</th>
                      <th className="pb-2 pr-3 text-right font-medium">{t('column.tokens')}</th>
                      <th className="pb-2 text-right font-medium">{t('column.cost')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {traces.data.traces.map((trace) => (
                      <tr key={`${trace.time}-${trace.name}`}>
                        <td
                          className="whitespace-nowrap py-1.5 pr-3 text-xs text-muted-foreground"
                          title={timeAgo(trace.time)}
                        >
                          {timeFmt.format(new Date(trace.time))}
                        </td>
                        <td className="max-w-0 truncate py-1.5 pr-3 font-medium">{trace.name}</td>
                        <td className="max-w-0 truncate py-1.5 pr-3 text-xs text-muted-foreground">
                          {trace.model ?? '—'}
                        </td>
                        <td className="whitespace-nowrap py-1.5 pr-3 text-right text-xs tnum">
                          {trace.latencyMs !== null
                            ? t('latencyValue', { seconds: (trace.latencyMs / 1000).toFixed(1) })
                            : '—'}
                        </td>
                        <td className="whitespace-nowrap py-1.5 pr-3 text-right text-xs tnum">
                          {trace.tokens.toLocaleString(NUMBER_LOCALE)}
                        </td>
                        <td className="whitespace-nowrap py-1.5 text-right text-xs tnum">
                          {t('costAmount', { amount: trace.totalCost.toFixed(4) })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </OpsPanel>
  )
}

/** One headline stat in the panel's top row. */
function Headline({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-2xl font-semibold leading-none tnum">{value}</dd>
    </div>
  )
}
