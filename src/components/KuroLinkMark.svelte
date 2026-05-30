<script lang="ts"></script>

<!-- the badge stripped to its bones for chrome-sized use - shield, chevron, K.
     the full KuroLinkLogo's reticle + ticks turn to mud below ~24px. -->
<svg class="kl-mark" viewBox="75 25 362 442" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path
    class="kl-mark-shield"
    d="M256,32 L430,100 L430,320 L256,460 L82,320 L82,100 Z"
    fill="#0b0d1a"
    stroke="currentColor"
    stroke-width="14"
  />
  <path d="M82,100 L256,32 L430,100 L430,128 L256,60 L82,128 Z" fill="#e8254e" />
  <g fill="currentColor" transform="translate(256, 250)">
    <rect x="-80" y="-100" width="26" height="200" rx="1" />
    <polygon points="-49,-14 -49,-30 88,-115 88,-85" />
    <polygon points="-49,10 -49,26 88,115 88,85" />
  </g>
</svg>

<style>
  .kl-mark {
    height: 17px;
    width: auto;
    color: var(--accent-primary);
    /* decorative - let mousedown fall through to the drag region behind it */
    pointer-events: none;
    flex-shrink: 0;
    filter: drop-shadow(0 0 4px rgba(0, 212, 255, 0.4));
  }
</style>
