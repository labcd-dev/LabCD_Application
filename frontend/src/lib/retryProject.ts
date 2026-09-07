import type { NavigateFunction } from 'react-router-dom'
import { projectsApi } from '../api/endpoints'
import type { ProjectDetail, ProjectStatus } from '../api/types'

export function canRetryProject(status: ProjectStatus): boolean {
  return status !== 'running'
}

type PipelineHydrator = {
  hydrateFromProject: (project: ProjectDetail) => void
}

export async function retryProject(
  project: ProjectDetail,
  pipeline: PipelineHydrator,
  navigate: NavigateFunction,
): Promise<void> {
  const updated = await projectsApi.update(project.id, { status: 'draft' })
  pipeline.hydrateFromProject(updated)
  if (updated.pipeline_type === 'muloDesign') {
    navigate('/mulo?step=recommender')
    return
  }
  if (updated.pipeline_type === 'mpcDesign') {
    navigate('/mpc')
    return
  }
  if (updated.pipeline_type === 'adaptiveDesign') {
    navigate('/adaptive')
    return
  }
  navigate('/silo')
}
