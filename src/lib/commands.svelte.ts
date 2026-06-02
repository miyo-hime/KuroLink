export interface Command {
  id: string;
  title: string;
  group: string;
  detail?: string;
  keywords?: string;
  chord?: string;
  enabled?: boolean;
  match?: (e: KeyboardEvent) => boolean;
  run: () => void;
}

// one registry to run the ship from. MainView pours the live action set in (it's the
// only place that holds the handlers + state); the palette reads it, the key dispatcher
// matches against it. keybindings and the palette are the same list seen two ways.
class CommandRegistry {
  open = $state(false);
  items = $state<Command[]>([]);

  set(cmds: Command[]) {
    this.items = cmds;
  }
  clear() {
    this.items = [];
  }

  toggle() {
    this.open = !this.open;
  }
  hide() {
    this.open = false;
  }

  // first command whose chord matches wins. disabled ones sit it out.
  dispatch(e: KeyboardEvent): boolean {
    for (const c of this.items) {
      if (c.enabled === false) continue;
      if (c.match?.(e)) {
        c.run();
        return true;
      }
    }
    return false;
  }
}

export const commands = new CommandRegistry();
