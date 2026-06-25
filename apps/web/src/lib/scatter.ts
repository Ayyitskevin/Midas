/**
 * Ordinary-least-squares regression of y on x — the line behind a returns
 * scatter. The slope is beta, the intercept is alpha (per period), and r² /
 * correlation say how tightly the cloud hugs the line. Pure for unit testing.
 */

export interface Regression {
  slope: number; // beta
  intercept: number; // alpha (per period)
  correlation: number;
  r2: number;
  n: number;
}

export function regress(x: number[], y: number[]): Regression | null {
  const n = Math.min(x.length, y.length);
  if (n < 2) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i];
    my += y[i];
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0) return null; // x is constant — slope undefined
  const slope = sxy / sxx;
  const correlation = syy > 0 ? Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy))) : 0;
  return { slope, intercept: my - slope * mx, correlation, r2: correlation * correlation, n };
}
