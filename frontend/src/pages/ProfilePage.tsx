import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import {
  Camera,
  KeyRound,
  Monitor,
  Palette,
  Trash2,
  User,
  UserCircle,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '../api/endpoints'
import type { AuthSessionInfo } from '../api/types'
import { PasswordStrengthMeter } from '../components/PasswordStrengthMeter'
import { StatusMessage } from '../components/StatusMessage'
import { useAuth } from '../context/AuthContext'
import { useTheme, type ThemeMode } from '../context/ThemeContext'
import { btnBase, btnPrimary, fieldInput, fieldLabel } from '../lib/classes'
import { passwordMeetsPolicy, passwordPolicyError } from '../lib/passwordStrength'
import { getThemeOfDay } from '../lib/themeOfDay'

type ProfileSection = 'account' | 'photo' | 'appearance' | 'security' | 'devices' | 'about'

const SECTIONS: {
  id: ProfileSection
  label: string
  description: string
  icon: typeof User
}[] = [
  { id: 'account', label: 'Account', description: 'Name and email', icon: User },
  { id: 'photo', label: 'Photo', description: 'Profile picture', icon: Camera },
  { id: 'appearance', label: 'Appearance', description: 'Theme preference', icon: Palette },
  { id: 'security', label: 'Security', description: 'Change password', icon: KeyRound },
  { id: 'devices', label: 'Devices', description: 'Active sessions', icon: Monitor },
  { id: 'about', label: 'About', description: 'Account details', icon: UserCircle },
]

const THEME_OPTIONS: { value: ThemeMode; label: string; description: string }[] = [
  { value: 'light', label: 'Light', description: 'Always use the light theme' },
  { value: 'dark', label: 'Dark', description: 'Always use the dark theme' },
  { value: 'system', label: 'System', description: 'Match your device preference' },
  {
    value: 'theme_of_day',
    label: 'Theme of the day',
    description: `Dark base with today’s accent — ${getThemeOfDay().name}`,
  },
]

function themeDisplayLabel(theme: ThemeMode, dayName: string): string {
  if (theme === 'system') return 'System'
  if (theme === 'theme_of_day') return `Theme of the day · ${dayName}`
  if (theme === 'light') return 'Light'
  if (theme === 'dark') return 'Dark'
  return theme
}

function userInitials(user: { display_name: string | null; email: string }): string {
  const source = user.display_name?.trim() || user.email
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
  }
  return source.slice(0, 2).toUpperCase()
}

