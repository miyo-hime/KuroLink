<script lang="ts">
  import { onMount } from "svelte";
  import type { ConnectionProfile, LocalShellId, SavedSession, Tab } from "./lib/types";
  import ConnectionScreen from "./components/ConnectionScreen.svelte";
  import Settings from "./components/Settings.svelte";
  import { appearance } from "./lib/appearance.svelte";
  import { claimHandoff } from "./lib/ipc";

  type AppView = "connect" | "terminal";

  // a torn-off window is spawned pointing at this same index.html, so it boots through
  // here too - it just claims its handed-off tab instead of showing the connect screen.
  // booting gates the first paint so the connect screen doesn't flash before the claim.
  let booting = $state(true);

  onMount(async () => {
    appearance.load();
    try {
      const adopted = await claimHandoff();
      if (adopted) {
        initialAdopt = adopted;
        view = "terminal";
      }
    } catch (e) {
      console.error("handoff claim failed:", e);
    }
    booting = false;
  });

  let view = $state<AppView>("connect");
  let initialSessionId = $state<string | null>(null);
  let initialProfile = $state<ConnectionProfile | null>(null);
  let initialLocalShell = $state<LocalShellId | null>(null);
  let initialRestore = $state<SavedSession | null>(null);
  let initialAdopt = $state<Tab | null>(null);
  let glitching = $state(false);

  function handleConnected(sid: string, _pid: string, prof: ConnectionProfile) {
    initialSessionId = sid;
    initialProfile = prof;
    initialLocalShell = null;
    initialRestore = null;
    initialAdopt = null;
    view = "terminal";
  }

  function handleLocalTerminal(shellType: LocalShellId) {
    initialSessionId = null;
    initialProfile = null;
    initialLocalShell = shellType;
    initialRestore = null;
    initialAdopt = null;
    view = "terminal";
  }

  function handleResume(saved: SavedSession) {
    initialSessionId = null;
    initialProfile = null;
    initialLocalShell = null;
    initialRestore = saved;
    initialAdopt = null;
    view = "terminal";
  }

  function handleDisconnected() {
    glitching = true;
    setTimeout(() => {
      glitching = false;
      initialSessionId = null;
      initialProfile = null;
      initialLocalShell = null;
      initialRestore = null;
      initialAdopt = null;
      view = "connect";
    }, 400);
  }
</script>

<div class="app">
  {#if booting}
    <div class="app-loading">BOOTING...</div>
  {:else if view === "connect"}
    <ConnectionScreen onConnected={handleConnected} onLocalTerminal={handleLocalTerminal} onResume={handleResume} />
  {/if}
  {#if !booting && view === "terminal" && (initialRestore || initialLocalShell || initialAdopt || (initialSessionId && initialProfile))}
    <div class={glitching ? "view-glitch-out" : ""} style="height: 100%; width: 100%;">
      {#await import("./components/MainView.svelte")}
        <div class="app-loading">LINKING TERMINAL...</div>
      {:then { default: MainView }}
        <MainView
          {initialSessionId}
          {initialProfile}
          {initialLocalShell}
          {initialRestore}
          {initialAdopt}
          onDisconnected={handleDisconnected}
        />
      {/await}
    </div>
  {/if}
  {#if appearance.settingsOpen}
    <Settings />
  {/if}
</div>
