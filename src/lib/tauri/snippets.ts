import { invoke } from "@tauri-apps/api/core";

export interface PersistSnippetPayload {
  id: string;
  name: string;
  body: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface SnippetRow {
  id: string;
  name: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

export async function persistSnippets(
  snippets: PersistSnippetPayload[],
): Promise<void> {
  await invoke("persist_snippets", { snippets });
}

export async function listSnippets(): Promise<SnippetRow[]> {
  return invoke<SnippetRow[]>("list_snippets");
}
