export function kvCommandConfirmationKey(command: string): string | undefined {
  const tokens = tokenizeRedisCommand(command);
  if (tokens[0]?.toUpperCase() !== "KEYS") return undefined;
  return tokens.length === 2 ? tokens[1] : undefined;
}

function tokenizeRedisCommand(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < input.length; index += 1) {
    const ch = input[index] ?? "";
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (ch === "\\" && index + 1 < input.length) {
        index += 1;
        current += input[index] ?? "";
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}
