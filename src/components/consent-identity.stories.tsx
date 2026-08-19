import type { Meta, StoryObj } from '@storybook/react'
import { ConsentIdentity, decideIdentityAction } from './consent-identity'

/**
 * ConsentIdentity renders NOTHING — it is the identify()/reset() reconciler
 * that converges a device's PostHog identity to the per-user consent fact.
 * The story exists to satisfy the every-component-has-a-story contract and
 * to document the decision table, which is the component's entire behavior.
 */
const meta: Meta<typeof ConsentIdentity> = {
  title: 'App/ConsentIdentity',
  component: ConsentIdentity,
  parameters: {
    docs: {
      description: {
        component:
          'Invisible reconciler. identify() only when analytics consent is granted; reset() only when this device is identified as the withdrawing user; anonymous devices are never reset.',
      },
    },
  },
}
export default meta

type Story = StoryObj<typeof ConsentIdentity>

export const DecisionTable: Story = {
  render: () => {
    const rows: Array<[string | undefined, boolean]> = [
      ['anon-device', true],
      ['user_1', true],
      ['user_1', false],
      ['anon-device', false],
      [undefined, false],
    ]
    return (
      <table className="text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="py-1 pr-6">distinct_id</th>
            <th className="py-1 pr-6">consent granted</th>
            <th className="py-1">action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([id, granted]) => (
            <tr key={`${id}-${granted}`} className="border-b border-border/50">
              <td className="py-1 pr-6 font-mono">{id ?? 'undefined'}</td>
              <td className="py-1 pr-6">{String(granted)}</td>
              <td className="py-1 font-mono">{decideIdentityAction(id, 'user_1', granted)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  },
}
