import type { Data, Layout } from 'plotly.js'
import type { SiloSimulateResponse } from '../api/types'

const AGENTIC_COLOR = 'rgb(255, 99, 132)'
const MANUAL_COLOR = 'rgb(54, 162, 235)'
const TARGET_COLOR = 'rgb(75, 192, 192)'

/** Overlay Agentic vs Manual trajectories — Streamlit Time Response parity. */
export function buildSiloTimeResponseChart(result: SiloSimulateResponse): {
  data: Data[]
  layout: Partial<Layout>
} {
  const time = result.time
  const target = result.target
  const data: Data[] = [
    {
      x: time,
      y: result.optimal.trajectory,
      type: 'scatter',
      mode: 'lines',
      name: 'Agentic (Optimal)',
      line: { color: AGENTIC_COLOR, width: 2 },
      xaxis: 'x',
      yaxis: 'y',
    },
    {
      x: time,
      y: result.optimal.control_signals,
      type: 'scatter',
      mode: 'lines',
      name: 'Agentic Control',
      line: { color: AGENTIC_COLOR, width: 2 },
      showlegend: false,
      xaxis: 'x2',
      yaxis: 'y2',
    },
    {
      x: [time[0] ?? 0, time[time.length - 1] ?? result.max_time],
      y: [target, target],
      type: 'scatter',
      mode: 'lines',
      name: 'Target',
      line: { color: TARGET_COLOR, width: 1.5, dash: 'dot' },
      xaxis: 'x',
      yaxis: 'y',
    },
  ]

  if (result.manual) {
    const manualTime = time.slice(0, result.manual.trajectory.length)
    data.splice(1, 0, {
      x: manualTime,
      y: result.manual.trajectory,
      type: 'scatter',
      mode: 'lines',
      name: 'Manual Test',
      line: { color: MANUAL_COLOR, width: 2, dash: 'dash' },
      xaxis: 'x',
      yaxis: 'y',
    })
    data.push({
      x: manualTime.slice(0, result.manual.control_signals.length),
      y: result.manual.control_signals,
      type: 'scatter',
      mode: 'lines',
      name: 'Manual Control',
      line: { color: MANUAL_COLOR, width: 2, dash: 'dash' },
      showlegend: false,
      xaxis: 'x2',
      yaxis: 'y2',
    })
  }

  return {
    data,
    layout: {
      grid: { rows: 2, columns: 1, pattern: 'independent', roworder: 'top to bottom' },
      title: { text: 'System Response & Control Input' },
      xaxis: { title: { text: 'Time (s)' }, anchor: 'y' },
      yaxis: { title: { text: 'Output' }, domain: [0.55, 1] },
      xaxis2: { title: { text: 'Time (s)' }, anchor: 'y2' },
      yaxis2: { title: { text: 'Control' }, domain: [0, 0.4] },
      legend: { orientation: 'h', y: 1.12 },
      margin: { t: 60, r: 20, b: 48, l: 56 },
    },
  }
}
