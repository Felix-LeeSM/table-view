import { create } from "zustand";
import { logger } from "@lib/logger";
import { toast } from "@lib/runtime/toast";
import i18n from "@lib/i18n";
import {
  listSnippets,
  persistSnippets as persistSnippetsRemote,
  type PersistSnippetPayload,
} from "@lib/tauri/snippets";

// ---------------------------------------------------------------------------
// SQL snippet/template store (#1528).
//
// Mirrors `favoritesStore` (SQLite SOT via IPC, optimistic fire-and-forget
// mutate + error toast on reject) with two simplifications:
//   - Snippets are global (no connection scope) — reusable templates.
//   - No cross-window IPC bridge. Snippet edits are low-frequency; the two
//     windows converge on the next boot via SQLite.
//     ponytail: skip the bridge, add attachZustandIpcBridge if live
//     multi-window snippet convergence is ever asked for.
// ---------------------------------------------------------------------------

export interface Snippet {
  id: string;
  name: string;
  /** Snippet template body; may contain `{{placeholder}}` variables. */
  body: string;
  createdAt: number;
  updatedAt: number;
}

function toPersistPayload(snippets: Snippet[]): PersistSnippetPayload[] {
  return snippets.map((s, idx) => ({
    id: s.id,
    name: s.name,
    body: s.body,
    sortOrder: idx,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  }));
}

function persistSnippets(snippets: Snippet[]): void {
  // Fire-and-forget — SQLite is the SOT, so a silent failure would lose the
  // snippet on the next boot. Surface a dev log + error toast on reject.
  void persistSnippetsRemote(toPersistPayload(snippets)).catch((e: unknown) => {
    const message = e instanceof Error ? e.message : String(e ?? "");
    logger.warn(`[snippetsStore] persist_snippets failed: ${message}`);
    toast.error(i18n.t("feedback:storageWriteFailed"));
  });
}

interface SnippetsState {
  snippets: Snippet[];
  addSnippet: (name: string, body: string) => void;
  removeSnippet: (id: string) => void;
  loadPersistedSnippets: () => Promise<void>;
}

let snippetCounter = 0;

/** Test-only reset for the module-scope id counter (mirrors favoritesStore). */
export function __resetSnippetCounterForTests(): void {
  snippetCounter = 0;
}

export const useSnippetsStore = create<SnippetsState>((set) => ({
  snippets: [],

  addSnippet: (name, body) => {
    snippetCounter++;
    const now = Date.now();
    const newSnippet: Snippet = {
      id: `snip-${snippetCounter}`,
      name,
      body,
      createdAt: now,
      updatedAt: now,
    };
    set((state) => {
      const snippets = [...state.snippets, newSnippet];
      persistSnippets(snippets);
      return { snippets };
    });
  },

  removeSnippet: (id) => {
    set((state) => {
      const snippets = state.snippets.filter((s) => s.id !== id);
      persistSnippets(snippets);
      return { snippets };
    });
  },

  loadPersistedSnippets: async () => {
    try {
      const rows = await listSnippets();
      const snippets: Snippet[] = Array.isArray(rows)
        ? rows.map((r) => ({
            id: r.id,
            name: r.name,
            body: r.body,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
          }))
        : [];

      // Ratchet the counter past any persisted id so new snippets don't collide.
      for (const s of snippets) {
        const num = parseInt(s.id.replace("snip-", ""), 10);
        if (!isNaN(num) && num > snippetCounter) snippetCounter = num;
      }

      set({ snippets });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e ?? "");
      logger.warn(`[snippetsStore] list_snippets failed: ${message}`);
    }
  },
}));
