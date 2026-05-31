<script lang="ts">
  import { appearance } from "../lib/appearance.svelte";
</script>

<button
  class="cfg-btn"
  onclick={() => appearance.openSettings()}
  aria-label="Appearance settings"
  title="Appearance - theme, font, glass"
>
  <svg class="cfg-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
</button>

<style>
  .cfg-btn {
    display: inline-grid;
    place-items: center;
    padding: 0.25rem;
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition:
      color var(--transition-fast),
      border-color var(--transition-fast);
  }

  .cfg-glyph {
    width: 15px;
    height: 15px;
    display: block;
    transition: transform var(--transition-smooth);
  }

  .cfg-btn:hover {
    color: var(--accent-primary);
    border-color: var(--border-glow);
  }

  .cfg-btn:hover .cfg-glyph {
    filter: drop-shadow(0 0 5px rgba(var(--accent-rgb), 0.5));
    transform: rotate(40deg);
  }
</style>
