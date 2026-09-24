import { test } from 'node:test';
import assert from 'node:assert';
import { WebMcpClient } from '../src/mcp/webmcp.js';

test('WebMcpClient detects in-memory window tools', () => {
  const client = new WebMcpClient();
  const mockWin = {
    __webMcpTools: [
      { name: 'searchCatalog', description: 'Search the store products', handler: async () => ({ results: [] }) },
      { name: 'addToCart', description: 'Add item to shopping cart', handler: async () => ({ cartCount: 1 }) }
    ]
  };

  const tools = client.detectTools(mockWin);
  assert.strictEqual(tools.length, 2);
  assert.strictEqual(tools[0].name, 'searchCatalog');

  const matched = client.findToolForGoal(tools, 'Please search the store for headphones');
  assert.notStrictEqual(matched, null);
  assert.strictEqual(matched!.name, 'searchCatalog');
});

test('WebMcpClient invokes tool safely', async () => {
  const client = new WebMcpClient();
  const tool = {
    name: 'ping',
    handler: async (args: any) => `pong ${args.val}`
  };

  const res = await client.invokeTool(tool, { val: 42 });
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.result, 'pong 42');
});

test('WebMcpClient: single-token fuzzy description match no longer matches', () => {
  const client = new WebMcpClient();
  const tools = [
    {
      name: 'viewAccount',
      description: 'Check your balance and pending transactions',
      handler: async () => ({})
    }
  ];

  // Single-token fuzzy match in description only ("transactions") does not match (requires >= 2)
  const matched = client.findToolForGoal(tools, 'transactions');
  assert.strictEqual(matched, null);

  // Two token matches in description match
  const matched2 = client.findToolForGoal(tools, 'balance transactions');
  assert.notStrictEqual(matched2, null);
  assert.strictEqual(matched2!.name, 'viewAccount');

  // Name-token match allows matching even with single token
  const matchedName = client.findToolForGoal(tools, 'account');
  assert.notStrictEqual(matchedName, null);
  assert.strictEqual(matchedName!.name, 'viewAccount');

  // Custom minMatches option: requires 3 matches if specified
  const matchedMin3 = client.findToolForGoal(tools, 'balance transactions', 3);
  assert.strictEqual(matchedMin3, null);
});
