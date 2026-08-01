import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Chart history trust boundary', () => {
  it('keeps receipted history independent from unreceipted trade streams', () => {
    const source = readFileSync(new URL('./ChartModule.tsx', import.meta.url), 'utf8');
    expect(source).not.toMatch(/useStream\s*\(\s*['"]trades['"]/);
    expect(source).toContain('intervalMs: 15_000');
    expect(source).toContain('Stream trades do not carry');
  });
});
