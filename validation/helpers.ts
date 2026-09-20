/**
 * Shared test helpers for Kevin validation.
 * Provides mock page, assertion helpers, and report formatting.
 */

export function createMockPage(elements: any[] = []): any {
  const state = {
    url: 'https://shop.test.com/products',
    title: 'Test Shop',
    elements: [...elements] as any[],
    clicks: [] as any[],
    types: [] as any[],
    gotos: [] as any[],
    selects: [] as any[]
  };

  const page: any = {
    state,
    url() {
      return state.url;
    },
    async title() {
      return state.title;
    },
    async goto(url: string) {
      state.gotos.push(url);
      state.url = url;
    },
    async evaluate(fn: any, arg?: any) {
      if (typeof fn === 'string') {
        return { url: state.url, title: state.title, elements: state.elements };
      }
      if (typeof fn === 'function') return fn(arg);
      return null;
    },
    locator(sel: string) {
      return {
        first() {
          return {
            async isVisible() {
              return true;
            },
            async scrollIntoViewIfNeeded() {},
            async click() {
              state.clicks.push(sel);
            },
            async fill(text: string) {
              state.types.push({ sel, text });
            },
            async press(key: string) {
              state.types.push({ sel, key });
            },
            async selectOption(val: any) {
              state.selects.push({ sel, val });
            }
          };
        }
      };
    },
    frames() {
      return [page];
    }
  };

  return page;
}

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];

export function pass(name: string, detail = ''): void {
  results.push({ name, ok: true, detail });
  console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`);
}

export function fail(name: string, detail = ''): void {
  results.push({ name, ok: false, detail });
  console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
}

export function assert(condition: any, name: string, detail = ''): boolean {
  if (condition) pass(name, detail);
  else fail(name, detail);
  return Boolean(condition);
}

export function report(section: string): boolean {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n  ${section}: ${passed}/${results.length} passed${failed ? `, ${failed} FAILED` : ''}`);
  const ok = failed === 0;
  results.length = 0; // reset for next section
  return ok;
}
