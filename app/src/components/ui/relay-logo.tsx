import { forwardRef } from "react";

interface RelayLogoProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
  connected?: boolean;
  hovered?: boolean;
  showPulseRings?: boolean;
  /**
   * Render the expensive per-node SMIL animations (breath lines + particle
   * motion). These run on the main thread and cost real CPU — a few percent
   * per mounted instance. Default is off. Opt in for hero placements where
   * the logo is the focal point (login, empty state, pending chat), not for
   * small chrome instances like the sidebar.
   *
   * The cheap CSS-based ring rotations and pulse are always on regardless.
   */
  animated?: boolean;
}

// Octagonal layout: 8 nodes at 45° intervals, R=13 from center (16,16)
const NODES = [
  { cx: 16, cy: 3, breathDur: 5, particleDur: 2, breath: { cy: ["5", "1", "5"] } },
  {
    cx: 25.2,
    cy: 6.8,
    breathDur: 7,
    particleDur: 1.8,
    breath: { cx: ["23.8", "26.6", "23.8"], cy: ["8.2", "5.4", "8.2"] },
  },
  { cx: 29, cy: 16, breathDur: 4, particleDur: 2.2, breath: { cx: ["27", "31", "27"] } },
  {
    cx: 25.2,
    cy: 25.2,
    breathDur: 6,
    particleDur: 1.6,
    breath: { cx: ["23.8", "26.6", "23.8"], cy: ["23.8", "26.6", "23.8"] },
  },
  { cx: 16, cy: 29, breathDur: 8, particleDur: 2.4, breath: { cy: ["27", "31", "27"] } },
  {
    cx: 6.8,
    cy: 25.2,
    breathDur: 5.5,
    particleDur: 2,
    breath: { cx: ["8.2", "5.4", "8.2"], cy: ["23.8", "26.6", "23.8"] },
  },
  { cx: 3, cy: 16, breathDur: 4.5, particleDur: 1.7, breath: { cx: ["5", "1", "5"] } },
  {
    cx: 6.8,
    cy: 6.8,
    breathDur: 6.5,
    particleDur: 2.1,
    breath: { cx: ["8.2", "5.4", "8.2"], cy: ["8.2", "5.4", "8.2"] },
  },
];

// Particle end points at R=7.5 from center
const PARTICLE_ENDS = [
  { x: 16, y: 8.5 },
  { x: 21.3, y: 10.7 },
  { x: 23.5, y: 16 },
  { x: 21.3, y: 21.3 },
  { x: 16, y: 23.5 },
  { x: 10.7, y: 21.3 },
  { x: 8.5, y: 16 },
  { x: 10.7, y: 10.7 },
];

