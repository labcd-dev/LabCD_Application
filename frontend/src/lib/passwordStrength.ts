/** Client-side password checks mirroring server policy (server remains authoritative). */

export const MIN_PASSWORD_LENGTH = 12

/** Small subset for quick client feedback; full list lives on the server. */
const CLIENT_COMMON = new Set(
  [
    'password',
    'password123',
    'password1234',
    '123456789012',
    'qwerty123456',
    'admin1234567',
    'welcome12345',
    'letmein12345',
    'iloveyou1234',
    'football1234',
    'baseball1234',
    'monkey123456',
    'dragon123456',
    'sunshine1234',
    'princess1234',
    'superman1234',
    'trustno11234',
    'changeme1234',
    'passw0rd1234',
    'abcdefg12345',
    'abcdefgh1234',
  ].map((p) => p.toLowerCase()),
)

export interface PasswordChecks {
  minLength: boolean
  hasLetter: boolean
  hasDigit: boolean
  notCommon: boolean
  notEmailOrName: boolean
}

export function evaluatePassword(
  password: string,
  opts?: { email?: string; displayName?: string | null },
): PasswordChecks {
  const lowered = password.toLowerCase()
  let notEmailOrName = true
  const email = opts?.email?.trim().toLowerCase()
  if (email) {
    const local = email.split('@')[0] ?? ''
    if (email && lowered.includes(email)) notEmailOrName = false
    if (local.length >= 3 && lowered.includes(local)) notEmailOrName = false
  }
  const name = opts?.displayName?.trim().toLowerCase()
  if (name && name.length >= 3 && lowered.includes(name)) notEmailOrName = false

  return {
    minLength: password.length >= MIN_PASSWORD_LENGTH,
    hasLetter: /[A-Za-z]/.test(password),
    hasDigit: /\d/.test(password),
    notCommon: !CLIENT_COMMON.has(lowered),
    notEmailOrName,
  }
}

export function passwordMeetsPolicy(
  password: string,
  opts?: { email?: string; displayName?: string | null },
): boolean {
  const c = evaluatePassword(password, opts)
  return c.minLength && c.hasLetter && c.hasDigit && c.notCommon && c.notEmailOrName
}

export function passwordPolicyError(
  password: string,
  opts?: { email?: string; displayName?: string | null },
): string | null {
  const c = evaluatePassword(password, opts)
  if (!c.minLength) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
  if (!c.hasLetter || !c.hasDigit) return 'Password must include both letters and numbers'
  if (!c.notCommon) return 'Password is too common; choose a stronger one'
  if (!c.notEmailOrName) return 'Password must not contain your email or display name'
  return null
}

export function passwordStrengthScore(checks: PasswordChecks): number {
  const parts = [
    checks.minLength,
    checks.hasLetter,
    checks.hasDigit,
    checks.notCommon,
    checks.notEmailOrName,
  ]
  return parts.filter(Boolean).length
}
