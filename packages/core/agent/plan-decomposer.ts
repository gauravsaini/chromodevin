/**
 * Plan Decomposer for Kevin.
 * Deconstructs natural language compound commands ("Open google.com and search for laptops",
 * "Type hello world then click search") into sequential executable sub-goals.
 * Supports composite action planning for hover-dependent elements (e.g. list item delete buttons).
 */

export function decomposeCommand(command: string | any): string[] {
  if (!command || typeof command !== 'string') return [];
  const clean = command.trim();
  if (!clean) return [];

  // Split on chaining delimiters:
  // - Arrows: '-->', '->', '=>'
  // - Semicolons / Pipes / Newlines
  // - Sequential words: 'and then', 'then', 'after that'
  const ACTION_VERBS = '(?:open|go\\s+to|navigate|search|find|click|select|press(?! key| escape| tab| enter)|type|scroll|extract|read|hover|delete|remove|mark|check|uncheck|toggle|add|clear|fill|submit)';
  const parts = clean
    .split(new RegExp(`\\s*(?:--+>|-+>|==+>|;|\\n|\\||,\\s*and\\s+then\\s+|,\\s*then\\s+|,\\s*after\\s+that\\s+|\\band\\s+then\\b|\\bafter\\s+that\\b|\\bthen\\b|,\\s*and\\s+(?=${ACTION_VERBS}\\b)|\\band\\b(?!\\s*(?:press|hit)?\\s*enter\\b)(?!\\s*submit\\b)(?=\\s+${ACTION_VERBS}\\b)|,\\s*(?=${ACTION_VERBS}\\b))\\s*`, 'i'))
    .map((p) => p.trim())
    .filter(Boolean);

  const expanded: string[] = [];
  for (const part of parts) {
    const clickChildMatch = part.match(/^(?:click\s+(?:the\s+)?(delete|destroy|remove)\s*(?:button)?)\s+(?:on|for|of)\s+["']?([^"']+)["']?$/i);
    const deleteItemMatch = part.match(/^(?:delete|remove)\s+(?:todo|task|item)\s+["']?([^"']+)["']?$/i) ||
      part.match(/^(?:delete|remove)\s+["']([^"']+)["']$/i);

    if (clickChildMatch) {
      const verb = clickChildMatch[1].toLowerCase();
      const target = clickChildMatch[2].trim();
      expanded.push(`hover "${target}"`);
      expanded.push(`click ${verb}`);
    } else if (deleteItemMatch) {
      const target = deleteItemMatch[1].trim();
      expanded.push(`hover "${target}"`);
      expanded.push('click delete');
    } else if (/^(?:search|look\s+up)\s+/i.test(part) && !/^search\s+for\s+/i.test(part)) {
      expanded.push(`search for ${part.replace(/^(?:search|look\s+up)\s+(?:for\s+)?/i, '')}`);
    } else {
      expanded.push(part);
    }
  }

  return expanded;
}
