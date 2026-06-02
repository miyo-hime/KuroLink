<script lang="ts">
  import { commands, type Command } from "../lib/commands.svelte";

  let query = $state("");
  let selected = $state(0);
  let inputEl = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLDivElement | null>(null);

  interface Scored {
    cmd: Command;
    score: number;
  }

  // subsequence match, word-starts and runs weigh heaviest. null = no match.
  function score(q: string, text: string): number | null {
    if (!q) return 0;
    let qi = 0;
    let s = 0;
    let last = -2;
    for (let ti = 0; ti < text.length && qi < q.length; ti++) {
      if (text[ti] === q[qi]) {
        let bonus = 1;
        if (last === ti - 1) bonus += 6;
        if (ti === 0 || /[\s\-_./·]/.test(text[ti - 1])) bonus += 12;
        s += bonus;
        last = ti;
        qi++;
      }
    }
    return qi === q.length ? s : null;
  }

  let results = $derived.by<Scored[]>(() => {
    const pool = commands.items.filter((c) => c.enabled !== false);
    const q = query.trim().toLowerCase();
    if (!q) return pool.map((cmd) => ({ cmd, score: 0 }));
    const out: Scored[] = [];
    for (const cmd of pool) {
      const hay = `${cmd.title} ${cmd.group} ${cmd.keywords ?? ""}`.toLowerCase();
      const sc = score(q, hay);
      if (sc != null) out.push({ cmd, score: sc });
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  });

  // empty query keeps the grouped layout; a search flattens to a ranked list
  let grouped = $derived(query.trim() === "");

  $effect(() => {
    results;
    selected = 0;
  });

  $effect(() => {
    if (commands.open) {
      query = "";
      selected = 0;
      queueMicrotask(() => inputEl?.focus());
    }
  });

  $effect(() => {
    selected;
    listEl?.querySelector<HTMLElement>(".cmd-row.active")?.scrollIntoView({ block: "nearest" });
  });

  function execute(cmd: Command) {
    commands.hide();
    cmd.run();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      commands.hide();
    } else if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      e.preventDefault();
      if (results.length) selected = (selected + 1) % results.length;
    } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
      e.preventDefault();
      if (results.length) selected = (selected - 1 + results.length) % results.length;
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[selected];
      if (r) execute(r.cmd);
    }
  }
</script>

