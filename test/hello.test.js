import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../Hello/api.mjs';

test('Hello controls reject GET requests and unsupported actions', async () => {
  let result;
  const headers = {};
  const res = { setHeader(name, value) { headers[name] = value; } };
  const context = { pathname: '/restart', json(status, body) { result = { status, body }; } };
  await handle({ method: 'GET' }, res, context);
  assert.equal(result.status, 405);
  assert.equal(headers.Allow, 'POST');
  await handle({ method: 'POST' }, res, { ...context, pathname: '/execute' });
  assert.equal(result.status, 404);
});
