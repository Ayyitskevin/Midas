import {
  deriveDataReceipt,
  type Candle,
  type DataReceipt,
  type Interval,
  type Range,
} from '@midas/shared';

export interface ChartStudySelection {
  sma: boolean;
  ema: boolean;
  bb: boolean;
  vwap: boolean;
  rsi: boolean;
  macd: boolean;
  vp: boolean;
}

export interface ChartPerformance {
  first: number;
  last: number;
  percent: number;
}

export interface InspectedChartCalculations {
  performance: ChartPerformance | null;
  receipt: DataReceipt | null;
}

const STUDY_FORMULAS: Record<keyof ChartStudySelection, string> = {
  sma: 'SMA20=mean(last 20 closes)',
  ema: 'EMA50: seed=first close, k=2/(50+1), next=close*k+prior*(1-k)',
  bb: 'BB20=population-SD bands at SMA20 ± 2*SD(close)',
  vwap: 'VWAP=cumulative sum(typical price*positive volume)/cumulative positive volume; typical=(high+low+close)/3',
  rsi: 'RSI14=Wilder-smoothed average gains/losses over close deltas',
  macd: 'MACD=EMA12(close)-EMA26(close); signal=EMA9(MACD); histogram=MACD-signal',
  vp: 'VP24=assign each candle volume to one of 24 equal low-to-high buckets by typical price; POC=max-volume bucket',
};

/** Build the chart performance value and one receipt for every active local study. */
export function inspectChartCalculations(
  candles: Candle[],
  inputReceipt: DataReceipt | undefined,
  instrument: string,
  interval: Interval,
  range: Range,
  studies: ChartStudySelection,
  evaluatedAtMs: number = Date.now(),
): InspectedChartCalculations {
  const performance = candles.length < 2
    ? null
    : (() => {
        const first = candles[0].close;
        const last = candles[candles.length - 1].close;
        return { first, last, percent: first === 0 ? 0 : ((last - first) / first) * 100 };
      })();
  if (candles.length === 0 || inputReceipt === undefined) return { performance, receipt: null };

  const enabled = (Object.keys(studies) as Array<keyof ChartStudySelection>)
    .filter((key) => studies[key]);
  const formulas = [
    'performance=(last close-first close)/first close*100',
    ...enabled.map((key) => STUDY_FORMULAS[key]),
  ];
  try {
    return {
      performance,
      receipt: deriveDataReceipt(
        {
          providerId: 'midas-web',
          providerVersion: '1.0',
          source: 'Midas client chart analytics',
          venue: inputReceipt.venue,
          datasetFamily: 'history',
          instrument,
          coverage: `${interval}/${range}; ${candles.length} bar(s); active=${enabled.join(',') || 'performance-only'}`,
          provenance: inputReceipt.provenance,
          expectedCadenceMs: inputReceipt.expectedCadenceMs,
          units: { price: 'source currency', performance: 'percent', oscillator: 'study-defined' },
          methodology: {
            id: 'chart-analytics',
            version: '1.0',
            formula: formulas.join('; '),
          },
          inputReceipts: [inputReceipt],
          note:
            inputReceipt.provenance === 'live'
              ? null
              : `Derived from ${inputReceipt.provenance} history evidence.`,
        },
        evaluatedAtMs,
      ),
    };
  } catch {
    return { performance, receipt: null };
  }
}
