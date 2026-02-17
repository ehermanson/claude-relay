import { forwardRef } from "react";

interface RelayLogoProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
  connected?: boolean;
  hovered?: boolean;
  showPulseRings?: boolean;
}

const SPARKLE_PATH =
  "M5.07306 17.7192L9.99106 14.9614L10.0721 14.7199L9.99106 14.5854H9.74786L8.92369 14.5352L6.11341 14.46L3.68143 14.3597L1.31701 14.2344L0.722529 14.109L0.168579 13.3694L0.222623 13.0059L0.722529 12.6675L1.43861 12.7301L3.0194 12.843L5.39733 13.0059L7.11322 13.1062L9.66679 13.3694H10.0721L10.1262 13.2065L9.99106 13.1062L9.88297 13.0059L7.42397 11.3387L4.76231 9.58378L3.37068 8.56843L2.62758 8.05448L2.24927 7.57814L2.08714 6.52518L2.76269 5.77306L3.68143 5.83574L3.91112 5.89842L4.84338 6.61293L6.82949 8.15476L9.4236 10.0601L9.80191 10.3735L9.95424 10.2707L9.97755 10.198L9.80191 9.9097L8.39676 7.36504L6.89705 4.77024L6.2215 3.69221L6.04585 3.05291C5.97781 2.78463 5.93777 2.56267 5.93777 2.28826L6.70789 1.2353L7.14024 1.09741L8.18059 1.2353L8.61294 1.61136L9.26147 3.09052L10.3018 5.40954L11.9231 8.56843L12.396 9.50857L12.6527 10.3735L12.7473 10.6367H12.9094V10.4863L13.0445 8.70631L13.2877 6.52518L13.5309 3.71728L13.612 2.92756L14.0038 1.97488L14.7875 1.46093L15.3954 1.74925L15.8954 2.46376L15.8278 2.92756L15.5306 4.85799L14.9496 7.87899L14.5713 9.9097H14.7875L15.0442 9.64646L16.071 8.29265L17.7869 6.13659L18.5435 5.28419L19.4352 4.34404L20.0027 3.89277H21.0836L21.8672 5.07109L21.5159 6.28701L20.408 7.69096L19.4893 8.88181L18.172 10.6467L17.3545 12.0658L17.4278 12.1828L17.6248 12.166L20.5972 11.5267L22.205 11.2384L24.1235 10.9125L24.9882 11.3136L25.0828 11.7273L24.745 12.5672L22.6914 13.0686L20.2864 13.5575L16.7051 14.4005L16.6655 14.4324L16.7123 14.5018L18.3273 14.648L19.0164 14.6856H20.7053L23.8533 14.9238L24.6775 15.4628L25.1639 16.1272L25.0828 16.6411L23.8128 17.2804L22.1104 16.8793L18.1247 15.9266L16.7601 15.5882H16.5709V15.701L17.7058 16.8166L19.8 18.6969L22.4076 21.1288L22.5428 21.7304L22.205 22.2068L21.8537 22.1566L19.5568 20.4268L18.6651 19.6496L16.6655 17.9573H16.5304V18.1328L16.9897 18.8097L19.4352 22.4826L19.5568 23.6107L19.3812 23.9743L18.7462 24.1999L18.0571 24.0745L16.6114 22.0564L15.1387 19.8L13.9498 17.7693L13.8062 17.86L13.0986 25.4158L12.7743 25.8044L12.0177 26.0927L11.3827 25.6164L11.0449 24.8392L11.3827 23.2974L11.788 21.2917L12.1123 19.6997L12.4095 17.7192L12.5911 17.0575L12.575 17.0133L12.43 17.0376L10.9368 19.0855L8.66698 22.1566L6.87002 24.0745L6.43767 24.25L5.69457 23.8614L5.76212 23.172L6.18096 22.5578L8.66698 19.3989L10.1667 17.4309L11.1333 16.3012L11.1239 16.1378L11.0705 16.1332L4.46507 20.4393L3.28961 20.5897L2.7762 20.1134L2.84375 19.3362L3.08695 19.0855L5.07306 17.7192Z";

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
      className = "",
      ...props
    },
    ref,
  ) => {
    const playState = connected ? "running" : "paused";
    const nodeColor = connected ? "#34d399" : "#555";
    const sparkleColor = connected ? "#D97757" : "#777";
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
              stroke="#D97757"
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
              stroke="#D97757"
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
                {node.breath.cx && (
                  <animate
                    attributeName="x2"
                    values={node.breath.cx.join(";")}
                    dur={`${node.breathDur}s`}
                    repeatCount="indefinite"
                  />
                )}
                {node.breath.cy && (
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
                {node.breath.cx && (
                  <animate
                    attributeName="cx"
                    values={node.breath.cx.join(";")}
                    dur={`${node.breathDur}s`}
                    repeatCount="indefinite"
                  />
                )}
                {node.breath.cy && (
                  <animate
                    attributeName="cy"
                    values={node.breath.cy.join(";")}
                    dur={`${node.breathDur}s`}
                    repeatCount="indefinite"
                  />
                )}
              </circle>
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
            </g>
          );
        })}

        <path
          transform="translate(16,16) scale(0.48) translate(-12.67,-13.6)"
          d={SPARKLE_PATH}
          style={{ fill: sparkleColor, transition: "fill 0.5s" }}
        />
      </svg>
    );
  },
);
