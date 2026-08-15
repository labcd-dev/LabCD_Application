import { useEffect, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { healthApi } from '../api/endpoints'
import type { PlantModelResult } from '../api/types'
import { PlantModelChat } from '../components/PlantModelChat'
import { usePipeline } from '../context/PipelineContext'
import { AUTO_MODEL } from '../lib/modelPicker'

export function DesignPage() {
  const navigate = useNavigate()
  const pipeline = usePipeline()
  const [models, setModels] = useState<string[]>(['gpt-4o', 'gpt-4o-mini'])

  useEffect(() => {
    healthApi.models().then((res) => setModels(res.llm_models)).catch(() => {})
  }, [])

  const handleUseModel = (result: PlantModelResult) => {
    const safeName = result.system_name.trim().replace(/[^\w\-]+/g, '_') || 'dynamics'
    pipeline.setFile(`${safeName}.py`, 'python', result.python_code)
    navigate('/studio')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PlantModelChat
        model={AUTO_MODEL}
        models={models}
        onModelChange={pipeline.setModel}
        onUseModel={handleUseModel}
        continueLabel="Configure & launch →"
        continueIcon={<ArrowRight className="size-3.5" aria-hidden />}
      />
    </div>
  )
}
