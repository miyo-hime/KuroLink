<script lang="ts">
  import type { ConnectionProfile, LocalShellId } from "./lib/types";
  import ConnectionScreen from "./components/ConnectionScreen.svelte";

  type AppView = "connect" | "terminal";

  let view = $state<AppView>("connect");
  let initialSessionId = $state<string | null>(null);
  let initialProfile = $state<ConnectionProfile | null>(null);
  let initialLocalShell = $state<LocalShellId | null>(null);
  let glitching = $state(false);

  function handleConnected(sid: string, _pid: string, prof: ConnectionProfile) {
    initialSessionId = sid;
    initialProfile = prof;
    initialLocalShell = null;
    view = "terminal";
  }

  function handleLocalTerminal(shellType: LocalShellId) {
    initialSessionId = null;
    initialProfile = null;
    initialLocalShell = shellType;
    view = "terminal";
  }

  function handleDisconnected() {
    glitching = true;
    setTimeout(() => {
      glitching = false;
      initialSessionId = null;
      initialProfile = null;
      initialLocalShell = null;
      view = "connect";
    }, 400);
  }
</script>

<div class="app">
  {#if view === "connect"}
    <ConnectionScreen onConnected={handleConnected} onLocalTerminal={handleLocalTerminal} />
  {/if}
  {#if view === "terminal" && (initialLocalShell || (initialSessionId && initialProfile))}
    <div class={glitching ? "view-glitch-out" : ""} style="height: 100%; width: 100%;">
      {#await import("./components/MainView.svelte")}
        <div class="app-loading">LINKING TERMINAL...</div>
      {:then { default: MainView }}
        <MainView
          {initialSessionId}
          {initialProfile}
          {initialLocalShell}
          onDisconnected={handleDisconnected}
        />
      {/await}
    </div>
  {/if}
</div>
