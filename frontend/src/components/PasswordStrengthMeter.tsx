import {
  evaluatePassword,
  passwordStrengthScore,
  type PasswordChecks,
} from '../lib/passwordStrength'

const CHECK_LABELS: { key: keyof PasswordChecks; label: string }[] = [
  { key: 'minLength', label: 'At least 12 characters' },
  { key: 'hasLetter', label: 'Includes a letter' },
  { key: 'hasDigit', label: 'Includes a number' },
  { key: 'notCommon', label: 'Not a common password' },
  { key: 'notEmailOrName', label: 'Does not contain email or name' },
]

interface PasswordStrengthMeterProps {
  password: string
  email?: string
  displayName?: string | null
}

export function PasswordStrengthMeter({
  password,
  email,
  displayName,
}: PasswordStrengthMeterProps) {
  if (!password) return null

  const checks = evaluatePassword(password, { email, displayName })
  const score = passwordStrengthScore(checks)
  const pct = (score / CHECK_LABELS.length) * 100
  const tone =
    score <= 2 ? 'bg-[var(--app-status-danger-text)]' : score <= 4 ? 'bg-amber-500' : 'bg-[var(--app-status-success-text)]'

  return (
    <div className="space-y-2 pt-1">
      <div
        className="h-1.5 overflow-hidden rounded-full bg-surface-muted"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={CHECK_LABELS.length}
        aria-valuenow={score}
        aria-label="Password strength"
      >
        <div className={`h-full transition-all ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <ul className="m-0 list-none space-y-0.5 p-0 text-xs text-muted-text">
        {CHECK_LABELS.map(({ key, label }) => (
          <li key={key} className={checks[key] ? 'text-[var(--app-status-success-text)]' : undefined}>
            {checks[key] ? '✓' : '○'} {label}
          </li>
        ))}
      </ul>
    </div>
  )
}
