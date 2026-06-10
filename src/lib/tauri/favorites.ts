import { invoke } from "@tauri-apps/api/core";

export interface PersistFavoritePayload {
  id: string;
  name: string;
  sql: string;
  connectionId: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface FavoriteRow {
  id: string;
  name: string;
  sql: string;
  connectionId: string | null;
  createdAt: number;
  updatedAt: number;
}

export async function persistFavorites(
  favorites: PersistFavoritePayload[],
): Promise<void> {
  await invoke("persist_favorites", { favorites });
}

export async function listFavorites(): Promise<FavoriteRow[]> {
  return invoke<FavoriteRow[]>("list_favorites");
}
