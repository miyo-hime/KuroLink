<script lang="ts"></script>

<div class="logo-wrapper">
  <svg
    class="logo-svg"
    viewBox="0 0 512 512"
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <radialGradient id="logoBgGrad" cx="50%" cy="45%" r="50%">
        <stop offset="0%" stop-color="#0e1020" />
        <stop offset="100%" stop-color="#060610" />
      </radialGradient>
    </defs>

    <!-- reticle ring -->
    <circle
      class="logo-reticle-outer"
      cx="256" cy="256" r="246"
      fill="none"
      stroke="#1a2a3a"
      stroke-width="3"
    />
    <circle
      class="logo-reticle-inner"
      cx="256" cy="256" r="238"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      opacity="0.25"
    />

    <!-- tick marks -->
    <g class="logo-ticks" stroke="currentColor" stroke-width="2.5" opacity="0.4">
      <!-- cardinal -->
      <line x1="256" y1="8" x2="256" y2="32" />
      <line x1="256" y1="480" x2="256" y2="504" />
      <line x1="8" y1="256" x2="32" y2="256" />
      <line x1="480" y1="256" x2="504" y2="256" />
      <!-- 45deg -->
      <line x1="79" y1="79" x2="96" y2="96" />
      <line x1="433" y1="79" x2="416" y2="96" />
      <line x1="79" y1="433" x2="96" y2="416" />
      <line x1="433" y1="433" x2="416" y2="416" />
      <!-- minor -->
      <line x1="133" y1="36" x2="140" y2="52" stroke-width="2" opacity="0.3" />
      <line x1="379" y1="36" x2="372" y2="52" stroke-width="2" opacity="0.3" />
      <line x1="36" y1="133" x2="52" y2="140" stroke-width="2" opacity="0.3" />
      <line x1="36" y1="379" x2="52" y2="372" stroke-width="2" opacity="0.3" />
      <line x1="476" y1="133" x2="460" y2="140" stroke-width="2" opacity="0.3" />
      <line x1="476" y1="379" x2="460" y2="372" stroke-width="2" opacity="0.3" />
      <line x1="133" y1="476" x2="140" y2="460" stroke-width="2" opacity="0.3" />
      <line x1="379" y1="476" x2="372" y2="460" stroke-width="2" opacity="0.3" />
    </g>

    <!-- shield -->
    <path
      class="logo-shield"
      d="M256,32 L430,100 L430,320 L256,460 L82,320 L82,100 Z"
      fill="url(#logoBgGrad)"
      stroke="currentColor"
      stroke-width="3"
      opacity="0.95"
    />

    <!-- inner border -->
    <path
      class="logo-shield-inner"
      d="M256,52 L414,114 L414,310 L256,438 L98,310 L98,114 Z"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      opacity="0.2"
    />

    <!-- red chevron -->
    <path
      class="logo-chevron"
      d="M82,100 L256,32 L430,100 L430,122 L256,54 L82,122 Z"
      fill="#e8254e"
      opacity="0.85"
    />
    <path
      d="M98,120 L256,58 L414,120"
      fill="none"
      stroke="#e8254e"
      stroke-width="1.5"
      opacity="0.4"
    />

    <!-- the K -->
    <g class="logo-mark" transform="translate(256, 250)">
      <rect x="-80" y="-100" width="26" height="200" fill="currentColor" rx="1" />
      <polygon points="-49,-14 -49,-30 88,-115 88,-85" fill="currentColor" />
      <polygon points="-49,10 -49,26 88,115 88,85" fill="currentColor" />
      <!-- panel lines -->
      <rect x="-4" y="-66" width="32" height="4" fill="currentColor" opacity="0.35" transform="rotate(-30, 12, -64)" />
      <rect x="-4" y="62" width="32" height="4" fill="currentColor" opacity="0.35" transform="rotate(30, 12, 64)" />
    </g>

    <!-- corner marks -->
    <g class="logo-accents" stroke="currentColor" stroke-width="2.5" opacity="0.3">
      <line x1="112" y1="124" x2="140" y2="124" />
      <line x1="112" y1="124" x2="112" y2="152" />
      <line x1="400" y1="124" x2="372" y2="124" />
      <line x1="400" y1="124" x2="400" y2="152" />
      <line x1="122" y1="300" x2="150" y2="300" />
      <line x1="122" y1="300" x2="122" y2="272" />
      <line x1="390" y1="300" x2="362" y2="300" />
      <line x1="390" y1="300" x2="390" y2="272" />
    </g>
  </svg>

  <!-- text below badge -->
  <h1 class="logo-title">KUROLINK</h1>
  <span class="logo-subtitle">ROS-01 ◆ REMOTE OPS</span>
</div>

<style>
  .logo-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
    will-change: filter;
    animation: logo-glow 3s ease-in-out infinite;
  }

  .logo-svg {
    width: 180px;
    height: auto;
    color: var(--accent-primary);
  }

  .logo-shield {
    transition: stroke-opacity var(--transition-normal);
  }

  .logo-shield-inner {
    stroke-dasharray: 4 8;
  }

  .logo-mark {
    filter: drop-shadow(0 0 4px rgba(0, 212, 255, 0.3));
  }

  .logo-chevron {
    filter: drop-shadow(0 0 4px rgba(232, 37, 78, 0.3));
  }

  .logo-title {
    font-family: "JetBrains Mono", "IBM Plex Mono", monospace;
    font-size: 1.4rem;
    font-weight: 700;
    letter-spacing: 0.3em;
    color: var(--accent-primary);
    text-shadow: 0 0 10px rgba(0, 212, 255, 0.4);
    margin: 0;
    line-height: 1;
  }

  .logo-subtitle {
    font-family: "JetBrains Mono", "IBM Plex Mono", monospace;
    font-size: 0.6rem;
    letter-spacing: 0.2em;
    color: var(--accent-primary);
    opacity: 0.4;
    line-height: 1;
  }

  .logo-accents line {
    transition: opacity var(--transition-normal);
  }

  .logo-wrapper:hover .logo-accents line {
    opacity: 0.6;
  }

  .logo-wrapper:hover .logo-shield-inner {
    opacity: 0.5;
  }

  .logo-wrapper:hover .logo-ticks line {
    opacity: 0.6;
  }
</style>
