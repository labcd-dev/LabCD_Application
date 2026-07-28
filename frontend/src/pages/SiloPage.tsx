import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { siloApi } from '../api/endpoints'
import { CodePreview } from '../components/CodePreview'
import { SiloAdvancedSettings } from '../components/SiloAdvancedSettings'
import { StatusMessage } from '../components/StatusMessage'
import { usePipeline } from '../context/PipelineContext'
import {
  btnLink,
  btnPrimary,
  btnBase,
  btnWide,
  pageIntro,
  pageSection,
} from '../lib/classes'
import {
  buildSiloStartConfig,
  DEFAULT_SILO_ADVANCED_CONFIG,
  type SiloAdvancedConfig,
} from '../lib/siloDesignConfig'

export function SiloPage() {
  const navigate = useNavigate()
  const pipeline = usePipeline()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [advancedConfig, setAdvancedConfig] = useState<SiloAdvancedConfig>(
    DEFAULT_SILO_ADVANCED_CONFIG,
  )

  const startDesign = async () => {
    if (!pipeline.fileContent) {
      setError('Upload and process a file on the New Project page first.')
      return
    }
    if (!pipeline.projectId) {
      setError('Create a project from Studio before starting design.')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const config = buildSiloStartConfig(advancedConfig, {
        llm_model: pipeline.model,
        file_content: pipeline.fileContent,
        file_name: pipeline.fileName,
        // Uploaded files are always run as Python after regularization.
        file_type: 'Python (.py)',
      })

      const job = await siloApi.start({
        config,
        control_objective: pipeline.userPrompt,
        project_id: pipeline.projectId,
      })
      pipeline.setSiloJobId(job.job_id)
      navigate(`/projects/${pipeline.projectId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start silo design')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className={pageSection}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="mt-0 text-xl text-foreground sm:text-2xl">Single Loop Control Designer</h2>
          <p className={pageIntro}>
            Uses the Design Instructions from Studio as the control objective. Start the
            SiloDesigner pipeline; live progress opens on the project page.
          </p>
        </div>
        <button type="button" className={`${btnBase} max-sm:w-full`} onClick={() => navigate('/studio')}>
          <ArrowLeft className="size-4" aria-hidden />
          Back to Studio
        </button>
      </div>

      {error && <StatusMessage type="error" message={error} />}

      <div className="my-5 flex justify-center">
        <img
          src="/silo-agent-loop.png"
          alt="Single-loop agent refinement and evaluation flow: Actor, Critic, Terminator, and Juror"
          className="h-auto w-full max-w-3xl object-contain"
        />
      </div>

      <button type="button" className={btnLink} onClick={() => setShowAdvanced((v) => !v)}>
        {showAdvanced ? 'Hide' : 'Show'} Advanced Settings
      </button>

      {showAdvanced && (
        <div className="mt-4">
          <SiloAdvancedSettings value={advancedConfig} onChange={setAdvancedConfig} />
        </div>
      )}

      {pipeline.fileContent && (
        <details>
          <summary>Uploaded Dynamics Preview</summary>
          <CodePreview value={pipeline.fileContent} readOnly height={200} />
        </details>
      )}

      <button
        type="button"
        className={`${btnPrimary} ${btnWide}`}
        disabled={loading || !pipeline.fileContent}
        onClick={() => void startDesign()}
      >
        {loading ? 'Starting…' : 'Start Design'}
      </button>
    </section>
  )
}
