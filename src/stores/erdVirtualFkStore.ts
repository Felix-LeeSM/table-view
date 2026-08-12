/**
 * #2150 — virtual FK persistence (ADR 0055 "표시 + 저장 + reconcile", ADR 0056 (1)
 * "가상 FK 는 connection 단위 로컬 persist").
 *
 * Storage is the SQLite `settings` KV through the existing `persist_setting` /
 * `get_setting` commands, the same route `themeFavoritesStore` uses — no new
 * table, no migration, no new IPC. The row is scoped `(connection, database)`
 * because that is the scope the ERD tab itself carries
 * (`MainArea.tsx` renders `SchemaErdPanel` with `connectionId` + `database`) and
 * the scope the repo already keys workspace state by (`workspaces` PK is
 * `(connection_id, db_name)`). Keying by connection alone would let a link drawn
 * against one database draw itself on another database that happens to share
 * schema and table names.
 *
 * Writes are optimistic — the canvas updates first, then the IPC fires and a
 * rejection surfaces as a toast, because nothing reconciles a lost write later.
 *
 * ponytail: no cross-window `state-changed` route, and the ceiling is uneven the
 * same way `themeFavoritesStore` spells out. An added link reaches a second
 * window the next time its ERD panel mounts, because `persist_setting` leaves a
 * row for the hydrate below to read. A *reset* does not: it deletes the row,
 * `getSetting` then answers null, the hydrate keeps the list it already had, and
 * that window goes on drawing links the user cleared. Nothing repairs it later
 * either — `src/lib/runtime/settings/settingsReceiver.ts` registers
 * `setting.onUpdated` only, and its dispatcher does not know the
 * `erd_virtual_fk:` keys. Since #2150 ships no way to draw a link, the reset is
 * the only edit a user can reach, so the half that does not converge is the half
 * they get. Wire a `setting.onReset` handler if two windows on one ERD turns out
 * to matter.
 */

import i18n from "@lib/i18n";
import { logger } from "@lib/logger";
import { toast } from "@lib/runtime/toast";
import {
  parseVirtualForeignKeyLinks,
  type VirtualForeignKeyLink,
} from "@lib/schemaGraphVirtualFk";
import {
  getSetting,
  persistSettingValue,
  resetSetting,
} from "@lib/tauri/settings";
import { create } from "zustand";

/** Stable empty reference so a scope with no links does not re-render on read. */
export const NO_VIRTUAL_FOREIGN_KEYS: readonly VirtualForeignKeyLink[] = [];

/** SQLite `settings` key holding one ERD's links (JSON array). */
export function erdVirtualFkSettingKey(
  connectionId: string,
  database: string,
): string {
  return `erd_virtual_fk:${connectionId}:${database}`;
}

export interface ErdVirtualFkState {
  /** Keyed by {@link erdVirtualFkSettingKey}. */
  readonly linksByScope: Readonly<
    Record<string, readonly VirtualForeignKeyLink[]>
  >;
  /** Read the persisted links. A missing or unreadable value changes nothing. */
  hydrateVirtualFks: (connectionId: string, database: string) => Promise<void>;
  /** Add a link, or replace the one that already carries the same id. */
  addVirtualFk: (
    connectionId: string,
    database: string,
    link: VirtualForeignKeyLink,
  ) => Promise<void>;
  /** Reset affordance — drop every link on this ERD and delete the row. */
  resetVirtualFks: (connectionId: string, database: string) => Promise<void>;
}

export const useErdVirtualFkStore = create<ErdVirtualFkState>()((set, get) => ({
  linksByScope: {},

  hydrateVirtualFks: async (connectionId, database) => {
    const key = erdVirtualFkSettingKey(connectionId, database);
    try {
      const raw: unknown = await getSetting(key);
      // Not `=== null`: the key may be absent, and an IPC boundary can hand
      // back any shape at runtime. Anything but a string means "no answer".
      if (typeof raw !== "string") return;
      const parsed = parseVirtualForeignKeyLinks(raw);
      if (parsed === null) return;
      set({ linksByScope: { ...get().linksByScope, [key]: parsed } });
    } catch (e) {
      logger.warn(
        "[erdVirtualFkStore] get_setting failed, keeping current links:",
        e instanceof Error ? e.message : e,
      );
    }
  },

  addVirtualFk: async (connectionId, database, link) => {
    const key = erdVirtualFkSettingKey(connectionId, database);
    const current = get().linksByScope[key] ?? NO_VIRTUAL_FOREIGN_KEYS;
    const next = [
      ...current.filter((entry) => entry.id !== link.id),
      link,
    ] as readonly VirtualForeignKeyLink[];
    set({ linksByScope: { ...get().linksByScope, [key]: next } });
    await persistLinks(key, next);
  },

  resetVirtualFks: async (connectionId, database) => {
    const key = erdVirtualFkSettingKey(connectionId, database);
    set({
      linksByScope: {
        ...get().linksByScope,
        [key]: NO_VIRTUAL_FOREIGN_KEYS,
      },
    });
    // `resetSetting` deletes the row; pairing it with a `persistSettingValue`
    // of the empty list would write a row straight back (see the contract note
    // on `resetSetting` in `src/lib/tauri/settings.ts`).
    try {
      await resetSetting(key);
    } catch (e) {
      logger.warn(
        "[erdVirtualFkStore] reset_setting failed (UI already applied):",
        e instanceof Error ? e.message : e,
      );
      toast.error(i18n.t("feedback:storageWriteFailed"));
    }
  },
}));

async function persistLinks(
  key: string,
  links: readonly VirtualForeignKeyLink[],
): Promise<void> {
  try {
    await persistSettingValue(key, links);
  } catch (e) {
    logger.warn(
      "[erdVirtualFkStore] persist_setting failed (UI already applied):",
      e instanceof Error ? e.message : e,
    );
    toast.error(i18n.t("feedback:storageWriteFailed"));
  }
}

/** Module-scope store reset for deterministic tests (react convention). */
export function __resetErdVirtualFkStoreForTests(): void {
  useErdVirtualFkStore.setState({ linksByScope: {} });
}
