import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { healthApi, plantArtifactApi } from '../api/endpoints'
import type { PlantModelResult, PreLaunchConfig } from '../api/types'
import { AgentPlantChat } from '../components/AgentPlantChat'
import type { LaunchPipeline } from '../components/LaunchModuleModal'
import { PreLaunchModal } from '../components/PreLaunchModal'
import { usePipeline } from '../context/PipelineContext'
import { AUTO_MODEL } from '../lib/modelPicker'

function inferNumStates(plant?: PlantModelResult | null): number {
  if (Array.isArray(plant?.metadata?.states) && plant.metadata.states.length > 0) {
    return plant.metadata.states.length
  }
  const code = plant?.python_code || ''
  if (!code) return 2

  const indices: number[] = []
  const regex = /(?:x|state|dx|dxdt)\[(\d+)\]/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(code)) !== null) {
    indices.push(parseInt(match[1], 10))
  }
  if (indices.length > 0) {
    return Math.max(...indices) + 1
  }

  const zerosMatch = /np\.(?:zeros|empty|array)\s*\(\s*(\d+)/.exec(code)
  if (zerosMatch) {
    return parseInt(zerosMatch[1], 10)
  }

  return 2
}

export function DesignPage() {
  const navigate = useNavigate()
  const pipeline = usePipeline()
  const [activeResult, setActiveResult] = useState<PlantModelResult | null>(null)
  const [conversationId, setConversationId] = useState<number | null>(null)
  const [isPreLaunchOpen, setIsPreLaunchOpen] = useState(false)
  const [targetPipeline, setTargetPipeline] = useState<LaunchPipeline | null>(null)

  useEffect(() => {
    // Warm model list (AgentPlantChat uses pipeline/model prop; list still useful for health).
    healthApi.models().catch(() => {})
  }, [])

  const handleUseModel = (result: PlantModelResult, convId?: number | null) => {
    setActiveResult(result)
    setConversationId(convId ?? null)
    setIsPreLaunchOpen(true)
  }

  const handleLaunchPipeline = async (
    selected: LaunchPipeline,
    result: PlantModelResult,
    convId?: number | null,
  ) => {
    setActiveResult(result)
    setConversationId(convId ?? null)
    setTargetPipeline(selected)

    const safeName = result.system_name.trim().replace(/[^\w\-]+/g, '_') || 'dynamics'
    pipeline.setFile(`${safeName}.py`, 'python', result.python_code)
    pipeline.setPipeline(selected)

    // For adaptive & MPC: compile pre-launch artifact so simulation works out of the box
    if (selected === 'adaptiveDesign' || selected === 'mpcDesign') {
      try {
        const detectedStates = inferNumStates(result)
        const preLaunch: PreLaunchConfig = {
          total_simulation_time: 10,
          solver_sample_time: 0.01,
          initial_state: new Array(detectedStates).fill(0),
          default_target: [],
        }
        const res = await plantArtifactApi.createArtifact({
          pre_launch: preLaunch,
          plant: {
            system_name: result.system_name,
            python_code: result.python_code,
            metadata: result.metadata as Record<string, unknown>,
          },
          conversation_id: convId ?? undefined,
        })
        sessionStorage.setItem('labcd_last_artifact_id', res.artifact_id)
        sessionStorage.setItem('labcd_last_pre_launch', JSON.stringify(preLaunch))
      } catch (err) {
        console.warn('Auto-compiling plant artifact error:', err)
      }
    }

    if (selected === 'adaptiveDesign') {
      navigate('/adaptive')
    } else if (selected === 'mpcDesign') {
      navigate('/mpc')
    } else if (selected === 'siloDesign') {
      navigate('/silo')
    } else if (selected === 'muloDesign') {
      navigate('/recommender')
    }
  }

  const handleOpenSettings = (
    selected: LaunchPipeline,
    result: PlantModelResult,
    convId?: number | null,
  ) => {
    setActiveResult(result)
    setConversationId(convId ?? null)
    setTargetPipeline(selected)
    setIsPreLaunchOpen(true)
  }

  const handlePreLaunchSuccess = (artifactId: string, preLaunch: PreLaunchConfig) => {
    if (!activeResult) return
    const safeName = activeResult.system_name.trim().replace(/[^\w\-]+/g, '_') || 'dynamics'
    pipeline.setFile(`${safeName}.py`, 'python', activeResult.python_code)
    sessionStorage.setItem('labcd_last_artifact_id', artifactId)
    sessionStorage.setItem('labcd_last_pre_launch', JSON.stringify(preLaunch))

    if (targetPipeline === 'adaptiveDesign') {
      pipeline.setPipeline('adaptiveDesign')
      navigate('/adaptive')
    } else if (targetPipeline === 'mpcDesign') {
      pipeline.setPipeline('mpcDesign')
      navigate('/mpc')
    } else if (targetPipeline === 'siloDesign') {
      pipeline.setPipeline('siloDesign')
      navigate('/silo')
    } else if (targetPipeline === 'muloDesign') {
      pipeline.setPipeline('muloDesign')
      navigate('/recommender')
    } else {
      const convParam = conversationId ? `&new=${conversationId}` : ''
      navigate(`/case-studies?artifact_id=${encodeURIComponent(artifactId)}${convParam}`)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col h-full">
      <AgentPlantChat
        model={pipeline.model || AUTO_MODEL}
        onUseModel={handleUseModel}
        onLaunchPipeline={handleLaunchPipeline}
        onOpenSettings={handleOpenSettings}
      />

      {activeResult && (
        <PreLaunchModal
          isOpen={isPreLaunchOpen}
          onClose={() => setIsPreLaunchOpen(false)}
          plant={{
            system_name: activeResult.system_name,
            python_code: activeResult.python_code,
            metadata: activeResult.metadata as Record<string, unknown>,
          }}
          conversationId={conversationId}
          systemName={activeResult.system_name}
          targetPipeline={targetPipeline}
          onSuccess={handlePreLaunchSuccess}
        />
      )}
    </div>
  )
}
