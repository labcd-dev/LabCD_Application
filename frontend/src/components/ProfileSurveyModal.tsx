import { useState, type FormEvent } from 'react'
import { surveyApi } from '../api/endpoints'
import type { DegreeLevel, ExperienceLevel, MajorField } from '../api/types'
import { StatusMessage } from './StatusMessage'
import { btnPrimary, btnWide, fieldInput, fieldLabel } from '../lib/classes'

const EXPERIENCE_LEVELS: ExperienceLevel[] = [
  'None',
  'Beginner',
  'Intermediate',
  'Advanced',
]

const DEGREE_LEVELS: DegreeLevel[] = ["Bachelor's", "Master's", 'PhD', 'Other']

const MAJOR_FIELDS: MajorField[] = [
  'Electrical Engineering',
  'Mechanical Engineering',
  'Chemical Engineering',
  'Aerospace Engineering',
  'Computer Science',
  'Control Engineering',
  'Mechatronics',
  'Other',
]

interface ProfileSurveyModalProps {
  onCompleted: () => void | Promise<void>
}

export function ProfileSurveyModal({ onCompleted }: ProfileSurveyModalProps) {
  const [university, setUniversity] = useState('')
  const [degree, setDegree] = useState<DegreeLevel | ''>('')
  const [major, setMajor] = useState<MajorField | ''>('')
  const [matlabExperience, setMatlabExperience] = useState<ExperienceLevel | ''>('')
  const [controlExperience, setControlExperience] = useState<ExperienceLevel | ''>('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!degree || !major) {
      setError('Please select your degree and major.')
      return
    }
    if (!matlabExperience || !controlExperience) {
      setError('Please select experience levels for both MATLAB and control design.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await surveyApi.submitProfile({
        university: university.trim(),
        degree,
        major,
        matlab_experience: matlabExperience,
        control_design_experience: controlExperience,
      })
      await onCompleted()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save survey')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="admin-fade-in absolute inset-0 bg-foreground/45 backdrop-blur-[2px]" />
      <div
        className="admin-slide-in relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-surface-elevated p-4 shadow-2xl sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-survey-title"
      >
        <h2 id="profile-survey-title" className="m-0 text-xl font-semibold text-foreground">
          Welcome — tell us about yourself
        </h2>
        <p className="mt-2 text-sm text-muted-text">
          Please complete this short survey before using LabCD.
        </p>

        <form className="mt-5" onSubmit={(e) => void handleSubmit(e)}>
          <label className={fieldLabel}>
            <span>University</span>
            <input
              className={fieldInput}
              value={university}
              onChange={(e) => setUniversity(e.target.value)}
              required
              maxLength={200}
            />
          </label>
          <label className={fieldLabel}>
            <span>Degree</span>
            <select
              className={fieldInput}
              value={degree}
              onChange={(e) => setDegree(e.target.value as DegreeLevel)}
              required
            >
              <option value="" disabled>
                Select degree…
              </option>
              {DEGREE_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </label>
          <label className={fieldLabel}>
            <span>Major</span>
            <select
              className={fieldInput}
              value={major}
              onChange={(e) => setMajor(e.target.value as MajorField)}
              required
            >
              <option value="" disabled>
                Select major…
              </option>
              {MAJOR_FIELDS.map((field) => (
                <option key={field} value={field}>
                  {field}
                </option>
              ))}
            </select>
          </label>
          <label className={fieldLabel}>
            <span>MATLAB experience</span>
            <select
              className={fieldInput}
              value={matlabExperience}
              onChange={(e) => setMatlabExperience(e.target.value as ExperienceLevel)}
              required
            >
              <option value="" disabled>
                Select level…
              </option>
              {EXPERIENCE_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </label>
          <label className={fieldLabel}>
            <span>Control design experience</span>
            <select
              className={fieldInput}
              value={controlExperience}
              onChange={(e) => setControlExperience(e.target.value as ExperienceLevel)}
              required
            >
              <option value="" disabled>
                Select level…
              </option>
              {EXPERIENCE_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </label>

          {error && <StatusMessage type="error" message={error} />}

          <button type="submit" className={`${btnPrimary} ${btnWide}`} disabled={saving}>
            {saving ? 'Saving…' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  )
}
