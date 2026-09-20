import test from 'node:test';
import assert from 'node:assert/strict';
import {
  coerceValue,
  normalizeSchema,
  extractSchema
} from '../packages/core/actions/schema-extractor.js';

test('coerceValue handles number, boolean, string, and array types', () => {
  assert.equal(coerceValue('$1,249.99', 'number'), 1249.99);
  assert.equal(coerceValue('In Stock', 'boolean'), true);
  assert.equal(coerceValue('out of stock', 'boolean'), false);
  assert.equal(coerceValue('Wireless Noise Canceling', 'string'), 'Wireless Noise Canceling');
  assert.deepEqual(coerceValue('red, blue, green', 'array'), ['red', 'blue', 'green']);
});

test('normalizeSchema parses JSON Schema and key-type dictionary', () => {
  const jsonSchema = {
    type: 'object',
    properties: {
      price: { type: 'number', description: 'Item price' },
      title: { type: 'string' }
    },
    required: ['price']
  };
  const normalized = normalizeSchema(jsonSchema);
  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].key, 'price');
  assert.equal(normalized[0].required, true);
  assert.equal(normalized[1].required, false);

  const simpleDict = { price: 'number', title: 'string' };
  const simpleNorm = normalizeSchema(simpleDict);
  assert.equal(simpleNorm.length, 2);
});

test('extractSchema extracts structured data from DOM snapshot candidates', () => {
  const snapshot = {
    url: 'https://store.com/item/1',
    elements: [
      { tag: 'h1', role: 'heading', text: 'Sony WH-1000XM5 Headphones' },
      { tag: 'span', role: 'text', text: 'Price: $399.99' },
      { tag: 'span', role: 'status', text: 'Availability: In Stock' }
    ]
  };

  const schema = {
    properties: {
      title: { type: 'string' },
      price: { type: 'number' },
      inStock: { type: 'boolean', description: 'availability' }
    },
    required: ['title', 'price']
  };

  const result = extractSchema(snapshot, 'extract product details', schema);
  assert.equal(result.success, true);
  assert.equal(result.data.title, 'Sony WH-1000XM5 Headphones');
  assert.equal(result.data.price, 399.99);
  assert.equal(result.data.inStock, true);
  assert.equal(result.missingFields.length, 0);
  assert.ok(result.confidence > 0.9);
});

test('extractSchema marks missing required fields gracefully', () => {
  const snapshot = {
    elements: [
      { tag: 'h1', text: 'Product Title' }
    ]
  };
  const schema = {
    properties: {
      title: { type: 'string' },
      discountCode: { type: 'string' }
    },
    required: ['discountCode']
  };

  const result = extractSchema(snapshot, 'get details', schema);
  assert.equal(result.success, false);
  assert.deepEqual(result.missingFields, ['discountCode']);
});
