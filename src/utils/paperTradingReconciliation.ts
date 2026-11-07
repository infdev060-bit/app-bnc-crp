import { PaperTrade, PaperAccountConfig, PaperPartialFill } from '../types/paperTrading';
import { MarketType } from '../types/crypto';
import { quantizePrice } from './priceFormatter';

export interface CandleLike {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface ReconciliationResult {
  trade: PaperTrade;
  reconciledFillsCount: number;
  wasClosed: boolean;
  notes: string[];
}

/**
 * Reconciles an open paper trade against missed historical Binance candlesticks.
 * Strictly adheres to conservative execution rules:
 * - Chronological evaluation candle by candle.
 * - If High and Low in the same candle breach both SL and an active TP: SL is assumed hit first.
 * - Never invents an execution price: uses predefined stop/limit price or candle Open on gap.
 * - Records timestamps matching the candle time.
 */
export function reconcileTradeWithKlines(
  trade: PaperTrade,
  klines: CandleLike[],
  config: PaperAccountConfig
): ReconciliationResult {
  // If trade is already closed or has no quantity, nothing to reconcile
  if (
    trade.status === 'SL_HIT' ||
    trade.status === 'TP3_HIT' ||
    trade.status === 'MANUAL_CLOSED' ||
    trade.status === 'INVALIDATED' ||
    trade.currentQuantity <= 0
  ) {
    return { trade, reconciledFillsCount: 0, wasClosed: false, notes: ['Trade déjà clôturé'] };
  }

  if (!klines || klines.length === 0) {
    return { trade, reconciledFillsCount: 0, wasClosed: false, notes: ['Aucun chandelier historique disponible'] };
  }

  // Clone trade to preserve immutability
  const updated: PaperTrade = {
    ...trade,
    partialFills: [...trade.partialFills],
  };

  const notes: string[] = [];
  let fillsCount = 0;
  let wasClosed = false;
  const isLong = updated.direction === 'LONG';

  // Sort klines chronologically
  const sortedKlines = [...klines].sort((a, b) => a.time - b.time);

  // Filter candles that occurred strictly after or at the lastPriceUpdate
  // (candle time can be seconds or milliseconds; normalize to milliseconds)
  const normalizeTime = (t: number) => (t < 1e12 ? t * 1000 : t);
  const tradeLastUpdateMs = normalizeTime(updated.lastPriceUpdate);

  const relevantCandles = sortedKlines.filter((k) => normalizeTime(k.time) >= tradeLastUpdateMs - 60000);

  if (relevantCandles.length === 0) {
    return { trade: updated, reconciledFillsCount: 0, wasClosed: false, notes: ['Pas de nouveaux chandeliers après la dernière mise à jour'] };
  }

  for (const candle of relevantCandles) {
    if (updated.currentQuantity <= 0) {
      wasClosed = true;
      break;
    }

    const candleTimeMs = normalizeTime(candle.time);
    const hasTP1Filled = updated.partialFills.some((f) => f.level === 'TP1');
    const hasTP2Filled = updated.partialFills.some((f) => f.level === 'TP2');
    const hasTP3Filled = updated.partialFills.some((f) => f.level === 'TP3');

    // 1. Check Stop Loss breach
    const hitsSL = isLong ? candle.low <= updated.stopLoss : candle.high >= updated.stopLoss;

    // 2. Check Take Profit breaches
    const hitsTP1 = isLong ? candle.high >= updated.takeProfit1 : candle.low <= updated.takeProfit1;
    const hitsTP2 = isLong ? candle.high >= updated.takeProfit2 : candle.low <= updated.takeProfit2;
    const hitsTP3 = updated.takeProfit3 ? (isLong ? candle.high >= updated.takeProfit3 : candle.low <= updated.takeProfit3) : false;

    // RULE: CONSERVATIVE COLLISION RESOLUTION
    // If in the SAME candle, SL is touched AND an unhit TP is touched, assume SL hit first
    if (hitsSL && ((!hasTP1Filled && hitsTP1) || (hasTP1Filled && !hasTP2Filled && hitsTP2) || (hasTP2Filled && !hasTP3Filled && hitsTP3))) {
      executeReconciledStopLoss(
        updated,
        candle,
        candleTimeMs,
        'Réconciliation hors-ligne : Collision intra-bougie SL/TP (Résolution conservative au Stop Loss)'
      );
      fillsCount++;
      wasClosed = true;
      notes.push(`Collision intra-bougie à ${new Date(candleTimeMs).toISOString()} résolue au SL`);
      break;
    }

    // SL hit alone
    if (hitsSL) {
      executeReconciledStopLoss(
        updated,
        candle,
        candleTimeMs,
        'Réconciliation hors-ligne : Stop Loss touché pendant l’inactivité'
      );
      fillsCount++;
      wasClosed = true;
      notes.push(`Stop Loss touché à ${new Date(candleTimeMs).toISOString()}`);
      break;
    }

    // TP1 hit
    if (!hasTP1Filled && hitsTP1) {
      executeReconciledPartialTP(updated, 'TP1', updated.takeProfit1, config.tp1ClosePercent, candleTimeMs);
      fillsCount++;
      notes.push(`TP1 touché à ${new Date(candleTimeMs).toISOString()}`);

      // Break Even update
      if (config.moveToBreakEvenAfterTP1 && !updated.breakEvenMoved) {
        const frictionBuffer = updated.entryPrice * (((updated.feeRatePercent * 2) + updated.slippagePercent) / 100);
        const bePrice = isLong ? updated.entryPrice + frictionBuffer : updated.entryPrice - frictionBuffer;
        updated.stopLoss = updated.tickSize ? quantizePrice(bePrice, updated.tickSize, isLong ? 'ceil' : 'floor') : bePrice;
        updated.breakEvenMoved = true;
        updated.breakEvenPrice = updated.stopLoss;
        notes.push(`Stop Loss déplacé au Break-Even (${updated.stopLoss})`);
      }

      if (updated.currentQuantity <= 0) {
        updated.status = 'TP1_HIT';
        updated.closeTime = candleTimeMs;
        updated.finalExitPrice = updated.takeProfit1;
        updated.exitReason = 'Réconciliation : Position entièrement liquidée sur TP1';
        wasClosed = true;
        break;
      }
      updated.status = 'TP1_HIT';
    }

    // TP2 hit
    const tp1NowFilled = updated.partialFills.some((f) => f.level === 'TP1');
    if (tp1NowFilled && !hasTP2Filled && hitsTP2) {
      executeReconciledPartialTP(updated, 'TP2', updated.takeProfit2, config.tp2ClosePercent, candleTimeMs);
      fillsCount++;
      notes.push(`TP2 touché à ${new Date(candleTimeMs).toISOString()}`);

      if (updated.currentQuantity <= 0) {
        updated.status = 'TP2_HIT';
        updated.closeTime = candleTimeMs;
        updated.finalExitPrice = updated.takeProfit2;
        updated.exitReason = 'Réconciliation : Position entièrement liquidée sur TP2';
        wasClosed = true;
        break;
      }
      updated.status = 'TP2_HIT';
    }

    // TP3 hit
    const tp2NowFilled = updated.partialFills.some((f) => f.level === 'TP2');
    if (tp2NowFilled && !hasTP3Filled && hitsTP3 && updated.takeProfit3) {
      executeReconciledPartialTP(updated, 'TP3', updated.takeProfit3, 100, candleTimeMs);
      fillsCount++;
      updated.status = 'TP3_HIT';
      updated.closeTime = candleTimeMs;
      updated.finalExitPrice = updated.takeProfit3;
      updated.exitReason = 'Réconciliation : TP3 final atteint pendant l’inactivité';
      wasClosed = true;
      notes.push(`TP3 touché à ${new Date(candleTimeMs).toISOString()}`);
      break;
    }

    // Update highest / lowest seen
    if (candle.high > updated.highestPriceSeen) updated.highestPriceSeen = candle.high;
    if (candle.low < updated.lowestPriceSeen) updated.lowestPriceSeen = candle.low;
  }

  // Update last seen price to last processed candle's close
  const lastCandle = relevantCandles[relevantCandles.length - 1];
  if (lastCandle) {
    updated.lastPriceUpdate = normalizeTime(lastCandle.time);
    updated.currentMarketPrice = lastCandle.close;
    if (lastCandle.high > updated.highestPriceSeen) updated.highestPriceSeen = lastCandle.high;
    if (lastCandle.low < updated.lowestPriceSeen) updated.lowestPriceSeen = lastCandle.low;
  }

  // If trade is still open, recompute unrealized PnL at the latest candle close
  if (updated.currentQuantity > 0) {
    const unitPnl = isLong ? updated.currentMarketPrice - updated.entryPrice : updated.entryPrice - updated.currentMarketPrice;
    const grossUnrealized = updated.currentQuantity * unitPnl;
    const remainingFraction = updated.currentQuantity / updated.initialQuantity;
    const unamortizedEntryFee = updated.entryFeePaid * remainingFraction;
    const estimatedExitFee = (updated.currentQuantity * updated.currentMarketPrice) * (updated.feeRatePercent / 100);
    const estimatedSlippage = (updated.currentQuantity * updated.currentMarketPrice) * (updated.slippagePercent / 100);

    updated.unrealizedGrossPnl = grossUnrealized;
    updated.unrealizedNetPnl = grossUnrealized - unamortizedEntryFee - estimatedExitFee - estimatedSlippage;
  } else {
    updated.unrealizedGrossPnl = 0;
    updated.unrealizedNetPnl = 0;
  }

  updated.isReconciledOffline = true;
  updated.reconciliationNotes = notes.join(' | ');

  return {
    trade: updated,
    reconciledFillsCount: fillsCount,
    wasClosed,
    notes,
  };
}

/**
 * Execute Stop Loss in reconciliation, handling gaps at candle open
 */
function executeReconciledStopLoss(
  trade: PaperTrade,
  candle: CandleLike,
  timestampMs: number,
  reason: string
): void {
  const isLong = trade.direction === 'LONG';
  const qtyToClose = trade.currentQuantity;
  if (qtyToClose <= 0) return;

  // Adverse gap handling: if candle opened beyond the stop loss, execute at the worse open price
  let simulatedExitPrice = trade.stopLoss;
  if (isLong && candle.open < trade.stopLoss) {
    simulatedExitPrice = candle.open;
  } else if (!isLong && candle.open > trade.stopLoss) {
    simulatedExitPrice = candle.open;
  }

  const notionalClosed = qtyToClose * simulatedExitPrice;
  const exitFee = notionalClosed * (trade.feeRatePercent / 100);
  const slippageFee = notionalClosed * (trade.slippagePercent / 100);
  const allocatedEntryFee = (qtyToClose / trade.initialQuantity) * trade.entryFeePaid;

  const hoursHeld = Math.max(0, (timestampMs - trade.entryTime) / (1000 * 60 * 60));
  const fundingIntervals = Math.floor(hoursHeld / 8);
  const fundingFee = trade.market === 'futures' ? notionalClosed * (trade.fundingRatePer8hPercent / 100) * fundingIntervals : 0;

  const unitGrossPnl = isLong ? simulatedExitPrice - trade.entryPrice : trade.entryPrice - simulatedExitPrice;
  const grossPnl = qtyToClose * unitGrossPnl;
  const netPnl = grossPnl - allocatedEntryFee - exitFee - slippageFee - fundingFee;

  const fill: PaperPartialFill = {
    level: 'SL',
    percentageClosed: 100,
    quantityClosed: qtyToClose,
    remainingQuantity: 0,
    exitPrice: simulatedExitPrice,
    executedAt: timestampMs,
    grossPnl,
    netPnl,
    feePaid: exitFee,
    slippagePaid: slippageFee,
    fundingPaid: fundingFee,
    reason,
  };

  trade.partialFills.push(fill);
  trade.currentQuantity = 0;
  trade.status = 'SL_HIT';
  trade.closeTime = timestampMs;
  trade.finalExitPrice = simulatedExitPrice;
  trade.exitReason = reason;

  trade.realizedGrossPnl += grossPnl;
  trade.realizedNetPnl += netPnl;
  trade.totalExitFeePaid = (trade.totalExitFeePaid || 0) + exitFee;
  trade.totalSlippagePaid = (trade.totalSlippagePaid || 0) + slippageFee;
  trade.totalFundingPaid = (trade.totalFundingPaid || 0) + fundingFee;
  trade.totalFeesPaid = (trade.totalEntryFeePaid || trade.entryFeePaid) + trade.totalExitFeePaid;
  trade.totalCostsPaid = trade.totalFeesPaid + trade.totalSlippagePaid + trade.totalFundingPaid;

  trade.unrealizedGrossPnl = 0;
  trade.unrealizedNetPnl = 0;
}

/**
 * Execute Partial Take Profit in reconciliation
 */
function executeReconciledPartialTP(
  trade: PaperTrade,
  level: 'TP1' | 'TP2' | 'TP3',
  exitPrice: number,
  percentageToClose: number,
  timestampMs: number
): void {
  const isLong = trade.direction === 'LONG';
  let qtyToClose = 0;
  if (level === 'TP3' || percentageToClose >= 100) {
    qtyToClose = trade.currentQuantity;
  } else {
    qtyToClose = Math.min((trade.initialQuantity * percentageToClose) / 100, trade.currentQuantity);
  }

  if (qtyToClose <= 0) return;

  const notionalClosed = qtyToClose * exitPrice;
  const exitFee = notionalClosed * (trade.feeRatePercent / 100);
  const slippageFee = notionalClosed * (trade.slippagePercent / 100);
  const allocatedEntryFee = (qtyToClose / trade.initialQuantity) * trade.entryFeePaid;

  const hoursHeld = Math.max(0, (timestampMs - trade.entryTime) / (1000 * 60 * 60));
  const fundingIntervals = Math.floor(hoursHeld / 8);
  const fundingFee = trade.market === 'futures' ? notionalClosed * (trade.fundingRatePer8hPercent / 100) * fundingIntervals : 0;

  const unitGrossPnl = isLong ? exitPrice - trade.entryPrice : trade.entryPrice - exitPrice;
  const grossPnl = qtyToClose * unitGrossPnl;
  const netPnl = grossPnl - allocatedEntryFee - exitFee - slippageFee - fundingFee;

  const fill: PaperPartialFill = {
    level,
    percentageClosed: percentageToClose,
    quantityClosed: qtyToClose,
    remainingQuantity: Math.max(0, trade.currentQuantity - qtyToClose),
    exitPrice,
    executedAt: timestampMs,
    grossPnl,
    netPnl,
    feePaid: exitFee,
    slippagePaid: slippageFee,
    fundingPaid: fundingFee,
    reason: `Réconciliation hors-ligne : ${level} atteint`,
  };

  trade.partialFills.push(fill);
  trade.currentQuantity = fill.remainingQuantity;

  trade.realizedGrossPnl += grossPnl;
  trade.realizedNetPnl += netPnl;
  trade.totalExitFeePaid = (trade.totalExitFeePaid || 0) + exitFee;
  trade.totalSlippagePaid = (trade.totalSlippagePaid || 0) + slippageFee;
  trade.totalFundingPaid = (trade.totalFundingPaid || 0) + fundingFee;
  trade.totalFeesPaid = (trade.totalEntryFeePaid || trade.entryFeePaid) + trade.totalExitFeePaid;
  trade.totalCostsPaid = trade.totalFeesPaid + trade.totalSlippagePaid + trade.totalFundingPaid;
}
