import "./KuroLinkLogo.css";

export default function KuroLinkLogo() {
  return (
    <div className="logo-wrapper">
      <svg
        className="logo-svg"
        viewBox="0 0 200 190"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Outer hexagonal shield frame */}
        <polygon
          className="logo-frame"
          points="100,4 185,32 185,108 100,140 15,108 15,32"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />

        {/* Inner frame — tighter hexagon */}
        <polygon
          className="logo-frame-inner"
          points="100,16 172,40 172,100 100,128 28,100 28,40"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.75"
          opacity="0.3"
        />

        {/* Stylized K — angular mecha strokes */}
        <g className="logo-mark" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="square">
          {/* Vertical stroke */}
          <line x1="72" y1="42" x2="72" y2="102" />
          {/* Upper diagonal — outward */}
          <line x1="74" y1="72" x2="118" y2="42" />
          {/* Lower diagonal — outward */}
          <line x1="74" y1="72" x2="118" y2="102" />
          {/* Angular accent — upper notch */}
          <line x1="96" y1="57" x2="108" y2="50" strokeWidth="2" opacity="0.5" />
          {/* Angular accent — lower notch */}
          <line x1="96" y1="87" x2="108" y2="94" strokeWidth="2" opacity="0.5" />
        </g>

        {/* Corner accent marks — mecha registration marks */}
        <g className="logo-accents" stroke="currentColor" strokeWidth="1" opacity="0.35">
          <line x1="30" y1="36" x2="42" y2="36" />
          <line x1="30" y1="36" x2="30" y2="48" />
          <line x1="170" y1="36" x2="158" y2="36" />
          <line x1="170" y1="36" x2="170" y2="48" />
          <line x1="30" y1="104" x2="42" y2="104" />
          <line x1="30" y1="104" x2="30" y2="92" />
          <line x1="170" y1="104" x2="158" y2="104" />
          <line x1="170" y1="104" x2="170" y2="92" />
        </g>

        {/* KUROLINK text */}
        <text
          x="100"
          y="160"
          textAnchor="middle"
          className="logo-title"
          fill="currentColor"
          fontSize="18"
          fontWeight="700"
          letterSpacing="0.3em"
        >
          KUROLINK
        </text>

        {/* Subtitle */}
        <text
          x="100"
          y="177"
          textAnchor="middle"
          className="logo-subtitle"
          fill="currentColor"
          fontSize="10"
          letterSpacing="0.2em"
          opacity="0.45"
        >
          REMOTE OPERATIONS SYSTEM
        </text>
      </svg>
    </div>
  );
}