export const RelayLogo = forwardRef<SVGSVGElement, RelayLogoProps>(
  (
    {
      size = 48,
      connected = true,
      hovered = false,
      showPulseRings = false,
      animated = false,
      className = "",
      ...props
    },
    ref,
  ) => {
    const playState = connected ? "running" : "paused";
    const nodeColor = connected ? "#34d399" : "#555";
    const coreColor = connected ? "#34d399" : "#777";
    const spokeOpacity = hovered ? 0.5 : 0.25;

    return (
      <svg
        ref={ref}
        width={size}
        height={size}
        viewBox="0 0 32 32"
        className={`shrink-0 ${className}`}
        {...props}
      >
        <style>{`
          .rl0{transform-origin:16px 16px;animation:rlcw 25s linear infinite}
          .rl1{transform-origin:16px 16px;animation:rlccw 33s linear infinite}
          .rl2{transform-origin:16px 16px;animation:rlcw 20s linear infinite}
          .rl3{transform-origin:16px 16px;animation:rlccw 28s linear infinite}
          .rl4{transform-origin:16px 16px;animation:rlcw 36s linear infinite}
          .rl5{transform-origin:16px 16px;animation:rlccw 22s linear infinite}
          .rl6{transform-origin:16px 16px;animation:rlcw 30s linear infinite}
          .rl7{transform-origin:16px 16px;animation:rlccw 18s linear infinite}
          @keyframes rlcw{to{transform:rotate(360deg)}}
          @keyframes rlccw{to{transform:rotate(-360deg)}}
          .rlp{animation:rlpulse 3s ease-in-out infinite}
          @keyframes rlpulse{0%,100%{opacity:.3}50%{opacity:1}}
        `}</style>

        {showPulseRings && (
          <>
            <circle
              cx="16"
              cy="16"
              r="8"
              fill="none"
              stroke={coreColor}
              style={{ strokeWidth: hovered ? 0.3 : 0.15, transition: "stroke-width 0.4s" }}
            >
              <animate attributeName="r" from="8" to="16" dur="4s" repeatCount="indefinite" />
              <animate
                attributeName="opacity"
                from="0.2"
                to="0"
                dur="4s"
                repeatCount="indefinite"
              />
            </circle>
            <circle
              cx="16"
              cy="16"
              r="8"
              fill="none"
              stroke={coreColor}
              style={{ strokeWidth: hovered ? 0.3 : 0.15, transition: "stroke-width 0.4s" }}
            >
              <animate
                attributeName="r"
                from="8"
                to="16"
                dur="4s"
                begin="2s"
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                from="0.2"
                to="0"
                dur="4s"
                begin="2s"
                repeatCount="indefinite"
              />
            </circle>
          </>
        )}

        {NODES.map((node, i) => {
          const end = PARTICLE_ENDS[i];
          return (
            <g key={i} className={`rl${i}`} style={{ animationPlayState: playState }}>
              <line
                x1="16"
                y1="16"
                x2={node.cx}
                y2={node.cy}
                strokeWidth="0.3"
                style={{
                  stroke: nodeColor,
                  opacity: spokeOpacity,
                  transition: "stroke 0.5s, opacity 0.4s",
                }}
              >
                {animated && node.breath.cx && (
                  <animate
                    attributeName="x2"
                    values={node.breath.cx.join(";")}
                    dur={`${node.breathDur}s`}
                    repeatCount="indefinite"
                  />
                )}
                {animated && node.breath.cy && (
                  <animate
                    attributeName="y2"
                    values={node.breath.cy.join(";")}
                    dur={`${node.breathDur}s`}
                    repeatCount="indefinite"
                  />
                )}
              </line>
              <circle
                cx={node.cx}
                cy={node.cy}
                r="1.5"
                className="rlp"
                style={{
                  fill: nodeColor,
                  animationDelay: `${i * 0.375}s`,
                  animationPlayState: playState,
                  transition: "fill 0.5s",
                }}
              >
                {animated && node.breath.cx && (
                  <animate
                    attributeName="cx"
                    values={node.breath.cx.join(";")}
                    dur={`${node.breathDur}s`}
                    repeatCount="indefinite"
                  />
                )}
                {animated && node.breath.cy && (
                  <animate
                    attributeName="cy"
                    values={node.breath.cy.join(";")}
                    dur={`${node.breathDur}s`}
                    repeatCount="indefinite"
                  />
                )}
              </circle>
              {animated && (
                <circle r="0.4" style={{ fill: nodeColor, transition: "fill 0.5s" }}>
                  <animateMotion
                    path={`M${node.cx},${node.cy} L${end.x},${end.y}`}
                    dur={`${node.particleDur}s`}
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="opacity"
                    values="0.7;0"
                    dur={`${node.particleDur}s`}
                    repeatCount="indefinite"
                  />
                </circle>
              )}
            </g>
          );
        })}

        {/* Core hub: concentric rings */}
        <circle
          cx="16"
          cy="16"
          r="4.5"
          fill="none"
          strokeWidth="0.6"
          style={{ stroke: coreColor, opacity: 0.15, transition: "stroke 0.5s" }}
        />
        <circle
          cx="16"
          cy="16"
          r="2.8"
          fill="none"
          strokeWidth="0.5"
          style={{ stroke: coreColor, opacity: 0.3, transition: "stroke 0.5s" }}
        />
        <circle cx="16" cy="16" r="1.4" style={{ fill: coreColor, transition: "fill 0.5s" }} />
      </svg>
    );
  },
);
