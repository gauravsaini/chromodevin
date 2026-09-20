/**
 * SchemaExtractor: Structured typed data extraction from page snapshots.
 * Pure unit contract: maps (snapshot, instruction, schema) -> { success, data, missingFields, confidence }.
 */

import type { DOMSnapshot, ExtractionResult, SchemaFieldDef } from '../types.js';

/**
 * Coerces raw string value to requested primitive schema type.
 * Pure function: (rawValue, targetType) -> any
 */
export function coerceValue(rawValue: any, targetType: string): any {
  if (rawValue === undefined || rawValue === null) return null;
  const str = String(rawValue).trim();

  switch (targetType) {
    case 'number': {
      const cleaned = str.replace(/,/g, '');
      const match = cleaned.match(/[-+]?[0-9]*\.?[0-9]+/);
      if (!match || !match[0]) return null;
      const num = parseFloat(match[0]);
      return Number.isNaN(num) ? null : num;
    }

    case 'boolean': {
      const lower = str.toLowerCase();
      if (/(true|yes|in stock|available|enabled|checked|active)/i.test(lower)) return true;
      if (/(false|no|out of stock|unavailable|disabled|unchecked|inactive)/i.test(lower)) return false;
      return null;
    }

    case 'array': {
      if (Array.isArray(rawValue)) return rawValue;
      return str.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    }

    case 'string':
    default:
      return str;
  }
}

/**
 * Normalizes user schema into standard field definitions.
 * Pure function: (schema) -> Array<{ key, type, description, required }>
 */
export function normalizeSchema(schema: any): SchemaFieldDef[] {
  if (!schema) return [];

  // JSON Schema format ({ type: 'object', properties: { ... }, required: [...] })
  if (schema.properties && typeof schema.properties === 'object') {
    const requiredSet = new Set(Array.isArray(schema.required) ? schema.required : []);
    return Object.entries(schema.properties).map(([key, def]: [string, any]) => ({
      key,
      type: typeof def === 'string' ? def : (def.type || 'string'),
      description: (def.description || key).toLowerCase(),
      required: requiredSet.has(key)
    }));
  }

  // Simplified key-type map format ({ price: 'number', title: 'string' })
  return Object.entries(schema).map(([key, val]: [string, any]) => ({
    key,
    type: typeof val === 'string' ? val : (val.type || 'string'),
    description: (val?.description || key).toLowerCase(),
    required: Boolean(val?.required)
  }));
}

/**
 * Extracts structured data matching schema from snapshot elements.
 * Pure function: (snapshot, instruction, schema) -> { success, data, missingFields, confidence }
 */
