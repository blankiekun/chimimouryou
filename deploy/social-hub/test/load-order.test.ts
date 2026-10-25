import { expect, test } from 'vitest';

// The deployed bundle loads index.ts → hub.ts first; hub.ts and community.ts import each other.
test('constants computed at load time are numbers in the deployed order', async () => {
  await import('../src/index');
  const { AGED, NEW_ACCOUNT } = await import('../src/community');

  expect(Number.isFinite(NEW_ACCOUNT) && Number.isFinite(AGED)).toBe(true);
});
