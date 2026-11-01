import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { BudgetsEditor } from '@/components/cost/Budgets'
import { call, useSaveSettings, useSettings } from '@/lib/queries'
import { Row } from '../parts'

export function BudgetsSection() {
  const settings = useSettings().data
  const save = useSaveSettings()
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Budgets</CardTitle>
          <CardDescription>
            Spending caps for the day and each project. They warn at the warning percentage. The same editor sits on the Usage tab.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BudgetsEditor />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Claude plan limits</CardTitle>
          <CardDescription>
            Shows how much of your 5-hour and weekly Claude plan limits is used. To read them, Foreman sends the login token that Claude Code keeps on this computer to Anthropic
            (api.anthropic.com). Anthropic's terms may not allow other apps to use that login, so this is off until you turn it on.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Row label="Read my Claude plan limits" info="Off by default. When on, Foreman asks Anthropic for your plan limits every few minutes with your Claude Code login token. The token is never saved or logged by Foreman." htmlFor="plan-usage">
            <Switch
              id="plan-usage"
              checked={settings?.claudePlanUsage ?? false}
              disabled={!settings}
              onCheckedChange={(v) => save.mutate({ claudePlanUsage: v }, { onSuccess: () => void call('providers:refresh').catch(() => undefined) })}
            />
          </Row>
        </CardContent>
      </Card>
    </>
  )
}
