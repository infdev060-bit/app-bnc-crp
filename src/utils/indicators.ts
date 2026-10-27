import { Candle, IndicatorSnapshot, Timeframe } from '../types/crypto';

/**
 * Exponential Moving Average (EMA)
 */
export function calculateEMA(candles: Candle[], period: number): number[] {
  if (candles.length < period) {
    return new Array(candles.length).fill(candles[candles.length - 1]?.close || 0);
  }

  const k = 2 / (period + 1);
  const emaArray: number[] = new Array(candles.length);

  // Initial SMA for seed
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += candles[i].close;
  }
  emaArray[period - 1] = sum / period;

  // Fill preceding with seed for consistency
  for (let i = 0; i < period - 1; i++) {
    emaArray[i] = emaArray[period - 1];
  }

  // Calculate EMA
  for (let i = period; i < candles.length; i++) {
    emaArray[i] = candles[i].close * k + emaArray[i - 1] * (1 - k);
  }

  return emaArray;
}

/**
 * Relative Strength Index (RSI - 14)
 */
export function calculateRSI(candles: Candle[], period = 14): number[] {
  if (candles.length <= period) {
    return new Array(candles.length).fill(50);
  }

  const rsi: number[] = new Array(candles.length).fill(50);
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    const currentGain = diff > 0 ? diff : 0;
    const currentLoss = diff < 0 ? Math.abs(diff) : 0;

    avgGain = (avgGain * (period - 1) + currentGain) / period;
    avgLoss = (avgLoss * (period - 1) + currentLoss) / period;

    if (avgLoss === 0) {
      rsi[i] = 100;
    } else {
      const rs = avgGain / avgLoss;
      rsi[i] = 100 - 100 / (1 + rs);
    }
  }

  return rsi;
}

/**
 * Average True Range (ATR - 14)
 */
export function calculateATR(candles: Candle[], period = 14): {
  atrValues: number[];
  latestAtr: number;
  atrPercent: number;
} {
  if (candles.length < 2) {
    const dummy = candles[0]?.close * 0.01 || 1;
    return { atrValues: [dummy], latestAtr: dummy, atrPercent: 1.0 };
  }

  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - prev.close),
      Math.abs(current.low - prev.close)
    );
    trueRanges.push(tr);
  }

  const atrValues: number[] = new Array(candles.length).fill(trueRanges[0]);

  let sum = 0;
  const initialLen = Math.min(period, trueRanges.length);
  for (let i = 0; i < initialLen; i++) {
    sum += trueRanges[i];
  }
  let currentAtr = sum / initialLen;
  atrValues[initialLen] = currentAtr;

  for (let i = initialLen + 1; i < candles.length; i++) {
    const tr = trueRanges[i - 1];
    currentAtr = (currentAtr * (period - 1) + tr) / period;
    atrValues[i] = currentAtr;
  }

  const latestPrice = candles[candles.length - 1].close;
  const latestAtr = atrValues[atrValues.length - 1] || latestPrice * 0.01;
  const atrPercent = (latestAtr / (latestPrice || 1)) * 100;

  return { atrValues, latestAtr, atrPercent };
}

/**
 * Detect Order Blocks (OB) based on SMC
 * Evaluates real closed candles.
 * Tracks whether the identified Order Block has been mitigated by subsequent candles.
 */
export function detectOrderBlocks(candles: Candle[]): {
  bullishOB?: { top: number; bottom: number; mitigated: boolean };
  bearishOB?: { top: number; bottom: number; mitigated: boolean };
} {
  if (candles.length < 15) return {};

  // Work primarily with closed candles to avoid forming candle noise
  const closed = candles.length > 1 ? candles.slice(0, -1) : candles;
  const recent = closed.slice(-30);
  let bullishOB: { top: number; bottom: number; mitigated: boolean } | undefined;
  let bearishOB: { top: number; bottom: number; mitigated: boolean } | undefined;

  // Search for Bullish Order Block: last down candle before strong upward impulse breaking recent high
  for (let i = recent.length - 4; i >= 3; i--) {
    const candle = recent[i];
    const nextCandle = recent[i + 1];
    const next2 = recent[i + 2];

    const isDownCandle = candle.close < candle.open;
    const bodySize = candle.open - candle.close;
    const nextBody = nextCandle.close - nextCandle.open;
    const isImpulsiveUp = nextCandle.close > nextCandle.open && nextBody > bodySize * 1.3;
    const priorSwingHigh = Math.max(...recent.slice(Math.max(0, i - 5), i).map((c) => c.high));
    const brokePriorHigh = nextCandle.high > priorSwingHigh || (next2 && next2.high > priorSwingHigh);

    if (isDownCandle && isImpulsiveUp && brokePriorHigh) {
      const top = Math.max(candle.open, candle.close);
      const bottom = candle.low;

      // Check if mitigated by any subsequent candle after the impulse
      let mitigated = false;
      for (let j = i + 3; j < recent.length; j++) {
        if (recent[j].low <= top) {
          mitigated = true;
          break;
        }
      }

      bullishOB = { top, bottom, mitigated };
      break;
    }
  }

  // Search for Bearish Order Block: last up candle before strong downward impulse breaking recent low
  for (let i = recent.length - 4; i >= 3; i--) {
    const candle = recent[i];
    const nextCandle = recent[i + 1];
    const next2 = recent[i + 2];

    const isUpCandle = candle.close > candle.open;
    const bodySize = candle.close - candle.open;
    const nextBody = nextCandle.open - nextCandle.close;
    const isImpulsiveDown = nextCandle.close < nextCandle.open && nextBody > bodySize * 1.3;
    const priorSwingLow = Math.min(...recent.slice(Math.max(0, i - 5), i).map((c) => c.low));
    const brokePriorLow = nextCandle.low < priorSwingLow || (next2 && next2.low < priorSwingLow);

    if (isUpCandle && isImpulsiveDown && brokePriorLow) {
      const top = candle.high;
      const bottom = Math.min(candle.open, candle.close);

      // Check if mitigated
      let mitigated = false;
      for (let j = i + 3; j < recent.length; j++) {
        if (recent[j].high >= bottom) {
          mitigated = true;
          break;
        }
      }

      bearishOB = { top, bottom, mitigated };
      break;
    }
  }

  return { bullishOB, bearishOB };
}

