<script lang="ts">
  import { onMount, untrack } from "svelte";
  import {
    EditorView,
    keymap,
    lineNumbers,
    highlightActiveLine,
    highlightActiveLineGutter,
    drawSelection,
    rectangularSelection,
    crosshairCursor,
    highlightSpecialChars,
  } from "@codemirror/view";
  import { EditorState, Compartment } from "@codemirror/state";
  import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
  import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
  import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
  import {
    syntaxHighlighting,
    HighlightStyle,
    bracketMatching,
    indentOnInput,
    foldGutter,
    foldKeymap,
    LanguageDescription,
  } from "@codemirror/language";
  import { languages } from "@codemirror/language-data";
  import { tags as t } from "@lezer/highlight";
  import { showMinimap } from "@replit/codemirror-minimap";
  import { sftpReadFile, sftpReadBytes, sftpWriteFile } from "../lib/ipc";
  import { isImage, imageMime } from "../lib/fileKind";
  import { appearance } from "../lib/appearance.svelte";
  import type { ResolvedTheme } from "../lib/themes";

  interface Props {
    channelId: string;
    sessionId: string;
    path: string;
    active: boolean;
    onDirtyChange: (channelId: string, dirty: boolean) => void;
  }

  let { channelId, sessionId, path, active, onDirtyChange }: Props = $props();

  // past this, skip syntax highlight + minimap and open as plain fast text - a 50MB
  // log shouldn't make lezer chew the cpu for color nobody's reading
  const BIG_FILE_BYTES = 2 * 1024 * 1024;
  const MINIMAP_KEY = "kurolink:editor:minimap";

  // a tab's path is fixed for its life, so this never actually re-derives
  const image = $derived(isImage(path));
  // svg opens as editable text (it's markup), but it can also flip to a rendered preview
  const isSvg = $derived(!image && /\.svg$/i.test(path));

  let loading = $state(true);
  let loaded = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let dirty = $state(false);
  let wrap = $state(true);
  let minimapOn = $state(false);
  let big = $state(false);

  let imgUrl = $state<string | null>(null);
  let previewing = $state(false);
  let svgUrl = $state<string | null>(null);

  let hostEl = $state<HTMLDivElement>();
  let view: EditorView | null = null;

  const langConf = new Compartment();
  const lookConf = new Compartment();
  const wrapConf = new Compartment();
  const mapConf = new Compartment();

  $effect(() => {
    const d = dirty;
    const id = channelId;
    // fire untracked - onDirtyChange writes MainView's `tabs`, and reading `tabs`
    // inside it would chain this effect to tabs and loop forever (see editor tabs gotcha)
    untrack(() => onDirtyChange(id, d));
  });

  function basename(p: string): string {
    const i = p.lastIndexOf("/");
    return i < 0 ? p : p.slice(i + 1);
  }

  // map the lezer highlight tags onto the active ghostty palette so code recolors
  // with the preset, same as the canvas does. comments ride on `black` (the dim slot).
  function buildHighlight(a: ResolvedTheme) {
    const g = a.ghostty;
    return HighlightStyle.define([
      { tag: [t.keyword, t.operatorKeyword, t.modifier], color: g.magenta },
      { tag: [t.controlKeyword, t.moduleKeyword], color: g.magenta },
      { tag: [t.name, t.deleted, t.character, t.macroName, t.propertyName], color: g.foreground },
      { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: g.blue },
      { tag: [t.typeName, t.className, t.namespace, t.changed, t.annotation, t.self], color: g.yellow },
      { tag: [t.number, t.bool, t.atom, t.constant(t.name), t.standard(t.name)], color: g.yellow },
      { tag: [t.string, t.inserted, t.special(t.string)], color: g.green },
      { tag: [t.operator, t.url, t.escape, t.regexp], color: g.cyan },
      { tag: [t.meta, t.comment, t.lineComment, t.blockComment], color: g.black, fontStyle: "italic" },
      { tag: t.invalid, color: g.red },
      { tag: t.strong, fontWeight: "bold" },
      { tag: t.emphasis, fontStyle: "italic" },
      { tag: t.strikethrough, textDecoration: "line-through" },
      { tag: t.heading, fontWeight: "bold", color: g.red },
      { tag: t.link, color: g.cyan, textDecoration: "underline" },
    ]);
  }

  // accent-driven bits stay as rgb(var(--accent-rgb)) literals so they retint with the
  // cockpit for free; this rebuild only carries what isn't a css var (font + palette).
  function buildLook(a: ResolvedTheme) {
    return [
      EditorView.theme(
        {
          "&": { height: "100%", backgroundColor: "transparent", color: "var(--text-primary)" },
          ".cm-scroller": { fontFamily: a.fontStack, fontSize: `${a.fontSize}px`, lineHeight: "1.5" },
          ".cm-content": { caretColor: "rgb(var(--accent-rgb))" },
          ".cm-gutters": {
            backgroundColor: "transparent",
            color: "var(--text-dim)",
            border: "none",
          },
          ".cm-activeLine": { backgroundColor: "rgba(var(--accent-rgb), 0.05)" },
          ".cm-activeLineGutter": {
            backgroundColor: "rgba(var(--accent-rgb), 0.07)",
            color: "rgb(var(--accent-rgb))",
          },
          "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground":
            { backgroundColor: "rgba(var(--accent-rgb), 0.25)" },
          "&.cm-focused .cm-cursor": { borderLeftColor: "rgb(var(--accent-rgb))" },
          ".cm-selectionMatch": { backgroundColor: "rgba(var(--accent-rgb), 0.12)" },
          ".cm-searchMatch": {
            backgroundColor: "rgba(var(--accent-rgb), 0.18)",
            outline: "1px solid rgba(var(--accent-rgb), 0.4)",
          },
          ".cm-searchMatch.cm-searchMatch-selected": {
            backgroundColor: "rgba(var(--accent-rgb), 0.4)",
          },
          ".cm-panels": {
            backgroundColor: "var(--bg-secondary)",
            color: "var(--text-primary)",
            borderColor: "var(--border-glow)",
          },
          ".cm-panel input, .cm-panel button": { fontFamily: "inherit" },
          ".cm-foldPlaceholder": {
            backgroundColor: "rgba(var(--accent-rgb), 0.1)",
            border: "none",
            color: "var(--text-secondary)",
          },
        },
        { dark: true },
      ),
      syntaxHighlighting(buildHighlight(a)),
    ];
  }

  function buildMinimap() {
    return showMinimap.of({
      create: () => {
        const dom = document.createElement("div");
        dom.classList.add("cm-minimap-kl");
        return { dom };
      },
      displayText: "blocks",
      showOverlay: "always",
    });
  }

  function makeState(doc: string): EditorState {
    return EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        EditorState.allowMultipleSelections.of(true),
        keymap.of([
          { key: "Mod-s", preventDefault: true, run: () => (save(), true) },
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) dirty = true;
        }),
        langConf.of([]),
        lookConf.of(buildLook(appearance.active)),
        wrapConf.of(wrap ? EditorView.lineWrapping : []),
        mapConf.of([]),
      ],
    });
  }

  async function loadLanguage(p: string) {
    const desc = LanguageDescription.matchFilename(languages, basename(p));
    if (!desc || !view) {
      view?.dispatch({ effects: langConf.reconfigure([]) });
      return;
    }
    try {
      const support = await desc.load();
      view.dispatch({ effects: langConf.reconfigure(support) });
    } catch {
      // language chunk failed to load - plain text is a fine fallback
    }
  }

  function applyMinimap() {
    const on = minimapOn && !big;
    view?.dispatch({ effects: mapConf.reconfigure(on ? buildMinimap() : []) });
    // the minimap draws synchronously while its own gutter is still being laid out, so
    // the first paint measures wrong (empty fat box). it redraws on any later update, so
    // nudge it once after layout settles. no docChanged here, so it won't flag dirty.
    if (on) requestAnimationFrame(() => view?.dispatch({}));
  }

  async function loadText() {
    loading = true;
    error = null;
    loaded = false;
    try {
      const text = await sftpReadFile(sessionId, path);
      big = text.length > BIG_FILE_BYTES;
      // fresh state per load so undo history doesn't reach back to an empty buffer.
      // setState isn't a transaction, so the dirty listener never fires for the load.
      view?.setState(makeState(text));
      loaded = true;
      dirty = false;
      if (!big) loadLanguage(path);
      applyMinimap();
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  async function loadImage() {
    loading = true;
    error = null;
    loaded = false;
    try {
      const buf = await sftpReadBytes(sessionId, path);
      if (imgUrl) URL.revokeObjectURL(imgUrl);
      imgUrl = URL.createObjectURL(new Blob([buf], { type: imageMime(path) }));
      loaded = true;
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  function reload() {
    if (image) loadImage();
    else loadText();
  }

  async function save() {
    if (saving || !loaded || image) return;
    saving = true;
    error = null;
    try {
      const text = view?.state.doc.toString() ?? "";
      await sftpWriteFile(sessionId, path, text);
      dirty = false;
    } catch (e) {
      error = String(e);
    } finally {
      saving = false;
    }
  }

  function toggleWrap() {
    wrap = !wrap;
    view?.dispatch({ effects: wrapConf.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }

  // render the LIVE buffer (so unsaved edits show), not the on-disk bytes. image/svg+xml
  // in an <img> is a sandboxed render - no script execution, no external fetches.
  function togglePreview() {
    previewing = !previewing;
    if (svgUrl) {
      URL.revokeObjectURL(svgUrl);
      svgUrl = null;
    }
    if (previewing) {
      const text = view?.state.doc.toString() ?? "";
      svgUrl = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
    }
  }

  function toggleMinimap() {
    minimapOn = !minimapOn;
    try {
      localStorage.setItem(MINIMAP_KEY, minimapOn ? "1" : "0");
    } catch {
      // private mode / storage disabled, the toggle just won't persist
    }
    applyMinimap();
  }

  onMount(() => {
    try {
      minimapOn = localStorage.getItem(MINIMAP_KEY) === "1";
    } catch {
      minimapOn = false;
    }

    if (image) {
      loadImage();
    } else {
      view = new EditorView({ state: makeState(""), parent: hostEl! });
      loadText();
    }

    return () => {
      view?.destroy();
      view = null;
      if (imgUrl) URL.revokeObjectURL(imgUrl);
      if (svgUrl) URL.revokeObjectURL(svgUrl);
    };
  });

  // recolor + refont live when the preset/overrides change, mirroring TerminalPanel
  $effect(() => {
    const a = appearance.active;
    if (!view) return;
    view.dispatch({ effects: lookConf.reconfigure(buildLook(a)) });
  });

  $effect(() => {
    if (active && view) view.focus();
  });
</script>

<div class="editor" class:hidden={!active}>
  <div class="editor-bar">
    {#if !image}
      <span class="editor-dot" class:dirty></span>
    {/if}
    <span class="editor-path" title={path}>{path}</span>
    {#if image}<span class="editor-tag">IMAGE</span>{/if}
    <span class="editor-spacer"></span>
    {#if error && loaded}<span class="editor-err" title={error}>save failed</span>{/if}
    {#if isSvg}
      <button
        class="editor-btn {previewing ? 'on' : ''}"
        onclick={togglePreview}
        title="Render the SVG"
      >
        PREVIEW
      </button>
    {/if}
    {#if !image}
      <button class="editor-btn {wrap ? 'on' : ''}" onclick={toggleWrap} title="Toggle line wrap">
        WRAP
      </button>
      <button
        class="editor-btn {minimapOn ? 'on' : ''}"
        onclick={toggleMinimap}
        title="Toggle minimap"
        disabled={big}
      >
        MAP
      </button>
    {/if}
    <button class="editor-btn" onclick={reload} disabled={loading || saving} title="Reload from host">
      RELOAD
    </button>
    {#if !image}
      <button class="editor-btn save" onclick={save} disabled={!dirty || saving}>
        {saving ? "..." : "SAVE"}
      </button>
    {/if}
  </div>

  {#if image}
    {#if loading}
      <div class="editor-state">DECODING {basename(path)}...</div>
    {:else if error}
      <div class="editor-state err">{error}</div>
    {:else if imgUrl}
      <div class="img-stage">
        <img class="img-view" src={imgUrl} alt={basename(path)} />
      </div>
    {/if}
  {:else}
    <div class="cm-wrap">
      <div class="cm-host" bind:this={hostEl}></div>
      {#if previewing && svgUrl}
        <div class="img-stage as-overlay">
          <img class="img-view" src={svgUrl} alt="rendered svg" />
        </div>
      {/if}
      {#if loading}
        <div class="editor-state overlay">READING {basename(path)}...</div>
      {:else if error && !loaded}
        <div class="editor-state err overlay">{error}</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .editor {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    /* join the glass chain like .terminal-inner - the acrylic reaches through */
    background: var(--term-tint, rgba(6, 6, 14, 0.62));
  }

  .editor.hidden {
    display: none;
  }

  .editor-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.6rem;
    border-bottom: 1px solid var(--border-subtle);
    background: rgba(8, 8, 16, 0.45);
    flex-shrink: 0;
  }

  .editor-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--text-dim);
  }

  .editor-dot.dirty {
    background: var(--accent-warning);
    box-shadow: 0 0 5px var(--accent-warning);
  }

  .editor-path {
    font-size: 0.66rem;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    direction: rtl;
    text-align: left;
  }

  .editor-tag {
    font-size: 0.55rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    color: rgb(var(--accent-rgb));
    border: 1px solid rgba(var(--accent-rgb), 0.4);
    padding: 0.05rem 0.3rem;
    flex-shrink: 0;
  }

  .editor-spacer {
    flex: 1;
  }

  .editor-err {
    font-size: 0.6rem;
    color: var(--accent-secondary);
    flex-shrink: 0;
  }

  .editor-btn {
    background: transparent;
    border: 1px solid var(--border-glow);
    color: var(--text-secondary);
    font-family: inherit;
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    padding: 0.2rem 0.55rem;
    cursor: pointer;
    flex-shrink: 0;
    transition: all var(--transition-fast);
  }

  .editor-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .editor-btn:hover:not(:disabled) {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: rgba(var(--accent-rgb), 0.06);
  }

  .editor-btn.on {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: rgba(var(--accent-rgb), 0.1);
  }

  .editor-btn.save:hover:not(:disabled) {
    box-shadow: 0 0 8px rgba(var(--accent-rgb), 0.2);
  }

  .cm-wrap {
    flex: 1;
    min-height: 0;
    position: relative;
  }

  .cm-host {
    position: absolute;
    inset: 0;
  }

  .cm-host :global(.cm-editor) {
    height: 100%;
  }

  .cm-host :global(.cm-editor.cm-focused) {
    outline: none;
  }

  .cm-host :global(.cm-minimap-kl) {
    opacity: 0.55;
    transition: opacity var(--transition-fast);
  }

  .cm-host :global(.cm-minimap-kl:hover) {
    opacity: 0.9;
  }

  .cm-host :global(.cm-scroller)::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  .cm-host :global(.cm-scroller)::-webkit-scrollbar-thumb {
    background: rgba(var(--accent-rgb), 0.3);
  }

  .cm-host :global(.cm-scroller)::-webkit-scrollbar-track {
    background: transparent;
  }

  .img-stage.as-overlay {
    position: absolute;
    inset: 0;
    z-index: 5;
  }

  .img-stage {
    flex: 1;
    min-height: 0;
    display: grid;
    place-items: center;
    overflow: auto;
    padding: 1rem;
    /* checkerboard so transparent pngs read as transparent, not "black image" */
    background-image:
      linear-gradient(45deg, rgba(255, 255, 255, 0.04) 25%, transparent 25%),
      linear-gradient(-45deg, rgba(255, 255, 255, 0.04) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, rgba(255, 255, 255, 0.04) 75%),
      linear-gradient(-45deg, transparent 75%, rgba(255, 255, 255, 0.04) 75%);
    background-size: 20px 20px;
    background-position: 0 0, 0 10px, 10px -10px, -10px 0;
  }

  .img-view {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    image-rendering: auto;
    box-shadow: 0 0 30px rgba(0, 0, 0, 0.5);
  }

  .editor-state {
    flex: 1;
    display: grid;
    place-items: center;
    color: var(--accent-primary);
    font-size: 0.68rem;
    font-weight: 600;
    letter-spacing: 0.12em;
    padding: 1rem;
    text-align: center;
  }

  .editor-state.overlay {
    position: absolute;
    inset: 0;
    background: var(--term-tint, rgba(6, 6, 14, 0.62));
  }

  .editor-state.err {
    color: var(--accent-secondary);
    font-weight: 400;
    letter-spacing: 0;
    line-height: 1.5;
  }
</style>
