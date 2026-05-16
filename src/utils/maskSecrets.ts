const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-****"],
  [/\b(api_key=)[^\s&]+/gi, "$1****"],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1****"],
  [/\b(token=)[^\s&]+/gi, "$1****"]
];

export const maskSecrets = (input: string): string =>
  SECRET_PATTERNS.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), input);