export function ProfilePage() {
  const { user, refreshUser, logout } = useAuth()
  const navigate = useNavigate()
  const { theme, setTheme, themeOfDayName } = useTheme()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [section, setSection] = useState<ProfileSection>('account')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [emailPassword, setEmailPassword] = useState('')
  const [selectedTheme, setSelectedTheme] = useState<ThemeMode>('system')

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [profileMessage, setProfileMessage] = useState<string | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [avatarError, setAvatarError] = useState<string | null>(null)

  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [sessions, setSessions] = useState<AuthSessionInfo[]>([])
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [sessionsBusy, setSessionsBusy] = useState(false)

  const loadSessions = async () => {
    setSessionsError(null)
    try {
      setSessions(await authApi.listSessions())
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : 'Failed to load devices')
    }
  }

  useEffect(() => {
    if (!user) return
    setDisplayName(user.display_name ?? '')
    setEmail(user.email)
    setSelectedTheme(user.theme)
    void loadSessions()
  }, [user])

  if (!user) {
    return null
  }

  const emailChanged = email.trim().toLowerCase() !== user.email.toLowerCase()
  const accountChanged =
    (displayName.trim() || null) !== (user.display_name ?? null) || emailChanged
  const themeChanged = selectedTheme !== user.theme
  const activeSection = SECTIONS.find((item) => item.id === section) ?? SECTIONS[0]
  const initials = userInitials(user)

  const handleProfileSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setProfileMessage(null)
    setProfileError(null)

    if (emailChanged && !emailPassword) {
      setProfileError('Enter your current password to change email')
      return
    }

    setSavingProfile(true)
    try {
      const body: {
        display_name: string | null
        email?: string
        theme: ThemeMode
        current_password?: string
      } = {
        display_name: displayName.trim() || null,
        theme: selectedTheme,
      }
      if (emailChanged) {
        body.email = email.trim()
        body.current_password = emailPassword
      }

      await authApi.updateProfile(body)
      if (emailChanged) {
        await logout()
        navigate('/login', {
          replace: true,
          state: {
            notice:
              'Email updated. Check your inbox to verify the new address, then sign in.',
          },
        })
        return
      }
      await refreshUser()
      setTheme(selectedTheme)
      setEmailPassword('')
      setProfileMessage('Profile updated')
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Failed to update profile')
    } finally {
      setSavingProfile(false)
    }
  }

  const handlePasswordSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setPasswordMessage(null)
    setPasswordError(null)

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match')
      return
    }
    const policyError = passwordPolicyError(newPassword, {
      email: user.email,
      displayName: user.display_name,
    })
    if (
      policyError ||
      !passwordMeetsPolicy(newPassword, {
        email: user.email,
        displayName: user.display_name,
      })
    ) {
      setPasswordError(policyError ?? 'Password does not meet requirements')
      return
    }

    setSavingPassword(true)
    try {
      await authApi.changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordMessage('Password changed')
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Failed to change password')
    } finally {
      setSavingPassword(false)
    }
  }

  const handleAvatarSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setAvatarError(null)
    setUploadingAvatar(true)
    try {
      await authApi.uploadAvatar(file)
      await refreshUser()
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Failed to upload avatar')
    } finally {
      setUploadingAvatar(false)
    }
  }

  const handleRemoveAvatar = async () => {
    setAvatarError(null)
    setUploadingAvatar(true)
    try {
      await authApi.removeAvatar()
      await refreshUser()
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Failed to remove avatar')
    } finally {
      setUploadingAvatar(false)
    }
  }

  const handleRevokeSession = async (sessionId: number) => {
    setSessionsBusy(true)
    setSessionsError(null)
    try {
      await authApi.revokeSession(sessionId)
      await loadSessions()
      await refreshUser()
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : 'Failed to log out device')
    } finally {
      setSessionsBusy(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col text-foreground lg:flex-row">
          <nav
            className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-4 py-3 lg:w-[220px] lg:flex-col lg:overflow-visible lg:border-b-0 lg:border-r lg:border-border lg:px-4 lg:py-5"
            aria-label="Profile sections"
          >
            {SECTIONS.map(({ id, label, description, icon: Icon }) => {
              const active = section === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSection(id)}
                  aria-current={active ? 'page' : undefined}
                  className={`flex min-w-[9.5rem] items-start gap-2.5 rounded-[10px] border px-3 py-2.5 text-left transition-all duration-150 lg:min-w-0 ${
                    active
                      ? 'border-[color-mix(in_srgb,var(--app-primary)_28%,transparent)] bg-[color-mix(in_srgb,var(--app-primary)_12%,transparent)] text-primary'
                      : 'border-transparent text-muted-text hover:bg-surface-hover hover:text-foreground'
                  }`}
                >
                  <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold">{label}</span>
                    <span className="mt-0.5 hidden text-[11.5px] leading-snug text-muted lg:block">
                      {description}
                    </span>
                  </span>
                </button>
              )
            })}
          </nav>

          <div className="min-w-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8">
            <header className="mb-6 max-w-xl">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">
                Settings
              </p>
              <h1 className="m-0 text-[clamp(22px,3vw,28px)] font-bold tracking-[-0.03em] text-foreground">
                {activeSection.label}
              </h1>
              <p className="mt-1.5 mb-0 max-w-md text-[14px] leading-relaxed text-muted-text">
                {activeSection.description}
              </p>
            </header>

            <div className="max-w-xl">
              {section === 'account' && (
                <div className="space-y-4">
                  {profileMessage && (
                    <StatusMessage type="success" message={profileMessage} />
                  )}
                  {profileError && <StatusMessage type="error" message={profileError} />}

                  <form onSubmit={(e) => void handleProfileSubmit(e)} className="space-y-1">
                    <label className={fieldLabel}>
                      <span>Display name</span>
                      <input
                        className={fieldInput}
                        type="text"
                        maxLength={100}
                        placeholder="Optional"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                      />
                    </label>
                    <label className={fieldLabel}>
                      <span>Email</span>
                      <input
                        className={fieldInput}
                        type="email"
                        autoComplete="username"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </label>
                    {emailChanged && (
                      <label className={fieldLabel}>
                        <span>Current password</span>
                        <input
                          className={fieldInput}
                          type="password"
                          autoComplete="current-password"
                          required
                          value={emailPassword}
                          onChange={(e) => setEmailPassword(e.target.value)}
                        />
                        <span className="text-xs font-normal text-muted">
                          Required to confirm your email change. You will need to verify the
                          new address.
                        </span>
                      </label>
                    )}
                    <div className="pt-2">
                      <button
                        type="submit"
                        className={btnPrimary}
                        disabled={savingProfile || !accountChanged}
                      >
                        {savingProfile ? 'Saving…' : 'Save account'}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {section === 'photo' && (
                <div className="space-y-5">
                  <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
                    <div className="relative flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-[18px] border border-border bg-surface-muted text-2xl font-semibold text-primary">
                      {user.avatar_url ? (
                        <img
                          src={user.avatar_url}
                          alt=""
                          className="size-full object-cover"
                        />
                      ) : (
                        <span aria-hidden>{initials}</span>
                      )}
                    </div>
                    <div className="space-y-3">
                      <p className="m-0 mb-2 text-sm leading-relaxed text-muted-text">
                        Upload a JPEG, PNG, WebP, or GIF up to 2 MB. A clear square photo
                        works best.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={btnPrimary}
                          disabled={uploadingAvatar}
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <Camera className="size-3.5" aria-hidden />
                          {uploadingAvatar ? 'Uploading…' : 'Upload photo'}
                        </button>
                        {user.avatar_url && (
                          <button
                            type="button"
                            className={btnBase}
                            disabled={uploadingAvatar}
                            onClick={() => void handleRemoveAvatar()}
                          >
                            <Trash2 className="size-3.5" aria-hidden />
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  {avatarError && <StatusMessage type="error" message={avatarError} />}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => void handleAvatarSelect(e)}
                  />
                </div>
              )}

              {section === 'appearance' && (
                <div className="space-y-4">
                  {profileMessage && (
                    <StatusMessage type="success" message={profileMessage} />
                  )}
                  {profileError && <StatusMessage type="error" message={profileError} />}

                  <form onSubmit={(e) => void handleProfileSubmit(e)} className="space-y-4">
                    <fieldset className="border-none p-0">
                      <legend className="mb-3 text-sm font-medium text-foreground">
                        Default theme
                      </legend>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {THEME_OPTIONS.map((option) => (
                          <label
                            key={option.value}
                            className={`cursor-pointer rounded-xl border px-3 py-3.5 transition-all duration-150 ${
                              selectedTheme === option.value
                                ? 'border-[color-mix(in_srgb,var(--app-primary)_28%,transparent)] bg-[color-mix(in_srgb,var(--app-primary)_12%,transparent)]'
                                : 'border-border bg-surface-muted/50 hover:border-[color-mix(in_srgb,var(--app-primary)_28%,transparent)] hover:bg-surface-hover'
                            }`}
                          >
                            <input
                              type="radio"
                              name="theme"
                              value={option.value}
                              checked={selectedTheme === option.value}
                              onChange={() => setSelectedTheme(option.value)}
                              className="sr-only"
                            />
                            <span className="block text-sm font-medium text-foreground">
                              {option.label}
                            </span>
                            <span className="mt-1 block text-xs leading-relaxed text-muted">
                              {option.description}
                            </span>
                          </label>
                        ))}
                      </div>
                      <p className="mt-3 mb-0 text-xs text-muted">
                        Current appearance:{' '}
                        <span className="font-medium text-foreground">
                          {themeDisplayLabel(theme, themeOfDayName)}
                        </span>
                      </p>
                    </fieldset>
                    <button
                      type="submit"
                      className={btnPrimary}
                      disabled={savingProfile || !themeChanged}
                    >
                      {savingProfile ? 'Saving…' : 'Save appearance'}
                    </button>
                  </form>
                </div>
              )}

              {section === 'security' && (
                <div className="space-y-4">
                  {passwordMessage && (
                    <StatusMessage type="success" message={passwordMessage} />
                  )}
                  {passwordError && <StatusMessage type="error" message={passwordError} />}

                  <form onSubmit={(e) => void handlePasswordSubmit(e)} className="space-y-1">
                    <label className={fieldLabel}>
                      <span>Current password</span>
                      <input
                        className={fieldInput}
                        type="password"
                        autoComplete="current-password"
                        required
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                      />
                    </label>
                    <label className={fieldLabel}>
                      <span>New password</span>
                      <input
                        className={fieldInput}
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={12}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                      />
                      <PasswordStrengthMeter
                        password={newPassword}
                        email={user.email}
                        displayName={user.display_name}
                      />
                    </label>
                    <label className={fieldLabel}>
                      <span>Confirm new password</span>
                      <input
                        className={fieldInput}
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={12}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                      />
                    </label>
                    <div className="pt-2">
                      <button type="submit" className={btnPrimary} disabled={savingPassword}>
                        {savingPassword ? 'Updating…' : 'Update password'}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {section === 'devices' && (
                <div className="space-y-4">
                  <p className="m-0 text-sm leading-relaxed text-muted-text">
                    Active sessions for your account. Logging out a device revokes its
                    access immediately.
                  </p>
                  {sessionsError && <StatusMessage type="error" message={sessionsError} />}
                  {sessions.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border bg-surface-muted/50 px-4 py-8 text-center">
                      <Monitor className="mx-auto size-8 text-muted" aria-hidden />
                      <p className="mt-3 mb-0 text-sm text-muted-text">No active sessions.</p>
                    </div>
                  ) : (
                    <ul className="m-0 list-none space-y-3 p-0">
                      {sessions.map((session) => (
                        <li
                          key={session.id}
                          className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border-subtle bg-surface-muted px-4 py-3.5 transition-colors hover:bg-surface-hover"
                        >
                          <div className="min-w-0 space-y-1.5 text-sm">
                            <p className="m-0 flex flex-wrap items-center gap-2 font-medium text-foreground">
                              <span>
                                {session.is_current ? 'This device' : 'Other device'}
                                {session.ip_address ? ` · ${session.ip_address}` : ''}
                              </span>
                              {session.is_current && (
                                <span className="rounded-full bg-[color-mix(in_srgb,var(--app-primary)_12%,transparent)] px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-primary">
                                  Current
                                </span>
                              )}
                            </p>
                            <p className="m-0 break-all text-muted-text">
                              {session.user_agent || 'Unknown browser'}
                            </p>
                            <p className="m-0 text-xs text-muted">
                              Last seen {new Date(session.last_seen_at).toLocaleString()}
                            </p>
                          </div>
                          <button
                            type="button"
                            className={btnBase}
                            disabled={sessionsBusy}
                            onClick={() => void handleRevokeSession(session.id)}
                          >
                            Log out
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {section === 'about' && (
                <div className="max-w-md space-y-3">
                  <dl className="m-0 grid gap-3">
                    <div className="rounded-xl border border-border-subtle bg-surface-muted px-4 py-3">
                      <dt className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">
                        Role
                      </dt>
                      <dd className="mt-1 mb-0 font-mono text-[12.5px] font-medium text-foreground">
                        {user.role_name || (user.is_admin ? 'Administrator' : 'User')}
                      </dd>
                    </div>
                    <div className="rounded-xl border border-border-subtle bg-surface-muted px-4 py-3">
                      <dt className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">
                        Member since
                      </dt>
                      <dd className="mt-1 mb-0 font-mono text-[12.5px] font-medium text-foreground">
                        {new Date(user.created_at).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </dd>
                    </div>
                    <div className="rounded-xl border border-border-subtle bg-surface-muted px-4 py-3">
                      <dt className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">
                        Email
                      </dt>
                      <dd className="mt-1 mb-0 break-all font-mono text-[12.5px] font-medium text-foreground">
                        {user.email}
                      </dd>
                    </div>
                  </dl>
                </div>
              )}
            </div>
          </div>
    </div>
  )
}