/**
 * Detect Fair Value Gaps (FVG)
 * Bullish FVG: Candle 1 High < Candle 3 Low (Unmitigated imbalance)
 * Bearish FVG: Candle 1 Low > Candle 3 High
 */
export function detectFVG(candles: Candle[]): {
  bullishFVG?: { top: number; bottom: number; filled: boolean };
  bearishFVG?: { top: number; bottom: number; filled: boolean };
} {
  if (candles.length < 10) return {};
  const closed = candles.length > 1 ? candles.slice(0, -1) : candles;
  const recent = closed.slice(-25);

  let bullishFVG: { top: number; bottom: number; filled: boolean } | undefined;
  let bearishFVG: { top: number; bottom: number; filled: boolean } | undefined;

  for (let i = recent.length - 2; i >= 2; i--) {
    const c1 = recent[i - 2];
    const c3 = recent[i];

    // Bullish FVG: gap between c1 high and c3 low
    if (c3.low > c1.high) {
      const gapSize = c3.low - c1.high;
      if (gapSize > (c3.close * 0.0012)) {
        let filled = false;
        // Check subsequent candles
        for (let j = i + 1; j < recent.length; j++) {
          if (recent[j].low <= c1.high) {
            filled = true;
            break;
          }
        }
        bullishFVG = { top: c3.low, bottom: c1.high, filled };
        break;
      }
    }

    // Bearish FVG: gap between c1 low and c3 high
    if (c1.low > c3.high) {
      const gapSize = c1.low - c3.high;
      if (gapSize > (c3.close * 0.0012)) {
        let filled = false;
        for (let j = i + 1; j < recent.length; j++) {
          if (recent[j].high >= c1.low) {
            filled = true;
            break;
          }
        }
        bearishFVG = { top: c1.low, bottom: c3.high, filled };
        break;
      }
    }
  }

  return { bullishFVG, bearishFVG };
}

/**
 * Detect Liquidity Sweep (chasse aux liquidités au-delà des plus hauts / plus bas avec réintégration)
 */
export function detectLiquiditySweep(candles: Candle[]): {
  swept: boolean;
  side: 'BUY' | 'SELL' | 'NONE';
  sweepLevel: number;
} {
  if (candles.length < 15) return { swept: false, side: 'NONE', sweepLevel: 0 };
  const recent = candles.slice(-20);
  const current = recent[recent.length - 1];
  const prev1 = recent[recent.length - 2];

  // Prior swing highs/lows in the preceding 14 candles
  const priorCandles = recent.slice(0, recent.length - 2);
  const priorHigh = Math.max(...priorCandles.map((c) => c.high));
  const priorLow = Math.min(...priorCandles.map((c) => c.low));

  // Sweep Buy-side liquidity (pierced prior high with upper wick, but closed below prior high)
  if ((current.high > priorHigh && current.close < priorHigh) ||
      (prev1.high > priorHigh && prev1.close < priorHigh)) {
    return { swept: true, side: 'BUY', sweepLevel: priorHigh };
  }

  // Sweep Sell-side liquidity (pierced prior low with lower wick, but closed above prior low)
  if ((current.low < priorLow && current.close > priorLow) ||
      (prev1.low < priorLow && prev1.close > priorLow)) {
    return { swept: true, side: 'SELL', sweepLevel: priorLow };
  }

  return { swept: false, side: 'NONE', sweepLevel: 0 };
}

/**
 * Detect Break of Structure (BOS) & Change of Character (CHoCH)
 */
