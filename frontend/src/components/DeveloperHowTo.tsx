import { useMemo, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { btnBase, btnCompact } from '../lib/classes'
import { highlightSource, type HighlightLanguage } from '../lib/prismHighlight'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

type ExampleLang = 'curl' | 'python'
type ModuleId = 'silo' | 'mulo' | 'adaptive' | 'mpc'

const MODULES: { id: ModuleId; label: string; short: string }[] = [
  { id: 'silo', label: 'Single Loop (SILO)', short: 'SILO' },
  { id: 'mulo', label: 'Multi Loop (MULO)', short: 'MULO' },
  { id: 'adaptive', label: 'Adaptive Nonlinear', short: 'Adaptive' },
  { id: 'mpc', label: 'Agentic MPC', short: 'MPC' },
]

const ENDPOINTS: { method: string; path: string; purpose: string }[] = [
  { method: 'POST', path: '/dev/silo', purpose: 'Start a Single Loop design job' },
  { method: 'POST', path: '/dev/mulo', purpose: 'Start a Multi Loop design job' },
  { method: 'POST', path: '/dev/adaptive', purpose: 'Start an Adaptive Nonlinear job' },
  { method: 'POST', path: '/dev/mpc', purpose: 'Start an Agentic MPC job' },
  { method: 'GET', path: '/dev/jobs/{job_id}', purpose: 'Poll job status' },
  { method: 'GET', path: '/dev/jobs/{job_id}/results', purpose: 'Fetch results when finished' },
]

function absoluteApiBase(): string {
  if (API_BASE.startsWith('http')) return API_BASE.replace(/\/$/, '')
  if (typeof window !== 'undefined') {
    return `${window.location.origin}${API_BASE.startsWith('/') ? '' : '/'}${API_BASE}`.replace(
      /\/$/,
      '',
    )
  }
  return API_BASE
}

function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  return (
    <button type="button" className={`${btnBase} ${btnCompact}`} onClick={() => void handleCopy()}>
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {copied ? 'Copied' : label}
    </button>
  )
}

function CodeBlock({
  title,
  code,
  language,
}: {
  title: string
  code: string
  language: HighlightLanguage
}) {
  const html = useMemo(() => highlightSource(code, language), [code, language])

  return (
    <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface-muted">
      <div className="flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-2">
        <p className="m-0 text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
        <CopyButton value={code} />
      </div>
      <pre className="syntax-highlight m-0 overflow-x-auto bg-code-bg p-3 font-mono text-[0.75rem] leading-relaxed text-code-text whitespace-pre-wrap">
        <code
          className={`language-${language}`}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </pre>
    </div>
  )
}

