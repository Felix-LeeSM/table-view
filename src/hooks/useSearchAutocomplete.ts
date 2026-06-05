import { useEffect, useMemo, useState } from "react";
import { autocompletion } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import {
  getSearchIndexMapping,
  listSearchCatalogSummary,
} from "@lib/tauri/search";
import {
  createSearchDslCompletionSource,
  readSearchDslTarget,
} from "@lib/search/searchDslCompletion";
import type {
  SearchCatalogSummary,
  SearchIndexMapping,
  SearchProductKind,
} from "@/types/search";

export interface UseSearchAutocompleteArgs {
  connectionId: string;
  queryText: string;
  enabled: boolean;
  target?: SearchProductKind;
}

export function useSearchAutocomplete({
  connectionId,
  queryText,
  enabled,
  target = "elasticsearch",
}: UseSearchAutocompleteArgs): Extension[] {
  const [catalog, setCatalog] = useState<SearchCatalogSummary | null>(null);
  const [mappings, setMappings] = useState<
    Record<string, SearchIndexMapping | null | undefined>
  >({});

  useEffect(() => {
    setCatalog(null);
    setMappings({});
  }, [connectionId, target]);

  useEffect(() => {
    if (!enabled || target !== "elasticsearch") {
      setCatalog(null);
      return;
    }

    let cancelled = false;
    void listSearchCatalogSummary(connectionId)
      .then((next) => {
        if (!cancelled) setCatalog(next);
      })
      .catch(() => {
        if (!cancelled) setCatalog(null);
      });

    return () => {
      cancelled = true;
    };
  }, [connectionId, enabled, target]);

  const activeIndex = useMemo(
    () => readSearchDslTarget(queryText, catalog),
    [catalog, queryText],
  );

  useEffect(() => {
    if (
      !enabled ||
      target !== "elasticsearch" ||
      !activeIndex ||
      mappings[activeIndex] !== undefined
    ) {
      return;
    }

    let cancelled = false;
    void getSearchIndexMapping(connectionId, activeIndex)
      .then((mapping) => {
        if (cancelled) return;
        setMappings((prev) => ({ ...prev, [activeIndex]: mapping }));
      })
      .catch(() => {
        if (cancelled) return;
        setMappings((prev) => ({ ...prev, [activeIndex]: null }));
      });

    return () => {
      cancelled = true;
    };
  }, [activeIndex, connectionId, enabled, mappings, target]);

  const mapping = activeIndex ? mappings[activeIndex] : undefined;

  return useMemo(() => {
    if (!enabled) return [];
    return [
      autocompletion({
        override: [
          createSearchDslCompletionSource({
            catalog,
            mapping: mapping ?? undefined,
            target,
          }),
        ],
      }),
    ];
  }, [catalog, enabled, mapping, target]);
}