export function detectBOSandCHoCH(candles: Candle[]): {
  bos: boolean;
  choch: boolean;
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
} {
  if (candles.length < 20) return { bos: false, choch: false, bias: 'NEUTRAL' };

  // Use closed candles for structural pivots
  const closed = candles.length > 1 ? candles.slice(0, -1) : candles;
  const recent = closed.slice(-30);
  const last = recent[recent.length - 1];

  const pivotLookback = recent.slice(0, -1);
  const swingHigh = Math.max(...pivotLookback.map((c) => c.high));
  const swingLow = Math.min(...pivotLookback.map((c) => c.low));

  const brokeHigh = last.close > swingHigh;
  const brokeLow = last.close < swingLow;

  // CHoCH is detected when price breaks a counter-trend swing high/low after a clear sequence
  const isPreviousDown = pivotLookback[pivotLookback.length - 1].close < pivotLookback[0].close;
  const isPreviousUp = pivotLookback[pivotLookback.length - 1].close > pivotLookback[0].close;

  if (brokeHigh) {
    const isChoch = isPreviousDown;
    return { bos: !isChoch, choch: isChoch, bias: 'BULLISH' };
  }
  if (brokeLow) {
    const isChoch = isPreviousUp;
    return { bos: !isChoch, choch: isChoch, bias: 'BEARISH' };
  }

  return { bos: false, choch: false, bias: 'NEUTRAL' };
}

/**
 * Generate full indicator snapshot for a given timeframe
 */
export function generateTimeframeSnapshot(candles: Candle[], timeframe: Timeframe): IndicatorSnapshot {
  if (!candles || candles.length === 0) {
    return {
      timeframe,
      currentPrice: 0,
      ema20: 0,
      ema50: 0,
      rsi: 50,
      atr: 0,
      atrPercent: 0,
      trend: 'CONSOLIDATION',
      structure: 'NEUTRAL',
      recentHigh: 0,
      recentLow: 0,
      averageVolume20: 0,
      volumeRatio: 1,
      candleCount: 0,
    };
  }

  const ema20Arr = calculateEMA(candles, 20);
  const ema50Arr = calculateEMA(candles, 50);
  const ema200Arr = candles.length >= 200 ? calculateEMA(candles, 200) : undefined;
  const rsiArr = calculateRSI(candles, 14);
  const { latestAtr, atrPercent } = calculateATR(candles, 14);

  const currentPrice = candles[candles.length - 1].close;
  const ema20 = ema20Arr[ema20Arr.length - 1];
  const ema50 = ema50Arr[ema50Arr.length - 1];
  const ema200 = ema200Arr ? ema200Arr[ema200Arr.length - 1] : undefined;
  const rsi = rsiArr[rsiArr.length - 1];

  // Volume metrics
  const volSlice = candles.slice(-21, -1);
  const averageVolume20 = volSlice.length > 0
    ? volSlice.reduce((sum, c) => sum + c.volume, 0) / volSlice.length
    : candles[candles.length - 1].volume;
  const currentVolume = candles[candles.length - 1].volume;
  const volumeRatio = averageVolume20 > 0 ? parseFloat((currentVolume / averageVolume20).toFixed(2)) : 1.0;

  const recentSlice = candles.slice(-20);
  const recentHigh = Math.max(...recentSlice.map((c) => c.high));
  const recentLow = Math.min(...recentSlice.map((c) => c.low));

  // Determine trend based on moving average stack and slope
  let trend: 'HAUSSIÈRE' | 'BAISSIÈRE' | 'CONSOLIDATION' = 'CONSOLIDATION';
  if (currentPrice > ema20 && ema20 > ema50) {
    trend = 'HAUSSIÈRE';
  } else if (currentPrice < ema20 && ema20 < ema50) {
    trend = 'BAISSIÈRE';
  }

  // SMC elements
  const { bullishOB, bearishOB } = detectOrderBlocks(candles);
  const { bullishFVG, bearishFVG } = detectFVG(candles);
  const sweep = detectLiquiditySweep(candles);
  const { bos, choch, bias } = detectBOSandCHoCH(candles);

  let structure: 'BULLISH_STRUCTURE' | 'BEARISH_STRUCTURE' | 'NEUTRAL' = 'NEUTRAL';
  if (bias === 'BULLISH' || (trend === 'HAUSSIÈRE' && currentPrice > ema20)) {
    structure = 'BULLISH_STRUCTURE';
  } else if (bias === 'BEARISH' || (trend === 'BAISSIÈRE' && currentPrice < ema20)) {
    structure = 'BEARISH_STRUCTURE';
  }

  return {
    timeframe,
    currentPrice,
    ema20,
    ema50,
    ema200,
    rsi,
    atr: latestAtr,
    atrPercent,
    trend,
    structure,
    recentHigh,
    recentLow,
    averageVolume20,
    volumeRatio,
    candleCount: candles.length,
    orderBlock: bullishOB ? { type: 'BULLISH', ...bullishOB } : bearishOB ? { type: 'BEARISH', ...bearishOB } : undefined,
    fvg: bullishFVG ? { type: 'BULLISH', ...bullishFVG } : bearishFVG ? { type: 'BEARISH', ...bearishFVG } : undefined,
    liquiditySweepDetected: sweep.swept,
    breakOfStructureDetected: bos,
    changeOfCharacterDetected: choch,
  };
}
