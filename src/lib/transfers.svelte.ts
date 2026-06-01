import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { SftpEntry } from "./types";
import {
  sftpDownload,
  sftpUpload,
  sftpUploadBytes,
  cancelTransfer,
} from "./ipc";

export type TransferDirection = "up" | "down";
export type TransferStatus = "active" | "done" | "error" | "cancelled";

export interface Transfer {
  id: string;
  name: string;
  direction: TransferDirection;
  transferred: number;
  total: number;
  status: TransferStatus;
  error?: string;
}

function baseName(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i < 0 ? p : p.slice(i + 1);
}

function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

// single source of truth for the transfer tray. one progress listener feeds every
// in-flight transfer by id; the per-transfer ipc promise settles into done/error.
class TransferStore {
  items = $state<Transfer[]>([]);
  private started = false;

  init() {
    if (this.started) return;
    this.started = true;
    listen<{ id: string; transferred: number; total: number }>(
      "transfer-progress",
      (e) => {
        const t = this.items.find((x) => x.id === e.payload.id);
        if (!t) return;
        t.transferred = e.payload.transferred;
        if (e.payload.total > t.total) t.total = e.payload.total;
      },
    );
  }

  private add(direction: TransferDirection, name: string, total: number): Transfer {
    const item: Transfer = {
      id: crypto.randomUUID(),
      name,
      direction,
      transferred: 0,
      total,
      status: "active",
    };
    this.items = [item, ...this.items];
    return item;
  }

  // look the item back up by id so we mutate the reactive proxy svelte stored in
  // `items`, NOT the raw object `add` handed back - mutating the raw ref updates a
  // value nobody's subscribed to, which is exactly how a "done" transfer stays "active"
  private settle(id: string, err?: unknown) {
    const item = this.items.find((t) => t.id === id);
    if (!item) return;
    if (err === undefined) {
      item.status = "done";
      if (item.total > 0) item.transferred = item.total;
      return;
    }
    const msg = String(err);
    // the rust side rejects cancelled streams with this exact phrase
    if (msg.includes("cancelled")) {
      item.status = "cancelled";
    } else {
      item.status = "error";
      item.error = msg;
    }
  }

  async download(sessionId: string, entry: SftpEntry) {
    const localPath = await save({ defaultPath: entry.name });
    if (!localPath) return;
    const item = this.add("down", entry.name, entry.size);
    try {
      await sftpDownload(sessionId, entry.path, localPath, item.id);
      this.settle(item.id);
    } catch (e) {
      this.settle(item.id, e);
    }
  }

  // native picker -> rust streams local->remote. onDone refreshes the dest listing.
  async uploadPicker(sessionId: string, destDir: string, onDone?: () => void) {
    const picked = await open({ multiple: true });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    for (const p of paths) {
      const name = baseName(p);
      const item = this.add("up", name, 0);
      try {
        await sftpUpload(sessionId, p, joinPath(destDir, name), item.id);
        this.settle(item.id);
      } catch (e) {
        this.settle(item.id, e);
      }
    }
    onDone?.();
  }

  // drag-drop path - the File's bytes go straight through (no local path exists)
  async uploadFiles(
    sessionId: string,
    destDir: string,
    files: File[],
    onDone?: () => void,
  ) {
    for (const f of files) {
      const item = this.add("up", f.name, f.size);
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        await sftpUploadBytes(sessionId, joinPath(destDir, f.name), bytes, item.id);
        this.settle(item.id);
      } catch (e) {
        this.settle(item.id, e);
      }
    }
    onDone?.();
  }

  async cancel(id: string) {
    await cancelTransfer(id).catch(() => {});
  }

  dismiss(id: string) {
    this.items = this.items.filter((t) => t.id !== id);
  }

  clearFinished() {
    this.items = this.items.filter((t) => t.status === "active");
  }
}

export const transfers = new TransferStore();
