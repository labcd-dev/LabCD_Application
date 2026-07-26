import { useEffect, useState } from 'react'
import Plot from 'react-plotly.js'
import type { Data, Layout } from 'plotly.js'
import { useTheme } from '../context/ThemeContext'

interface PlotlyChartProps {
  data: Data[]
  layout?: Partial<Layout>
  height?: number
  className?: string
  revision?: number | string
}

function useResponsiveChartHeight(height: number) {
  const [resolved, setResolved] = useState(height)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)')
    const update = () => {
      setResolved(mq.matches ? Math.min(height, Math.round(height * 0.72)) : height)
    }
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [height])

  return resolved
}

export function PlotlyChart({
  data,
  layout = {},
  height = 360,
  className,
  revision,
}: PlotlyChartProps) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'
  const chartHeight = useResponsiveChartHeight(height)

  const mergedLayout: Partial<Layout> = {
    autosize: true,
    height: chartHeight,
    margin: { l: 48, r: 24, t: 40, b: 40 },
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    font: {
      color: isDark ? '#c9d1d9' : '#334155',
      family: 'inherit',
      size: 12,
    },
    legend: {
      orientation: 'h',
      y: 1.12,
      x: 0,
      bgcolor: 'transparent',
    },
    ...layout,
    datarevision: revision ?? layout.datarevision,
    xaxis: {
      gridcolor: isDark ? '#30363d' : '#e8edf5',
      zerolinecolor: isDark ? '#484f58' : '#dde3ef',
      ...(layout.xaxis ?? {}),
    },
    yaxis: {
      gridcolor: isDark ? '#30363d' : '#e8edf5',
      zerolinecolor: isDark ? '#484f58' : '#dde3ef',
      ...(layout.yaxis ?? {}),
    },
  }

  if (chartHeight < height) {
    mergedLayout.margin = { l: 40, r: 12, t: 28, b: 32, ...(layout.margin ?? {}) }
    mergedLayout.font = {
      ...mergedLayout.font,
      size: 11,
    }
  }

  return (
    <div className={className ?? 'w-full min-h-[220px] overflow-x-auto sm:min-h-[280px]'}>
      <Plot
        data={data}
        layout={mergedLayout}
        config={{
          displayModeBar: false,
          responsive: true,
        }}
        useResizeHandler
        style={{ width: '100%', height: `${chartHeight}px` }}
      />
    </div>
  )
}