function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { id: T; label: string }[]
  onChange: (id: T) => void
}) {
  return (
    <div
      className="inline-flex max-w-full flex-wrap rounded-lg border border-border-subtle bg-surface-muted p-0.5"
      role="tablist"
      aria-label={label}
    >
      {options.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={value === tab.id}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            value === tab.id
              ? 'bg-surface text-foreground shadow-sm'
              : 'text-muted-text hover:text-foreground'
          }`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

function curlJsonBody(module: ModuleId): string {
  switch (module) {
    case 'silo':
      return '{"config":{"file_content":"# plant model Python source","llm_model":"gpt-4o"},"control_objective":"Track setpoint"}'
    case 'mulo':
      return '{"run_config":{"llm_model":"gpt-4o"},"controller_structure":[],"system_identification":{},"trimming_result":{},"equation":"...","file_name":"plant.py","file_type":"python"}'
    case 'adaptive':
      return '{"system_spec":{"plant":{}},"options":{"skip_clarify":true,"model":"gpt-4o"}}'
    case 'mpc':
      return '{"dynamics":{"source":"..."},"options":{"model":"gpt-4o"}}'
  }
}

function pythonPayload(module: ModuleId): string {
  switch (module) {
    case 'silo':
      return `{
        "config": {
            "file_content": "# plant model Python source",
            "llm_model": "gpt-4o",
        },
        "control_objective": "Track setpoint",
    }`
    case 'mulo':
      return `{
        "run_config": {"llm_model": "gpt-4o"},
        "controller_structure": [],
        "system_identification": {},
        "trimming_result": {},
        "equation": "...",
        "file_name": "plant.py",
        "file_type": "python",
    }`
    case 'adaptive':
      return `{
        "system_spec": {"plant": {}},
        "options": {"skip_clarify": True, "model": "gpt-4o"},
    }`
    case 'mpc':
      return `{
        "dynamics": {"source": "..."},
        "options": {"model": "gpt-4o"},
    }`
  }
}

function moduleNote(module: ModuleId): string {
  switch (module) {
    case 'silo':
      return 'Requires module:silo and pipeline:silo. Pass plant Python in config.file_content and an optional control_objective.'
    case 'mulo':
      return 'Requires module:mulo and pipeline:mulo. Send the same prepared inputs as the in-app Multi Loop designer (structure, identification, trimming, equation).'
    case 'adaptive':
      return 'Requires module:adaptive and pipeline:adaptive. Clarifier / HITL steps are always skipped for API jobs (skip_clarify is forced on).'
    case 'mpc':
      return 'Requires module:mpc and pipeline:mpc. Provide dynamics input and optional options.model.'
  }
}

function buildCurlExample(base: string, key: string, module: ModuleId): string {
  return `curl -X POST "${base}/dev/${module}" \\
  -H "X-API-Key: ${key}" \\
  -H "Content-Type: application/json" \\
  -d '${curlJsonBody(module)}'`
}

function buildPollCurl(base: string, key: string): string {
  return `curl "${base}/dev/jobs/JOB_ID" \\
  -H "X-API-Key: ${key}"`
}

function buildResultsCurl(base: string, key: string): string {
  return `curl "${base}/dev/jobs/JOB_ID/results" \\
  -H "X-API-Key: ${key}"`
}

function buildPythonExample(base: string, key: string, module: ModuleId): string {
  return `import time
import requests

BASE = "${base}"
API_KEY = "${key}"
HEADERS = {"X-API-Key": API_KEY, "Content-Type": "application/json"}

# 1) Start a job
start = requests.post(
    f"{BASE}/dev/${module}",
    headers=HEADERS,
    json=${pythonPayload(module)},
    timeout=60,
)
start.raise_for_status()
job = start.json()
print("started:", job)
# {"job_id": "...", "module": "${module}", "status": "queued|running", "message": "..."}

# 2) Poll until terminal status
job_id = job["job_id"]
while True:
    status = requests.get(f"{BASE}/dev/jobs/{job_id}", headers=HEADERS, timeout=30)
    status.raise_for_status()
    body = status.json()
    if body["status"] in ("completed", "failed", "cancelled"):
        break
    time.sleep(5)

# 3) Fetch results (409 if still running)
results = requests.get(f"{BASE}/dev/jobs/{job_id}/results", headers=HEADERS, timeout=60)
results.raise_for_status()
print(results.json())
# {"job_id": "...", "module": "${module}", "status": "completed", "results": {...}}
`
}

export function DeveloperHowTo({ maskedKey }: { maskedKey?: string | null }) {
  const [lang, setLang] = useState<ExampleLang>('curl')
  const [module, setModule] = useState<ModuleId>('silo')
  const base = absoluteApiBase()
  const keyPlaceholder = maskedKey?.replace('••••', 'YOUR_KEY_SECRET') || 'labcd_YOUR_KEY_SECRET'
  const selected = MODULES.find((item) => item.id === module) ?? MODULES[0]

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h4 className="mt-0 mb-2 text-sm font-semibold text-foreground">Quick start</h4>
        <ol className="m-0 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-muted-text">
          <li>Authenticate every request with your API key.</li>
          <li>
            <code className="text-foreground">POST /dev/&#123;module&#125;</code> to start a design
            job — response includes <code className="text-foreground">job_id</code>.
          </li>
          <li>
            Poll <code className="text-foreground">GET /dev/jobs/&#123;job_id&#125;</code> until
            status is <code className="text-foreground">completed</code>,{' '}
            <code className="text-foreground">failed</code>, or{' '}
            <code className="text-foreground">cancelled</code>.
          </li>
          <li>
            Fetch <code className="text-foreground">GET /dev/jobs/&#123;job_id&#125;/results</code>{' '}
            when finished.
          </li>
        </ol>
        <p className="m-0 text-sm leading-relaxed text-muted-text">
          Interactive clarifiers and human-in-the-loop steps from the web UI are skipped. Your plan
          permissions and credit balance still apply.
        </p>
      </section>

      <section className="space-y-3">
        <h4 className="mt-0 mb-2 text-sm font-semibold text-foreground">Authentication</h4>
        <div className="rounded-xl border border-border-subtle bg-surface-muted px-4 py-3 text-sm leading-relaxed text-muted-text">
          <p className="m-0 mb-2">
            Base URL: <code className="break-all text-foreground">{base}</code>
          </p>
          <div className="mb-3">
            <CopyButton value={base} label="Copy base URL" />
          </div>
          <ul className="m-0 list-disc space-y-1.5 pl-5">
            <li>
              Preferred: <code className="text-foreground">X-API-Key: labcd_…</code>
            </li>
            <li>
              Also accepted:{' '}
              <code className="text-foreground">Authorization: Bearer labcd_…</code>
            </li>
            <li>
              Treat the full key like a password — it is shown only once when an admin creates it.
            </li>
          </ul>
        </div>
      </section>

      <section className="space-y-3">
        <h4 className="mt-0 mb-2 text-sm font-semibold text-foreground">Endpoints</h4>
        <div className="overflow-x-auto rounded-xl border border-border-subtle">
          <table className="w-full min-w-[28rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">
                <th className="px-3 py-2.5 font-semibold">Method</th>
                <th className="px-3 py-2.5 font-semibold">Path</th>
                <th className="px-3 py-2.5 font-semibold">Purpose</th>
              </tr>
            </thead>
            <tbody>
              {ENDPOINTS.map((row) => (
                <tr key={row.path} className="border-b border-border-subtle last:border-b-0">
                  <td className="px-3 py-2.5 align-top">
                    <code className="text-[12px] font-semibold text-foreground">{row.method}</code>
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <code className="break-all text-[12px] text-foreground">{row.path}</code>
                  </td>
                  <td className="px-3 py-2.5 align-top text-muted-text">{row.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <h4 className="mt-0 mb-2 text-sm font-semibold text-foreground">Examples</h4>
          <SegmentedControl
            label="Example language"
            value={lang}
            options={[
              { id: 'curl', label: 'curl' },
              { id: 'python', label: 'Python' },
            ]}
            onChange={setLang}
          />
        </div>

        <SegmentedControl
          label="Module"
          value={module}
          options={MODULES.map((item) => ({ id: item.id, label: item.short }))}
          onChange={setModule}
        />

        <p className="m-0 text-sm leading-relaxed text-muted-text">{moduleNote(module)}</p>

        {lang === 'curl' ? (
          <div className="space-y-3" role="tabpanel">
            <CodeBlock
              title={`Start ${selected.label}`}
              language="bash"
              code={buildCurlExample(base, keyPlaceholder, module)}
            />
            <CodeBlock
              title="Poll job status"
              language="bash"
              code={buildPollCurl(base, keyPlaceholder)}
            />
            <CodeBlock
              title="Fetch results"
              language="bash"
              code={buildResultsCurl(base, keyPlaceholder)}
            />
          </div>
        ) : (
          <div className="space-y-3" role="tabpanel">
            <CodeBlock title="Install dependency" language="bash" code="pip install requests" />
            <CodeBlock
              title={`Python — start ${selected.short}, poll, results`}
              language="python"
              code={buildPythonExample(base, keyPlaceholder, module)}
            />
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h4 className="mt-0 mb-2 text-sm font-semibold text-foreground">Responses & errors</h4>
        <div className="rounded-xl border border-border-subtle px-4 py-3 text-sm text-muted-text">
          <p className="m-0 mb-2 font-medium text-foreground">Success shapes</p>
          <ul className="m-0 mb-3 list-disc space-y-1 pl-5">
            <li>
              Start → <code className="text-foreground">{'{ job_id, module, status, message }'}</code>
            </li>
            <li>
              Status →{' '}
              <code className="text-foreground">
                {'{ job_id, module, status, error?, stage?, metadata }'}
              </code>
            </li>
            <li>
              Results →{' '}
              <code className="text-foreground">{'{ job_id, module, status, results }'}</code>
            </li>
          </ul>
          <p className="m-0 mb-2 font-medium text-foreground">Common status codes</p>
          <ul className="m-0 list-disc space-y-1 pl-5">
            <li>
              <code className="text-foreground">401</code> — missing or invalid API key
            </li>
            <li>
              <code className="text-foreground">402</code> — insufficient credits
            </li>
            <li>
              <code className="text-foreground">403</code> — plan missing module/pipeline permission,
              or job belongs to another user
            </li>
            <li>
              <code className="text-foreground">404</code> — unknown job id
            </li>
            <li>
              <code className="text-foreground">409</code> — results requested while the job is still
              running
            </li>
          </ul>
        </div>
      </section>
    </div>
  )
}
