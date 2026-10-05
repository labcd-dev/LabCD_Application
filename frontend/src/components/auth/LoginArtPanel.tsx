/** Control-themed decorative panel with animated feedback-loop visuals. */
export function LoginArtPanel() {
  return (
    <svg
      className="login-auth__art-svg"
      viewBox="0 0 480 560"
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient id="loginArtGlow" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#5e43ff" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.12" />
        </linearGradient>
        <linearGradient id="loginArtPlot" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="loginArtBlock" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7c5cff" />
          <stop offset="100%" stopColor="#4a32e6" />
        </linearGradient>
        <filter id="loginArtSoft" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <pattern id="loginArtGrid" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M24 0H0V24" fill="none" stroke="#5e43ff" strokeOpacity="0.12" strokeWidth="1" />
        </pattern>
      </defs>

      <rect width="480" height="560" fill="#0b0e37" />
      <rect width="480" height="560" fill="url(#loginArtGrid)" />
      <circle className="login-art__orb login-art__orb--a" cx="90" cy="120" r="90" fill="url(#loginArtGlow)" />
      <circle className="login-art__orb login-art__orb--b" cx="400" cy="440" r="110" fill="url(#loginArtGlow)" />

      {/* Title chip */}
      <g transform="translate(28, 36)">
        <rect width="168" height="28" rx="8" fill="#1a1f4d" stroke="#5e43ff" strokeOpacity="0.45" />
        <circle className="login-art__pulse" cx="16" cy="14" r="4" fill="#22d3ee" />
        <text x="28" y="18" fill="#c7d2fe" fontSize="11" fontFamily="Inter, system-ui, sans-serif" fontWeight="600">
          Closed-loop control
        </text>
      </g>

      {/* Feedback loop block diagram */}
      <g transform="translate(36, 90)">
        {/* r(t) input */}
        <text x="0" y="78" fill="#94a3b8" fontSize="12" fontFamily="Inter, system-ui, sans-serif">
          r(t)
        </text>
        <line x1="28" y1="74" x2="72" y2="74" stroke="#818cf8" strokeWidth="2" />
        <polygon points="72,70 82,74 72,78" fill="#818cf8" />

        {/* Summing junction */}
        <g className="login-art__sum">
          <circle cx="102" cy="74" r="16" fill="#12163a" stroke="#a78bfa" strokeWidth="2" />
          <text x="102" y="78" textAnchor="middle" fill="#e2e8f0" fontSize="14" fontFamily="Inter, system-ui, sans-serif">
            Σ
          </text>
        </g>

        {/* Forward path */}
        <path
          className="login-art__signal"
          d="M118 74 H148"
          fill="none"
          stroke="#6366f1"
          strokeWidth="2"
          strokeDasharray="6 8"
        />
        <polygon points="148,70 158,74 148,78" fill="#6366f1" />

        {/* Controller block */}
        <g className="login-art__block login-art__block--ctrl">
          <rect x="158" y="52" width="88" height="44" rx="10" fill="url(#loginArtBlock)" filter="url(#loginArtSoft)" />
          <text
            x="202"
            y="70"
            textAnchor="middle"
            fill="#fff"
            fontSize="11"
            fontFamily="Inter, system-ui, sans-serif"
            fontWeight="700"
          >
            Controller
          </text>
          <text x="202" y="84" textAnchor="middle" fill="#ddd6fe" fontSize="9" fontFamily="Inter, system-ui, sans-serif">
            C(s)
          </text>
        </g>

        <path
          className="login-art__signal"
          d="M246 74 H276"
          fill="none"
          stroke="#6366f1"
          strokeWidth="2"
          strokeDasharray="6 8"
        />
        <polygon points="276,70 286,74 276,78" fill="#6366f1" />

        {/* Plant block */}
        <g className="login-art__block login-art__block--plant">
          <rect x="286" y="52" width="88" height="44" rx="10" fill="#0f766e" stroke="#2dd4bf" strokeWidth="1.5" />
          <text
            x="330"
            y="70"
            textAnchor="middle"
            fill="#fff"
            fontSize="11"
            fontFamily="Inter, system-ui, sans-serif"
            fontWeight="700"
          >
            Plant
          </text>
          <text x="330" y="84" textAnchor="middle" fill="#99f6e4" fontSize="9" fontFamily="Inter, system-ui, sans-serif">
            G(s)
          </text>
        </g>

        {/* Output */}
        <path
          className="login-art__signal"
          d="M374 74 H408"
          fill="none"
          stroke="#22d3ee"
          strokeWidth="2"
          strokeDasharray="6 8"
        />
        <polygon points="408,70 418,74 408,78" fill="#22d3ee" />
        <text x="422" y="78" fill="#94a3b8" fontSize="12" fontFamily="Inter, system-ui, sans-serif">
          y(t)
        </text>

        {/* Feedback path */}
        <path
          className="login-art__signal login-art__signal--feedback"
          d="M396 74 V128 H102 V90"
          fill="none"
          stroke="#f59e0b"
          strokeWidth="2"
          strokeDasharray="5 7"
        />
        <polygon points="98,90 102,80 106,90" fill="#f59e0b" />
        <text x="220" y="148" textAnchor="middle" fill="#fbbf24" fontSize="10" fontFamily="Inter, system-ui, sans-serif">
          feedback H(s)
        </text>

        {/* Error label */}
        <text x="118" y="48" fill="#a78bfa" fontSize="10" fontFamily="Inter, system-ui, sans-serif">
          e
        </text>
        <text x="252" y="48" fill="#c4b5fd" fontSize="10" fontFamily="Inter, system-ui, sans-serif">
          u
        </text>
      </g>

      {/* Animated step / setpoint response plot */}
      <g transform="translate(40, 270)">
        <rect width="400" height="150" rx="14" fill="#12163a" stroke="#312e81" strokeWidth="1.5" />
        <text x="16" y="24" fill="#94a3b8" fontSize="11" fontFamily="Inter, system-ui, sans-serif" fontWeight="600">
          Step response
        </text>
        <text x="384" y="24" textAnchor="end" fill="#64748b" fontSize="10" fontFamily="Inter, system-ui, sans-serif">
          y(t)
        </text>

        {/* Grid lines */}
        <g stroke="#1e293b" strokeWidth="1">
          <line x1="24" y1="50" x2="376" y2="50" />
          <line x1="24" y1="80" x2="376" y2="80" />
          <line x1="24" y1="110" x2="376" y2="110" />
        </g>

        {/* Reference step */}
        <path
          className="login-art__ref"
          d="M40 120 H100 V55 H360"
          fill="none"
          stroke="#818cf8"
          strokeWidth="1.5"
          strokeDasharray="4 4"
          opacity="0.7"
        />

        {/* Response fill + curve */}
        <path
          className="login-art__curve-fill"
          d="M40 120 H100 C130 120, 140 58, 170 52 C200 48, 220 62, 245 58 C270 54, 290 50, 320 52 C340 53, 360 54, 360 54 V120 Z"
          fill="url(#loginArtPlot)"
        />
        <path
          id="loginArtCurvePath"
          className="login-art__curve"
          d="M40 120 H100 C130 120, 140 58, 170 52 C200 48, 220 62, 245 58 C270 54, 290 50, 320 52 C340 53, 360 54, 360 54"
          fill="none"
          stroke="#22d3ee"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle className="login-art__trace" r="4.5" fill="#fbbf24">
          <animateMotion dur="3.8s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1" keyTimes="0;1">
            <mpath href="#loginArtCurvePath" />
          </animateMotion>
        </circle>
      </g>

      {/* Inverted pendulum / cart sketch */}
      <g className="login-art__pendulum" transform="translate(300, 440)">
        <line x1="-70" y1="48" x2="90" y2="48" stroke="#334155" strokeWidth="3" strokeLinecap="round" />
        <g className="login-art__cart">
          <rect x="-28" y="28" width="56" height="22" rx="6" fill="#1e1b4b" stroke="#7c5cff" strokeWidth="2" />
          <circle className="login-art__wheel" cx="-12" cy="52" r="7" fill="#0b0e37" stroke="#22d3ee" strokeWidth="2" />
          <circle className="login-art__wheel" cx="12" cy="52" r="7" fill="#0b0e37" stroke="#22d3ee" strokeWidth="2" />
          <g className="login-art__rod">
            <line x1="0" y1="28" x2="0" y2="-42" stroke="#a78bfa" strokeWidth="3" strokeLinecap="round" />
            <circle cx="0" cy="-48" r="8" fill="#f5c542" filter="url(#loginArtSoft)" />
          </g>
        </g>
      </g>

      {/* Floating metric chips */}
      <g transform="translate(48, 448)">
        <g className="login-art__chip login-art__chip--a">
          <rect width="96" height="36" rx="10" fill="#1a1f4d" stroke="#22d3ee" strokeOpacity="0.4" />
          <text x="12" y="15" fill="#67e8f9" fontSize="9" fontFamily="Inter, system-ui, sans-serif">
            Settling
          </text>
          <text x="12" y="28" fill="#e2e8f0" fontSize="12" fontFamily="Inter, system-ui, sans-serif" fontWeight="700">
            1.24 s
          </text>
        </g>
      </g>
      <g transform="translate(156, 448)">
        <g className="login-art__chip login-art__chip--b">
          <rect width="96" height="36" rx="10" fill="#1a1f4d" stroke="#f59e0b" strokeOpacity="0.4" />
          <text x="12" y="15" fill="#fcd34d" fontSize="9" fontFamily="Inter, system-ui, sans-serif">
            Overshoot
          </text>
          <text x="12" y="28" fill="#e2e8f0" fontSize="12" fontFamily="Inter, system-ui, sans-serif" fontWeight="700">
            4.8%
          </text>
        </g>
      </g>
    </svg>
  )
}
