export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseJson(text: string) {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return null;
  }
}

export function reason(error: unknown) {
  if (!(error instanceof Error)) return "error";
  return error.name === "Error" ? error.message : error.name;
}
