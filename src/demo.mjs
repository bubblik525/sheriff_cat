export function demoTokens() {
  return Array.from({ length: 28 }, (_, i) => ({
    address: '0x' + (i + 1).toString(16).padStart(40, '0'),
    creator: '0x' + (100 + (i % 5)).toString(16).padStart(40, '0'),
    name: [
      'Sheriff Cat',
      'Night Patrol',
      'Moon Cat',
      'Paw Print',
      'Sheriff Cat2',
      'Night Patrol',
    ][i % 6],
    symbol: ['SHERIFF', 'PATROL', 'MOON', 'PAW', 'SCAT', 'PATROL'][i % 6],
    block: 10000 - i,
    seenAt: Date.now() - i * 260000,
    market: {
      price: 0.00013 * (i + 1),
      liquidity: 3000 + i * 1300,
      change: ((i % 7) - 3) * 7.2,
      volume: 4500 + i * 2700,
      pair: 'demo-pool-' + i,
      observedAt: Date.now(),
    },
  }));
}