{#if commands.open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="cmd-overlay"
    role="presentation"
    onmousedown={(e) => {
      if (e.target === e.currentTarget) commands.hide();
    }}
  >
    <div class="cmd-deck" role="dialog" aria-modal="true" aria-label="Command deck">
      <span class="cmd-corner cmd-corner-tr"></span>
      <span class="cmd-corner cmd-corner-bl"></span>
      <div class="cmd-scan"></div>

      <div class="cmd-head">
        <span class="cmd-prompt">&#10095;</span>
        <input
          bind:this={inputEl}
          bind:value={query}
          onkeydown={onKey}
          class="cmd-input"
          type="text"
          placeholder="TYPE A COMMAND..."
          spellcheck="false"
          autocomplete="off"
        />
        <span class="cmd-count">{results.length} OPS</span>
      </div>

      <div class="cmd-list" bind:this={listEl}>
        {#if results.length === 0}
          <div class="cmd-empty">NO MATCHING OPS</div>
        {:else if grouped}
          {#each results as r, i (r.cmd.id)}
            {#if i === 0 || results[i - 1].cmd.group !== r.cmd.group}
              <div class="cmd-group">{r.cmd.group}</div>
            {/if}
            {@render row(r.cmd, i, false)}
          {/each}
        {:else}
          {#each results as r, i (r.cmd.id)}
            {@render row(r.cmd, i, true)}
          {/each}
        {/if}
      </div>

      <div class="cmd-foot">
        <span><kbd>&#8593;</kbd><kbd>&#8595;</kbd> NAV</span>
        <span><kbd>&#9166;</kbd> EXEC</span>
        <span><kbd>ESC</kbd> ABORT</span>
      </div>
    </div>
  </div>
{/if}

{#snippet row(cmd: Command, i: number, showGroup: boolean)}
  <button
    class="cmd-row"
    class:active={i === selected}
    onmousemove={() => (selected = i)}
    onclick={() => execute(cmd)}
  >
    <span class="cmd-pip"></span>
    <span class="cmd-title">{cmd.title}</span>
    {#if showGroup}<span class="cmd-tag">{cmd.group}</span>{/if}
    {#if cmd.detail}<span class="cmd-detail">{cmd.detail}</span>{/if}
    {#if cmd.chord}
      <span class="cmd-chord">
        {#each cmd.chord.split(" ") as k}<kbd>{k}</kbd>{/each}
      </span>
    {/if}
  </button>
{/snippet}

<style>
  .cmd-overlay {
    position: fixed;
    inset: 0;
    z-index: 3000;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 12vh;
    background: rgba(6, 6, 12, 0.55);
    backdrop-filter: blur(3px);
    animation: cmd-fade 0.14s ease-out;
  }

  .cmd-deck {
    position: relative;
    width: min(620px, 86vw);
    background: var(--bg-secondary);
    border: 1px solid var(--border-glow);
    border-top: 2px solid var(--accent-primary);
    box-shadow:
      0 24px 60px rgba(0, 0, 0, 0.6),
      var(--glow-lg) rgba(var(--accent-rgb), 0.08);
    background-image:
      repeating-linear-gradient(0deg, var(--hud-grid) 0 1px, transparent 1px 28px),
      repeating-linear-gradient(90deg, var(--hud-grid) 0 1px, transparent 1px 28px);
    clip-path: polygon(
      0 0,
      calc(100% - 14px) 0,
      100% 14px,
      100% 100%,
      14px 100%,
      0 calc(100% - 14px)
    );
    overflow: hidden;
    animation: cmd-rise 0.18s cubic-bezier(0.4, 0, 0.2, 1);
  }

  /* hud brackets ride the two square corners (clip-path eats the other two) */
  .cmd-corner {
    position: absolute;
    width: 14px;
    height: 14px;
    pointer-events: none;
    opacity: 0.45;
    z-index: 2;
  }

  .cmd-corner-tr {
    top: 6px;
    right: 6px;
    border-top: 2px solid var(--accent-primary);
    border-right: 2px solid var(--accent-primary);
  }

  .cmd-corner-bl {
    bottom: 6px;
    left: 6px;
    border-bottom: 2px solid var(--accent-primary);
    border-left: 2px solid var(--accent-primary);
  }

  .cmd-scan {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(var(--accent-rgb), 0.25), transparent);
    animation: cmd-scanmove 3.5s linear infinite;
    pointer-events: none;
    z-index: 1;
  }

  .cmd-head {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.85rem 1rem;
    border-bottom: 1px solid var(--border-subtle);
    position: relative;
  }

  .cmd-prompt {
    color: var(--accent-primary);
    font-size: 0.95rem;
    font-weight: 700;
    text-shadow: var(--glow-sm) var(--accent-primary);
    animation: cmd-blink 1.2s step-end infinite;
  }

  .cmd-input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text-primary);
    font-family: inherit;
    font-size: 0.95rem;
    letter-spacing: 0.04em;
  }

  .cmd-input::placeholder {
    color: var(--text-dim);
    letter-spacing: 0.12em;
    font-size: 0.8rem;
  }

  .cmd-count {
    font-size: 0.55rem;
    letter-spacing: 0.12em;
    color: var(--text-label);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .cmd-list {
    max-height: 46vh;
    overflow-y: auto;
    padding: 0.3rem 0;
  }

  .cmd-group {
    font-size: 0.55rem;
    letter-spacing: 0.16em;
    color: var(--text-label);
    padding: 0.5rem 1rem 0.2rem;
    opacity: 0.85;
  }

  .cmd-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    padding: 0.4rem 1rem;
    color: var(--text-secondary);
    font-family: inherit;
    font-size: 0.78rem;
    letter-spacing: 0.02em;
    position: relative;
    transition:
      background var(--transition-fast),
      color var(--transition-fast);
  }

  .cmd-pip {
    position: absolute;
    left: 0;
    top: 50%;
    width: 2px;
    height: 0;
    transform: translateY(-50%);
    background: var(--accent-primary);
    box-shadow: var(--glow-sm) var(--accent-primary);
    transition: height var(--transition-fast);
  }

  .cmd-row.active {
    color: var(--accent-primary);
    background: rgba(var(--accent-rgb), 0.07);
  }

  .cmd-row.active .cmd-pip {
    height: 60%;
  }

  .cmd-title {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cmd-tag {
    font-size: 0.5rem;
    letter-spacing: 0.1em;
    color: var(--text-dim);
    border: 1px solid var(--border-subtle);
    padding: 0.05rem 0.3rem;
    opacity: 0.85;
    white-space: nowrap;
  }

  .cmd-detail {
    font-size: 0.62rem;
    color: var(--text-dim);
    opacity: 0.8;
    font-variant-numeric: tabular-nums;
  }

  .cmd-chord {
    display: flex;
    gap: 0.2rem;
    flex-shrink: 0;
  }

  .cmd-chord kbd,
  .cmd-foot kbd {
    font-family: inherit;
    font-size: 0.55rem;
    line-height: 1;
    padding: 0.16rem 0.32rem;
    color: var(--text-secondary);
    background: rgba(var(--accent-rgb), 0.05);
    border: 1px solid var(--border-subtle);
    border-radius: 2px;
  }

  .cmd-row.active .cmd-chord kbd {
    color: var(--accent-primary);
    border-color: var(--border-glow);
  }

  .cmd-empty {
    padding: 1.6rem;
    text-align: center;
    color: var(--text-dim);
    font-size: 0.7rem;
    letter-spacing: 0.14em;
  }

  .cmd-foot {
    display: flex;
    gap: 1.2rem;
    padding: 0.55rem 1rem;
    border-top: 1px solid var(--border-subtle);
    font-size: 0.55rem;
    letter-spacing: 0.12em;
    color: var(--text-label);
  }

  .cmd-foot span {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }

  @keyframes cmd-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes cmd-rise {
    from {
      opacity: 0;
      transform: translateY(-8px) scale(0.99);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes cmd-blink {
    0%, 60% { opacity: 1; }
    61%, 100% { opacity: 0.25; }
  }

  @keyframes cmd-scanmove {
    from { top: 0; }
    to { top: 100%; }
  }
</style>
