import { invoke } from "@tauri-apps/api/core";

export interface PersistMruPayload {
  connectionId: string;
  lastUsed: number;
}

export async function persistMru(entries: PersistMruPayload[]): Promise<void> {
  await invoke("persist_mru", { entries });
}

export async function clearMru(): Promise<void> {
  await invoke("clear_mru");
}
