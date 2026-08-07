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
import {
  btnBase,
  btnPrimary,
  cardPanel,
  fieldInput,
  fieldLabel,
  pageIntro,
  pageSection,
  pageTitle,
} from '../lib/classes'
import { passwordMeetsPolicy, passwordPolicyError } from '../lib/passwordStrength'

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
]

function userInitials(user: { display_name: string | null; email: string }): string {
  const source = user.display_name?.trim() || user.email
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
  }
  return source.slice(0, 2).toUpperCase()
}

function sectionNavClass(active: boolean) {
  return `group flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-all duration-150 ${
    active
      ? 'bg-[color-mix(in_srgb,var(--app-primary)_14%,transparent)] text-primary shadow-sm'
      : 'text-muted-text hover:bg-surface-hover hover:text-foreground'
  }`
}

export function ProfilePage() {
  const { user, refreshUser, logout } = useAuth()
  const navigate = useNavigate()
  const { theme, setTheme } = useTheme()
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
    <section className={pageSection}>
      <header>
        <h1 className={pageTitle}>Profile</h1>
        <p className={pageIntro}>
          Manage your account details, profile picture, password, and default appearance.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start xl:grid-cols-[260px_minmax(0,1fr)]">
        {/* Left navigation */}
        <aside className={`${cardPanel} space-y-4 p-3 sm:p-4 lg:sticky lg:top-20`}>
          <div className="flex items-center gap-3 rounded-xl bg-surface-muted/80 px-3 py-3">
            <div className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-surface-elevated text-sm font-semibold text-primary">
              {user.avatar_url ? (
                <img src={user.avatar_url} alt="" className="size-full object-cover" />
              ) : (
                <span aria-hidden>{userInitials(user)}</span>
              )}
            </div>
            <div className="min-w-0">
              <p className="m-0 truncate text-sm font-semibold text-foreground">
                {user.display_name?.trim() || 'Your profile'}
              </p>
              <p className="m-0 truncate text-xs text-muted-text">{user.email}</p>
            </div>
          </div>

          {/* Mobile: horizontal chips */}
          <nav
            className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:hidden"
            aria-label="Profile sections"
          >
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  section === id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-surface-muted text-muted-text hover:bg-surface-hover hover:text-foreground'
                }`}
              >
                <Icon className="size-3.5" aria-hidden />
                {label}
              </button>
            ))}
          </nav>

          {/* Desktop: vertical list */}
          <nav className="hidden flex-col gap-0.5 lg:flex" aria-label="Profile sections">
            {SECTIONS.map(({ id, label, description, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className={sectionNavClass(section === id)}
                aria-current={section === id ? 'page' : undefined}
              >
                <Icon
                  className={`mt-0.5 size-4 shrink-0 ${
                    section === id ? 'opacity-100' : 'opacity-80 group-hover:opacity-100'
                  }`}
                  aria-hidden
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{label}</span>
                  <span
                    className={`mt-0.5 block text-xs ${
                      section === id ? 'text-primary/80' : 'text-muted'
                    }`}
                  >
                    {description}
                  </span>
                </span>
              </button>
            ))}
          </nav>
        </aside>

        {/* Right content */}
        <div className={`${cardPanel} min-h-[28rem] space-y-5 sm:p-5`}>
          <div className="border-b border-border pb-4">
            <h2 className="m-0 text-lg font-semibold tracking-tight text-foreground">
              {activeSection.label}
            </h2>
            <p className="mt-1 mb-0 text-sm text-muted-text">{activeSection.description}</p>
          </div>

          {section === 'account' && (
            <div className="max-w-lg space-y-4">
              {profileMessage && <StatusMessage type="success" message={profileMessage} />}
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
                    <span className="text-xs font-normal text-muted-text">
                      Required to confirm your email change. You will need to verify the new
                      address.
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
            <div className="max-w-lg space-y-5">
              <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
                <div className="relative flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-border bg-surface-muted text-2xl font-semibold text-primary shadow-sm">
                  {user.avatar_url ? (
                    <img
                      src={user.avatar_url}
                      alt=""
                      className="size-full object-cover"
                    />
                  ) : (
                    <span aria-hidden>{userInitials(user)}</span>
                  )}
                </div>
                <div className="space-y-3">
                  <p className="m-0 mb-2 text-sm leading-relaxed text-muted-text">
                    Upload a JPEG, PNG, WebP, or GIF up to 2 MB. A clear square photo works
                    best.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={btnPrimary}
                      disabled={uploadingAvatar}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Camera className="size-4" aria-hidden />
                      {uploadingAvatar ? 'Uploading…' : 'Upload photo'}
                    </button>
                    {user.avatar_url && (
                      <button
                        type="button"
                        className={btnBase}
                        disabled={uploadingAvatar}
                        onClick={() => void handleRemoveAvatar()}
                      >
                        <Trash2 className="size-4" aria-hidden />
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
            <div className="max-w-xl space-y-4">
              {profileMessage && <StatusMessage type="success" message={profileMessage} />}
              {profileError && <StatusMessage type="error" message={profileError} />}

              <form onSubmit={(e) => void handleProfileSubmit(e)} className="space-y-4">
                <fieldset className="border-none p-0">
                  <legend className="mb-3 text-sm font-medium text-foreground">
                    Default theme
                  </legend>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {THEME_OPTIONS.map((option) => (
                      <label
                        key={option.value}
                        className={`cursor-pointer rounded-xl border px-3 py-3.5 transition-all duration-150 ${
                          selectedTheme === option.value
                            ? 'border-primary bg-[color-mix(in_srgb,var(--app-primary)_10%,transparent)] shadow-sm'
                            : 'border-border-input bg-surface-muted/50 hover:border-primary/50 hover:bg-surface-hover'
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
                        <span className="mt-1 block text-xs leading-relaxed text-muted-text">
                          {option.description}
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className="mt-3 mb-0 text-xs text-muted-text">
                    Current appearance:{' '}
                    <span className="font-medium text-foreground">
                      {theme === 'system' ? 'System' : theme}
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
            <div className="max-w-lg space-y-4">
              {passwordMessage && <StatusMessage type="success" message={passwordMessage} />}
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
                Active sessions for your account. Logging out a device revokes its access
                immediately.
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
                      className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-surface-muted/40 px-4 py-3.5 transition-colors hover:bg-surface-muted/70"
                    >
                      <div className="min-w-0 space-y-1.5 text-sm">
                        <p className="m-0 flex flex-wrap items-center gap-2 font-medium text-foreground">
                          <span>
                            {session.is_current ? 'This device' : 'Other device'}
                            {session.ip_address ? ` · ${session.ip_address}` : ''}
                          </span>
                          {session.is_current && (
                            <span className="rounded-md bg-[color-mix(in_srgb,var(--app-primary)_14%,transparent)] px-1.5 py-0.5 text-[0.7rem] font-semibold text-primary">
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
            <div className="max-w-md space-y-4">
              <dl className="m-0 grid gap-3">
                <div className="rounded-xl border border-border bg-surface-muted/40 px-4 py-3">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted">
                    Role
                  </dt>
                  <dd className="mt-1 mb-0 text-sm font-medium text-foreground">
                    {user.role_name || (user.is_admin ? 'Administrator' : 'User')}
                  </dd>
                </div>
                <div className="rounded-xl border border-border bg-surface-muted/40 px-4 py-3">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted">
                    Member since
                  </dt>
                  <dd className="mt-1 mb-0 text-sm font-medium text-foreground">
                    {new Date(user.created_at).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </dd>
                </div>
                <div className="rounded-xl border border-border bg-surface-muted/40 px-4 py-3">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted">
                    Email
                  </dt>
                  <dd className="mt-1 mb-0 break-all text-sm font-medium text-foreground">
                    {user.email}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
