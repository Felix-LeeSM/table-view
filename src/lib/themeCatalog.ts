export interface ThemeCatalogEntry {
  id: string;
  name: string;
  vibe: string;
  swatch: string;
}

export const THEME_CATALOG = [
  {
    id: "slate",
    name: "Slate (default)",
    vibe: "shadcn default",
    swatch: "#4f46e5",
  },
  {
    id: "github",
    name: "GitHub Primer",
    vibe: "calm professional",
    swatch: "#0969da",
  },
  {
    id: "linear",
    name: "Linear",
    vibe: "refined productivity",
    swatch: "#5e6ad2",
  },
  { id: "vercel", name: "Vercel", vibe: "pure monochrome", swatch: "#000000" },
  { id: "stripe", name: "Stripe", vibe: "fintech gradient", swatch: "#635bff" },
  { id: "notion", name: "Notion", vibe: "minimal warm", swatch: "#2e2a24" },
  {
    id: "arc",
    name: "Arc Browser",
    vibe: "colorful playful",
    swatch: "#ff6b9d",
  },
  { id: "apple", name: "Apple HIG", vibe: "system native", swatch: "#007aff" },
  {
    id: "darcula",
    name: "JetBrains Darcula",
    vibe: "classic IDE",
    swatch: "#cc7832",
  },
  {
    id: "supabase",
    name: "Supabase",
    vibe: "developer tool",
    swatch: "#3ecf8e",
  },
  {
    id: "raycast",
    name: "Raycast",
    vibe: "command palette",
    swatch: "#ff6363",
  },
  { id: "warp", name: "Warp", vibe: "modern terminal", swatch: "#ff3a8c" },
  {
    id: "clickhouse",
    name: "ClickHouse",
    vibe: "fast analytics",
    swatch: "#faff69",
  },
  {
    id: "posthog",
    name: "PostHog",
    vibe: "playful analytics",
    swatch: "#f54e00",
  },
  { id: "sentry", name: "Sentry", vibe: "error monitoring", swatch: "#7553ff" },
  { id: "cursor", name: "Cursor", vibe: "AI IDE", swatch: "#000000" },
  { id: "resend", name: "Resend", vibe: "email infra", swatch: "#000000" },
  {
    id: "airtable",
    name: "Airtable",
    vibe: "friendly table tool",
    swatch: "#166ee1",
  },
  {
    id: "mongodb",
    name: "MongoDB",
    vibe: "database classic",
    swatch: "#00684a",
  },
  {
    id: "mastercard",
    name: "Mastercard",
    vibe: "payment card",
    swatch: "#eb001b",
  },
  { id: "ibm", name: "IBM Carbon", vibe: "enterprise", swatch: "#0f62fe" },
  {
    id: "lamborghini",
    name: "Lamborghini",
    vibe: "luxury automotive",
    swatch: "#b59410",
  },
  { id: "figma", name: "Figma", vibe: "design canvas", swatch: "#0acf83" },
  { id: "spotify", name: "Spotify", vibe: "music player", swatch: "#1db954" },
  { id: "uber", name: "Uber", vibe: "mobility", swatch: "#000000" },
  { id: "framer", name: "Framer", vibe: "motion design", swatch: "#0099ff" },
  { id: "claude", name: "Claude", vibe: "anthropic warm", swatch: "#c15f3c" },
  { id: "expo", name: "Expo", vibe: "mobile RN", swatch: "#000020" },
  {
    id: "playstation",
    name: "PlayStation",
    vibe: "gaming console",
    swatch: "#0070d1",
  },
  {
    id: "starbucks",
    name: "Starbucks",
    vibe: "coffee premium",
    swatch: "#006241",
  },
  {
    id: "theverge",
    name: "The Verge",
    vibe: "tech editorial",
    swatch: "#ff4a00",
  },
  { id: "vodafone", name: "Vodafone", vibe: "telecom", swatch: "#e60000" },
  { id: "wired", name: "Wired", vibe: "bold editorial", swatch: "#000000" },
  {
    id: "binance",
    name: "Binance",
    vibe: "crypto exchange",
    swatch: "#f0b90b",
  },
  { id: "bmw", name: "BMW", vibe: "premium auto", swatch: "#1c69d4" },
  {
    id: "bugatti",
    name: "Bugatti",
    vibe: "hypercar luxury",
    swatch: "#00387a",
  },
  { id: "cal", name: "Cal.com", vibe: "scheduling", swatch: "#111827" },
  { id: "clay", name: "Clay", vibe: "data enrichment", swatch: "#6c5ce7" },
  { id: "cohere", name: "Cohere", vibe: "AI platform", swatch: "#ff7759" },
  {
    id: "coinbase",
    name: "Coinbase",
    vibe: "crypto retail",
    swatch: "#0052ff",
  },
  {
    id: "composio",
    name: "Composio",
    vibe: "agent tooling",
    swatch: "#6366f1",
  },
  { id: "elevenlabs", name: "ElevenLabs", vibe: "voice AI", swatch: "#000000" },
  {
    id: "ferrari",
    name: "Ferrari",
    vibe: "racing heritage",
    swatch: "#da291c",
  },
  {
    id: "hashicorp",
    name: "HashiCorp",
    vibe: "infrastructure",
    swatch: "#000000",
  },
  {
    id: "intercom",
    name: "Intercom",
    vibe: "customer messaging",
    swatch: "#286efa",
  },
  { id: "kraken", name: "Kraken", vibe: "crypto pro", swatch: "#7132f5" },
  { id: "lovable", name: "Lovable", vibe: "vibe coding", swatch: "#f97316" },
  { id: "meta", name: "Meta", vibe: "social platform", swatch: "#0866ff" },
  { id: "minimax", name: "MiniMax", vibe: "AI creative", swatch: "#ff5c8a" },
  {
    id: "mintlify",
    name: "Mintlify",
    vibe: "developer docs",
    swatch: "#16a34a",
  },
  { id: "miro", name: "Miro", vibe: "whiteboard", swatch: "#ffd02f" },
  { id: "mistral", name: "Mistral AI", vibe: "open AI", swatch: "#fa520f" },
  { id: "nike", name: "Nike", vibe: "athletic bold", swatch: "#000000" },
  { id: "nvidia", name: "NVIDIA", vibe: "compute platform", swatch: "#76b900" },
  { id: "ollama", name: "Ollama", vibe: "local LLM", swatch: "#000000" },
  {
    id: "opencode",
    name: "opencode",
    vibe: "open coding agent",
    swatch: "#fab283",
  },
  {
    id: "pinterest",
    name: "Pinterest",
    vibe: "visual discovery",
    swatch: "#e60023",
  },
  { id: "renault", name: "Renault", vibe: "european auto", swatch: "#ffcc33" },
  {
    id: "replicate",
    name: "Replicate",
    vibe: "model hosting",
    swatch: "#000000",
  },
  { id: "revolut", name: "Revolut", vibe: "neobank", swatch: "#0075eb" },
  { id: "runway", name: "Runway ML", vibe: "video AI", swatch: "#000000" },
  { id: "sanity", name: "Sanity", vibe: "headless CMS", swatch: "#f03e2f" },
  { id: "shopify", name: "Shopify", vibe: "commerce", swatch: "#008060" },
  { id: "spacex", name: "SpaceX", vibe: "aerospace", swatch: "#005288" },
  {
    id: "superhuman",
    name: "Superhuman",
    vibe: "email premium",
    swatch: "#7c3aed",
  },
  { id: "tesla", name: "Tesla", vibe: "EV minimal", swatch: "#e31937" },
  { id: "together", name: "together.ai", vibe: "AI cloud", swatch: "#0f6fff" },
  {
    id: "voltagent",
    name: "VoltAgent",
    vibe: "agent framework",
    swatch: "#facc15",
  },
  { id: "webflow", name: "Webflow", vibe: "no-code web", swatch: "#4353ff" },
  { id: "wise", name: "Wise", vibe: "global money", swatch: "#163300" },
  { id: "xai", name: "xAI", vibe: "cosmic bold", swatch: "#000000" },
  { id: "zapier", name: "Zapier", vibe: "automation", swatch: "#ff4a00" },
] as const satisfies readonly ThemeCatalogEntry[];

export type ThemeId = (typeof THEME_CATALOG)[number]["id"];

export const THEME_IDS: readonly ThemeId[] = THEME_CATALOG.map((t) => t.id);

export const DEFAULT_THEME_ID: ThemeId = "slate";

const THEME_ID_SET = new Set<string>(THEME_IDS);

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && THEME_ID_SET.has(value);
}
