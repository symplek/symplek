/**
 * The one place the CLI turns an agent's name into a JavaScript identifier.
 *
 * An agent is named in kebab-case (`code-reviewer`) and exported from its
 * generated file in camelCase (`codeReviewer`). `add`, `validate` and
 * `generate` all use the rules here, so a name one of them accepts is a name
 * the others can turn into a file that parses.
 */

/** Lowercase letters and digits in hyphen-separated segments, starting with a letter. */
export const KEBAB_CASE_REGEX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** Words that cannot be the name of an exported function. */
const RESERVED_WORDS = new Set([
  "arguments", "await", "break", "case", "catch", "class", "const", "continue",
  "debugger", "default", "delete", "do", "else", "enum", "eval", "export",
  "extends", "false", "finally", "for", "function", "if", "implements",
  "import", "in", "instanceof", "interface", "let", "new", "null", "package",
  "private", "protected", "public", "return", "static", "super", "switch",
  "this", "throw", "true", "try", "typeof", "var", "void", "while", "with",
  "yield",
]);

/**
 * `code-reviewer` to `codeReviewer`. A segment may start with a digit
 * (`agent-2` to `agent2`), so the hyphen is dropped before digits too.
 */
export function kebabToCamel(name: string): string {
  return name.replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

/** True when `word` cannot be used as an exported function's name. */
export function isReservedWord(word: string): boolean {
  return RESERVED_WORDS.has(word);
}

/** Why `name` cannot be an agent name, or undefined when it can. */
export function agentNameProblem(name: string): string | undefined {
  if (!KEBAB_CASE_REGEX.test(name)) {
    return "Agent name must be kebab-case: lowercase letters, numbers and hyphens, starting with a letter (e.g. my-agent)";
  }
  if (isReservedWord(kebabToCamel(name))) {
    return `"${name}" is a JavaScript reserved word, so it cannot name the exported agent function. Pick another name (e.g. ${name}-agent)`;
  }
  return undefined;
}
