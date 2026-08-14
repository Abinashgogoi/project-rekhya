export type HeaderDefinition<K extends string> = Record<K, readonly string[]>;

export type HeaderMap<K extends string> = Partial<Record<K, string>>;

export function normalizeHeader(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function detectHeaderMap<K extends string>(
  headers: string[],
  definitions: HeaderDefinition<K>,
  required: readonly K[],
) {
  const normalized = new Map<string, string[]>();
  for (const header of headers) {
    const key = normalizeHeader(header);
    if (!key) continue;
    normalized.set(key, [...(normalized.get(key) ?? []), header]);
  }

  const map: HeaderMap<K> = {};
  const errors: string[] = [];
  for (const [field, aliases] of Object.entries(definitions) as Array<[K, readonly string[]]>) {
    for (const alias of aliases) {
      const candidates = [...new Set(normalized.get(normalizeHeader(alias)) ?? [])];
      if (candidates.length > 1) {
        errors.push(`Ambiguous columns for ${field}: ${candidates.join(", ")}`);
        break;
      }
      if (candidates.length === 1) {
        map[field] = candidates[0];
        break;
      }
    }
  }
  for (const field of required) if (!map[field]) errors.push(`Required column not found: ${field}`);
  return { map, errors };
}