export function extractSchema(
  snapshot: DOMSnapshot | any,
  instruction = '',
  schema: any = {}
): ExtractionResult {
  const fields = normalizeSchema(schema);
  if (fields.length === 0) {
    return { success: true, data: {}, missingFields: [], confidence: 1.0 };
  }

  const elements = (snapshot && Array.isArray(snapshot.elements)) ? snapshot.elements : [];
  const corpus = elements.map((el: any) => ({
    text: (el.text || '').trim(),
    name: (el.name || '').trim(),
    placeholder: (el.placeholder || '').trim(),
    ariaLabel: (el.ariaLabel || '').trim(),
    value: (el.value || '').trim()
  }));

  const data: Record<string, any> = {};
  const missingFields: string[] = [];
  let matchedFieldCount = 0;

  for (const field of fields) {
    const key = field.key;
    const targetType = field.type;
    const desc = field.description;
    const keyLower = key.toLowerCase();

    let extractedRaw: any = null;

    // 1. Check direct element attributes / matches
    for (const item of corpus) {
      const labelMatch =
        item.name.toLowerCase() === keyLower ||
        item.placeholder.toLowerCase().includes(keyLower) ||
        item.ariaLabel.toLowerCase().includes(keyLower);

      if (labelMatch) {
        extractedRaw = item.value || item.text;
        if (extractedRaw) break;
      }

      // Semantic text heuristic: "Price: $99" or "Status: In Stock"
      const pattern = new RegExp(`(?:${keyLower}|${desc})\\s*[:=-]?\\s*([^\\n]+)`, 'i');
      const textMatch = item.text.match(pattern);
      if (textMatch && textMatch[1]) {
        extractedRaw = textMatch[1].trim();
        break;
      }
    }

    // 2. Prioritized semantic extraction heuristics:
    if (!extractedRaw) {
      const isCounterField = /left|count|remaining/i.test(keyLower) || /left|count|remaining/i.test(desc);

      // A. Counter patterns (e.g. "3 items left", "1 item left", "5 remaining")
      if (isCounterField) {
        const counterPattern = /\b\d+\s*(?:items?|tasks?|todos?|entries)?\s*(?:left|remaining)\b/i;
        const counterItem = corpus.find((c: any) => counterPattern.test(c.text));
        if (counterItem) {
          const match = counterItem.text.match(counterPattern);
          extractedRaw = match ? match[0] : counterItem.text;
        } else if (snapshot?.bodyText && counterPattern.test(snapshot.bodyText)) {
          const match = snapshot.bodyText.match(counterPattern);
          if (match) extractedRaw = match[0];
        }
      }

      // B. Price / Currency patterns
      if (!extractedRaw && (keyLower.includes('price') || desc.includes('price') || desc.includes('cost'))) {
        const priceItem = corpus.find((c: any) => /\$\s*\d+|\d+\s*USD|\d+\.\d{2}/i.test(c.text));
        if (priceItem) extractedRaw = priceItem.text;
      }

      // C. Date / Time patterns
      if (!extractedRaw && (keyLower.includes('date') || desc.includes('date') || keyLower.includes('time'))) {
        const datePattern = /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},? \d{4})\b/i;
        const dateItem = corpus.find((c: any) => datePattern.test(c.text));
        if (dateItem) extractedRaw = dateItem.text;
      }

      // D. Stock / Availability
      if (!extractedRaw && (keyLower.includes('stock') || keyLower.includes('available'))) {
        const stockItem = corpus.find((c: any) => /(in stock|out of stock|available)/i.test(c.text));
        if (stockItem) extractedRaw = stockItem.text;
      }

      // E. Title / Heading
      if (!extractedRaw && (keyLower.includes('title') || keyLower.includes('name') || desc.includes('title'))) {
        const headingItem = elements.find((e: any) => e.tag === 'h1' || e.role === 'heading' || e.tag === 'h2');
        if (headingItem) extractedRaw = headingItem.text;
      }

      // F. Generic entity list / array fallback
      if (!extractedRaw && !isCounterField && (targetType === 'array' || /^(?:items|todos|tasks|list)$/i.test(keyLower))) {
        const listItems = elements.filter((e: any) => e.tag === 'li' || e.role === 'listitem').map((e: any) => (e.text || '').trim()).filter(Boolean);
        if (listItems.length > 0) {
          extractedRaw = listItems;
        }
      }
    }

    // 3. Fallback: check whole page bodyText if available
    if (!extractedRaw && snapshot?.bodyText) {
      const pattern = new RegExp(`(?:${keyLower}|${desc})\\s*[:=-]?\\s*([^\\n]+)`, 'i');
      const match = snapshot.bodyText.match(pattern);
      if (match && match[1]) extractedRaw = match[1].trim();
    }

    const coerced = coerceValue(extractedRaw, targetType);

    if (coerced !== null) {
      data[key] = coerced;
      matchedFieldCount++;
    } else {
      data[key] = null;
      if (field.required) {
        missingFields.push(key);
      }
    }
  }

  const confidence = fields.length > 0 ? Number((matchedFieldCount / fields.length).toFixed(2)) : 1.0;
  const success = missingFields.length === 0 && matchedFieldCount > 0;

  return {
    success,
    data,
    missingFields,
    confidence
  };
}
