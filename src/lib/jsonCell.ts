const UNSERIALIZABLE = '"[unserializable]"';

export function safeStringifyCell(value: unknown): string {
  try {
    const result = JSON.stringify(value);
    return result ?? UNSERIALIZABLE;
  } catch {
    return UNSERIALIZABLE;
  }
}
