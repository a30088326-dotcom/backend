export const lookupText = (value: unknown) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');

export function editDistance(a: string, b: string) {
  const left = lookupText(a); const right = lookupText(b);
  const d = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i++) d[i][0] = i;
  for (let j = 0; j <= right.length; j++) d[0][j] = j;
  for (let i = 1; i <= left.length; i++) for (let j = 1; j <= right.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[left.length][right.length];
}

/** Returns only an unambiguous closest group within a conservative typo limit. */
export function closest<T>(items: T[], query: string, values: (item: T) => unknown[]) {
  const term = lookupText(query); if (!term) return [] as T[];
  const limit = term.length <= 4 ? 1 : term.length <= 8 ? 2 : Math.min(3, Math.ceil(term.length * 0.2));
  const scored = items.map(item => ({ item, score: Math.min(...values(item).filter(Boolean).map(value => editDistance(term, String(value)))) })).filter(row => Number.isFinite(row.score));
  const best = Math.min(...scored.map(row => row.score));
  return best <= limit ? scored.filter(row => row.score === best).map(row => row.item) : [];
}
