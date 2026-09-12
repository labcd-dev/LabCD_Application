import { useEffect, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { adminApi } from '../api/endpoints'
import type { CreditSettings } from '../api/types'
import { StatusMessage } from '../components/StatusMessage'
import { useAuth } from '../context/AuthContext'
import { btnPrimary, cardPanel, fieldCheckbox, fieldInput, fieldLabel } from '../lib/classes'

function num(value: number | string): string {
  return String(value)
}

export function AdminCreditsPage() {
  const { hasAction } = useAuth()
  const canManage = hasAction('admin:credits')
  const [settings, setSettings] = useState<CreditSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [newUserBonus, setNewUserBonus] = useState('100')
  const [referralInviter, setReferralInviter] = useState('100')
  const [referralInvitee, setReferralInvitee] = useState('50')
  const [dailyAllotment, setDailyAllotment] = useState('20')
  const [per1k, setPer1k] = useState('1')
  const [perMinute, setPerMinute] = useState('1')
  const [minCharge, setMinCharge] = useState('1')
  const [hardGate, setHardGate] = useState(true)

  const applySettings = (data: CreditSettings) => {
    setSettings(data)
    setNewUserBonus(num(data.new_user_bonus))
    setReferralInviter(num(data.referral_inviter_bonus))
    setReferralInvitee(num(data.referral_invitee_bonus))
    setDailyAllotment(num(data.daily_allotment))
    setPer1k(num(data.per_1k_tokens))
    setPerMinute(num(data.per_minute))
    setMinCharge(num(data.min_job_charge))
    setHardGate(data.hard_gate_enabled)
  }

  useEffect(() => {
    if (!canManage) return
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        applySettings(await adminApi.getCreditSettings())
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load credit settings')
      } finally {
        setLoading(false)
      }
    })()
  }, [canManage])

  if (!canManage) {
    return <Navigate to="/admin" replace />
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const updated = await adminApi.updateCreditSettings({
        new_user_bonus: Number(newUserBonus),
        referral_inviter_bonus: Number(referralInviter),
        referral_invitee_bonus: Number(referralInvitee),
        daily_allotment: Number(dailyAllotment),
        per_1k_tokens: Number(per1k),
        per_minute: Number(perMinute),
        min_job_charge: Number(minCharge),
        hard_gate_enabled: hardGate,
      })
      applySettings(updated)
      setMessage('Credit settings saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="m-0 text-2xl font-semibold text-foreground">Credits</h1>
        <p className="mt-1 mb-0 text-sm text-muted-text">
          Configure bonuses, daily allotment, usage rates, and hard gating. Values apply to
          new grants and future job charges.
        </p>
      </header>

      {error && <StatusMessage type="error" message={error} />}
      {message && <StatusMessage type="success" message={message} />}

      {loading && !settings ? (
        <p className="m-0 text-sm text-muted-text">Loading…</p>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)} className={`${cardPanel} max-w-xl space-y-3`}>
          <label className={fieldLabel}>
            <span>New-user bonus</span>
            <input
              className={fieldInput}
              type="number"
              min={0}
              step="0.01"
              value={newUserBonus}
              onChange={(e) => setNewUserBonus(e.target.value)}
              required
            />
          </label>
          <label className={fieldLabel}>
            <span>Referral inviter bonus</span>
            <input
              className={fieldInput}
              type="number"
              min={0}
              step="0.01"
              value={referralInviter}
              onChange={(e) => setReferralInviter(e.target.value)}
              required
            />
          </label>
          <label className={fieldLabel}>
            <span>Referral invitee bonus</span>
            <input
              className={fieldInput}
              type="number"
              min={0}
              step="0.01"
              value={referralInvitee}
              onChange={(e) => setReferralInvitee(e.target.value)}
              required
            />
          </label>
          <label className={fieldLabel}>
            <span>Daily allotment (UTC, non-rollover)</span>
            <input
              className={fieldInput}
              type="number"
              min={0}
              step="0.01"
              value={dailyAllotment}
              onChange={(e) => setDailyAllotment(e.target.value)}
              required
            />
          </label>
          <label className={fieldLabel}>
            <span>Credits per 1k tokens</span>
            <input
              className={fieldInput}
              type="number"
              min={0}
              step="0.01"
              value={per1k}
              onChange={(e) => setPer1k(e.target.value)}
              required
            />
          </label>
          <label className={fieldLabel}>
            <span>Credits per minute</span>
            <input
              className={fieldInput}
              type="number"
              min={0}
              step="0.01"
              value={perMinute}
              onChange={(e) => setPerMinute(e.target.value)}
              required
            />
          </label>
          <label className={fieldLabel}>
            <span>Minimum charge per job</span>
            <input
              className={fieldInput}
              type="number"
              min={0}
              step="0.01"
              value={minCharge}
              onChange={(e) => setMinCharge(e.target.value)}
              required
            />
          </label>
          <label className={`${fieldCheckbox} gap-2`}>
            <input
              type="checkbox"
              checked={hardGate}
              onChange={(e) => setHardGate(e.target.checked)}
            />
            <span>Hard gate (block new jobs when balance ≤ 0)</span>
          </label>
          <button type="submit" className={btnPrimary} disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </form>
      )}
    </div>
  )
}
