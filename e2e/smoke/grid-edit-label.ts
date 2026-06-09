export function normalizeGridEditorLabel(label: string) {
  return label.toLowerCase();
}

export function isGridEditorLabelMatch(
  actualLabel: string | null,
  expectedLabel: string,
) {
  return (
    actualLabel === expectedLabel ||
    (actualLabel !== null &&
      normalizeGridEditorLabel(actualLabel) ===
        normalizeGridEditorLabel(expectedLabel))
  );
}
