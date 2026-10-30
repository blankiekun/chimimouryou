/* global console */
// Prints how the hard placement test scores simulated learners: the cutoff of 20 runs (lowest,
// median, highest) per learner and test length. A dev tool for tuning, not a test.
// Run from apps/web: node scripts/simulate-hard-placement.mjs
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, logLevel: 'error' });

try {
  const { hardGuess, nextItem, placementLength, scorePlacement } = await server.ssrLoadModule(
    '$lib/data/difficulty/placement'
  );
  const { items } = (await server.ssrLoadModule('$lib/data/difficulty/placement-hard-items.json'))
    .default;

  const seeded = (seed) => () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  const take = (sheet, seed, length) => {
    const random = seeded(seed);
    const answers = [];
    const next = () => nextItem(answers, items, random, undefined, length);

    for (let item = next(); item; item = next()) answers.push({ item, yes: sheet(item, random) });
    return answers;
  };
  const cutoffs = (sheet, length = placementLength) =>
    Array.from(
      { length: 20 },
      (_, i) => scorePlacement(take(sheet, i + 1, length), undefined, hardGuess).cutoff
    ).sort((a, b) => a - b);
  // The same learners as placement-hard.test.ts.
  const pick = (random) => Math.floor(random() * 4) === 0;
  const sheets = {
    '20k knower': (item) => item.r <= 20000,
    'readings only past 10k': (item, random) => item.r <= 10000 || pick(random),
    'random guesser': (_, random) => random() < 0.05 && pick(random),
    '5k + eliminator': (item, random) => item.r <= 5000 || (random() < 0.6 && random() < 0.5)
  };

  for (const [name, sheet] of Object.entries(sheets)) {
    for (const length of [20, 40, 60]) {
      const run = cutoffs(sheet, length);

      console.log(name, length, run[0], run[10], run[19]);
    }
  }
} finally {
  await server.close();
}
