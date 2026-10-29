import { TradeSetup, MarketType } from '../types/crypto';
import {
  PaperTrade,
  PaperTradeStatus,
  PaperPartialFill,
  PaperAccountConfig,
  PaperAccountState,
  PaperTradingStats,
} from '../types/paperTrading';
import { quantizePrice } from './priceFormatter';

/**
 * Creates a new simulated paper trade from a validated trade setup.
 * Completely freezes the setup parameters so future scanner updates never alter this record.
 */
export function createPaperTradeFromSetup(
  setup: TradeSetup,
  accountBalance: number,
  config: PaperAccountConfig
): PaperTrade | null {
  if (!setup || setup.direction === 'NO_TRADE' || !setup.entryPrice || !setup.stopLoss) {
    return null;
  }

  const priceDiff = Math.abs(setup.entryPrice - setup.stopLoss);
  if (priceDiff <= 0) return null;

  // Sizing: risk exactly config.riskPerTradePercent of account balance
  const safeRiskPercent = Math.min(Math.max(config.riskPerTradePercent, 0.1), 2.0);
  const allocatedRiskUsd = (accountBalance * safeRiskPercent) / 100;
  const initialQuantity = allocatedRiskUsd / priceDiff;

  if (initialQuantity <= 0 || !isFinite(initialQuantity)) return null;

  const notionalValueUsd = initialQuantity * setup.entryPrice;
  const leverage = setup.market === 'futures' ? 5 : 1;
  const marginUsedUsd = notionalValueUsd / leverage;

  const feeRatePercent = setup.market === 'futures' ? 0.04 : 0.10; // Taker standard
  const slippagePercent = setup.estimatedSlippagePercent || config.defaultSlippagePercent || 0.02;
  const fundingRatePer8hPercent = setup.market === 'futures' ? config.defaultFundingRatePercent || 0.01 : 0;

  // Allocated entry fee
  const entryFeePaid = notionalValueUsd * (feeRatePercent / 100);

  const now = Date.now();
  const id = `pt-${setup.market}-${setup.pair}-${now}-${Math.random().toString(36).substring(2, 6)}`;

  return {
    id,
    symbol: setup.pair,
    market: setup.market,
    direction: setup.direction,
    status: 'OPEN',

    entryTime: now,
    entryPrice: setup.entryPrice,
    stopLoss: setup.stopLoss,
    initialStopLoss: setup.stopLoss,
    takeProfit1: setup.takeProfit1,
    takeProfit2: setup.takeProfit2,
    takeProfit3: setup.takeProfit3,
    qualityScore: 75, // Default confluence score
    ratingLabel: 'BON',
    initialNetRR: setup.netRiskRewardRatioTP1 || setup.riskRewardRatioTP1 || 1.5,

    initialQuantity,
    currentQuantity: initialQuantity,
    notionalValueUsd,
    allocatedRiskUsd,
    allocatedRiskPercent: safeRiskPercent,
    marginUsedUsd,
    leverage,
    tickSize: setup.tickSize,

    feeRatePercent,
    slippagePercent,
    fundingRatePer8hPercent,
    entryFeePaid,

    currentMarketPrice: setup.entryPrice,
    lastPriceUpdate: now,
    highestPriceSeen: setup.entryPrice,
    lowestPriceSeen: setup.entryPrice,
    isStalePrice: false,

    partialFills: [],

    realizedGrossPnl: 0,
    realizedNetPnl: -entryFeePaid, // Entry fee debited at start
    unrealizedGrossPnl: 0,
    unrealizedNetPnl: 0,
    totalFeesPaid: entryFeePaid,
    totalFundingPaid: 0,

    breakEvenMoved: false,
  };
}

/**
 * Updates a paper trade with a new live market price tick.
 * Handles conservative collision resolution, partial fills, break-even updates, and PnL.
 */
export function updateTradeWithCurrentPrice(
  trade: PaperTrade,
  currentPrice: number,
  priceTimestamp: number,
  isDataStale: boolean,
  config: PaperAccountConfig
): PaperTrade {
  // If trade is already closed or invalidated, keep as is
  if (
    trade.status === 'SL_HIT' ||
    trade.status === 'TP3_HIT' ||
    trade.status === 'MANUAL_CLOSED' ||
    trade.status === 'INVALIDATED' ||
    trade.currentQuantity <= 0
  ) {
    return trade;
  }

  // Clone trade to preserve immutability
  const updated: PaperTrade = {
    ...trade,
    partialFills: [...trade.partialFills],
  };

  updated.lastPriceUpdate = priceTimestamp;
  updated.isStalePrice = isDataStale;

  // Protect against non-positive or non-finite prices
  if (currentPrice <= 0 || !isFinite(currentPrice)) {
    return updated;
  }

  updated.currentMarketPrice = currentPrice;
  if (currentPrice > updated.highestPriceSeen) updated.highestPriceSeen = currentPrice;
  if (currentPrice < updated.lowestPriceSeen) updated.lowestPriceSeen = currentPrice;

  // SUSPEND automated execution if data is stale
  if (isDataStale) {
    return computeUnrealizedPnl(updated);
  }

  const isLong = updated.direction === 'LONG';
  const hasTP1Filled = updated.partialFills.some((f) => f.level === 'TP1');
  const hasTP2Filled = updated.partialFills.some((f) => f.level === 'TP2');
  const hasTP3Filled = updated.partialFills.some((f) => f.level === 'TP3');

  // 1. CONSERVATIVE COLLISION CHECK
  // If both Stop Loss and a Take Profit level are touched simultaneously in this tick / candle
  // Always assume Stop Loss is triggered first (realistic pessimistic execution)
  const hitsSL = isLong ? currentPrice <= updated.stopLoss : currentPrice >= updated.stopLoss;
  const hitsTP1 = isLong ? currentPrice >= updated.takeProfit1 : currentPrice <= updated.takeProfit1;

  if (hitsSL && hitsTP1 && !hasTP1Filled) {
    return executeFullStopLoss(updated, currentPrice, 'Collision conjointe SL / TP : Résolution conservative au Stop Loss');
  }

  // 2. STOP LOSS HIT
  if (hitsSL) {
    return executeFullStopLoss(updated, currentPrice, 'Stop Loss déclenché');
  }

  // 3. TAKE PROFIT 1 HIT
  if (!hasTP1Filled && hitsTP1) {
    executePartialTakeProfit(updated, 'TP1', updated.takeProfit1, config.tp1ClosePercent, 'Objectif TP1 atteint (sortie partielle)');

    // Move Stop Loss to Break-Even if option enabled
    if (config.moveToBreakEvenAfterTP1 && !updated.breakEvenMoved) {
      const frictionBuffer = updated.entryPrice * (((updated.feeRatePercent * 2) + updated.slippagePercent) / 100);
      const bePrice = isLong ? updated.entryPrice + frictionBuffer : updated.entryPrice - frictionBuffer;
      updated.stopLoss = updated.tickSize ? quantizePrice(bePrice, updated.tickSize, isLong ? 'ceil' : 'floor') : bePrice;
      updated.breakEvenMoved = true;
      updated.breakEvenPrice = updated.stopLoss;
    }

    if (updated.currentQuantity <= 0) {
      updated.status = 'TP1_HIT';
      updated.closeTime = Date.now();
      updated.finalExitPrice = updated.takeProfit1;
      updated.exitReason = 'Position entièrement clôturée sur TP1';
      return updated;
    }

    updated.status = 'TP1_HIT';
  }

  // 4. TAKE PROFIT 2 HIT
  const hitsTP2 = isLong ? currentPrice >= updated.takeProfit2 : currentPrice <= updated.takeProfit2;
  if (hasTP1Filled && !hasTP2Filled && hitsTP2) {
    executePartialTakeProfit(updated, 'TP2', updated.takeProfit2, config.tp2ClosePercent, 'Objectif TP2 atteint (sortie partielle)');

    if (updated.currentQuantity <= 0) {
      updated.status = 'TP2_HIT';
      updated.closeTime = Date.now();
      updated.finalExitPrice = updated.takeProfit2;
      updated.exitReason = 'Position entièrement clôturée sur TP2';
      return updated;
    }

    updated.status = 'TP2_HIT';
  }

  // 5. TAKE PROFIT 3 HIT (Full remaining position closed)
  if (updated.takeProfit3) {
    const hitsTP3 = isLong ? currentPrice >= updated.takeProfit3 : currentPrice <= updated.takeProfit3;
    if (hasTP2Filled && !hasTP3Filled && hitsTP3) {
      executePartialTakeProfit(updated, 'TP3', updated.takeProfit3, 100, 'Objectif TP3 final atteint (clôture complète)');
      updated.status = 'TP3_HIT';
      updated.closeTime = Date.now();
      updated.finalExitPrice = updated.takeProfit3;
      updated.exitReason = 'Tous les objectifs TP1, TP2, TP3 atteints';
      return updated;
    }
  }

  // Compute unrealized PnL on remaining open quantity
  return computeUnrealizedPnl(updated);
}

/**
 * Execute a partial Take Profit
 */
function executePartialTakeProfit(
  trade: PaperTrade,
  level: 'TP1' | 'TP2' | 'TP3',
  exitPrice: number,
  percentageToClose: number,
  reason: string
): void {
  const isLong = trade.direction === 'LONG';
  // Compute quantity to close
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

  // Proportional entry fee allocation
  const allocatedEntryFee = (qtyToClose / trade.initialQuantity) * trade.entryFeePaid;

  // Proportional funding fee (simulated for perpetual futures)
  const hoursHeld = Math.max(0, (Date.now() - trade.entryTime) / (1000 * 60 * 60));
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
    executedAt: Date.now(),
    grossPnl,
    netPnl,
    feePaid: exitFee,
    slippagePaid: slippageFee,
    fundingPaid: fundingFee,
    reason,
  };

  trade.partialFills.push(fill);
  trade.currentQuantity = fill.remainingQuantity;
  trade.realizedGrossPnl += grossPnl;
  trade.realizedNetPnl += netPnl;
  trade.totalFeesPaid += exitFee;
  trade.totalFundingPaid += fundingFee;
}

/**
 * Executes a full Stop Loss with realistic slippage / gap handling
 */
function executeFullStopLoss(trade: PaperTrade, marketPrice: number, reason: string): PaperTrade {
  const isLong = trade.direction === 'LONG';
  const qtyToClose = trade.currentQuantity;
  if (qtyToClose <= 0) return trade;

  // If price gapped past Stop Loss, use the worse price (conservative gap slippage)
  let simulatedExitPrice = trade.stopLoss;
  if (isLong && marketPrice < trade.stopLoss) {
    simulatedExitPrice = marketPrice; // Adverse gap execution
  } else if (!isLong && marketPrice > trade.stopLoss) {
    simulatedExitPrice = marketPrice; // Adverse gap execution
  }

  const notionalClosed = qtyToClose * simulatedExitPrice;
  const exitFee = notionalClosed * (trade.feeRatePercent / 100);
  const slippageFee = notionalClosed * (trade.slippagePercent / 100);

  // Proportional entry fee for the remaining quantity
  const allocatedEntryFee = (qtyToClose / trade.initialQuantity) * trade.entryFeePaid;

  const hoursHeld = Math.max(0, (Date.now() - trade.entryTime) / (1000 * 60 * 60));
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
    executedAt: Date.now(),
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
  trade.closeTime = Date.now();
  trade.finalExitPrice = simulatedExitPrice;
  trade.exitReason = reason;

  trade.realizedGrossPnl += grossPnl;
  trade.realizedNetPnl += netPnl;
  trade.totalFeesPaid += exitFee;
  trade.totalFundingPaid += fundingFee;

  trade.unrealizedGrossPnl = 0;
  trade.unrealizedNetPnl = 0;

  return trade;
}

/**
 * Manually closes an open paper trade
 */
export function manualClosePaperTrade(trade: PaperTrade, currentPrice: number): PaperTrade {
  if (trade.currentQuantity <= 0) return trade;

  const updated: PaperTrade = {
    ...trade,
    partialFills: [...trade.partialFills],
  };

  const isLong = updated.direction === 'LONG';
  const qtyToClose = updated.currentQuantity;
  const notionalClosed = qtyToClose * currentPrice;

  const exitFee = notionalClosed * (updated.feeRatePercent / 100);
  const slippageFee = notionalClosed * (updated.slippagePercent / 100);
  const allocatedEntryFee = (qtyToClose / updated.initialQuantity) * updated.entryFeePaid;

  const unitGrossPnl = isLong ? currentPrice - updated.entryPrice : updated.entryPrice - currentPrice;
  const grossPnl = qtyToClose * unitGrossPnl;
  const netPnl = grossPnl - allocatedEntryFee - exitFee - slippageFee;

  const fill: PaperPartialFill = {
    level: 'MANUAL',
    percentageClosed: 100,
    quantityClosed: qtyToClose,
    remainingQuantity: 0,
    exitPrice: currentPrice,
    executedAt: Date.now(),
    grossPnl,
    netPnl,
    feePaid: exitFee,
    slippagePaid: slippageFee,
    fundingPaid: 0,
    reason: 'Clôture manuelle simulée par l’utilisateur',
  };

  updated.partialFills.push(fill);
  updated.currentQuantity = 0;
  updated.status = 'MANUAL_CLOSED';
  updated.closeTime = Date.now();
  updated.finalExitPrice = currentPrice;
  updated.exitReason = 'Clôturé manuellement au prix du marché';

  updated.realizedGrossPnl += grossPnl;
  updated.realizedNetPnl += netPnl;
  updated.totalFeesPaid += exitFee;

  updated.unrealizedGrossPnl = 0;
  updated.unrealizedNetPnl = 0;

  return updated;
}

/**
 * Computes mark-to-market unrealized PnL on remaining open quantity
 */
function computeUnrealizedPnl(trade: PaperTrade): PaperTrade {
  if (trade.currentQuantity <= 0) {
    trade.unrealizedGrossPnl = 0;
    trade.unrealizedNetPnl = 0;
    return trade;
  }

  const isLong = trade.direction === 'LONG';
  const unitPnl = isLong ? trade.currentMarketPrice - trade.entryPrice : trade.entryPrice - trade.currentMarketPrice;
  const grossUnrealized = trade.currentQuantity * unitPnl;

  const estimatedExitFee = (trade.currentQuantity * trade.currentMarketPrice) * (trade.feeRatePercent / 100);
  const estimatedSlippage = (trade.currentQuantity * trade.currentMarketPrice) * (trade.slippagePercent / 100);

  trade.unrealizedGrossPnl = grossUnrealized;
  trade.unrealizedNetPnl = grossUnrealized - estimatedExitFee - estimatedSlippage;

  return trade;
}

/**
 * Calculates global Account State from configuration and trades
 */
export function calculateAccountState(
  trades: PaperTrade[],
  config: PaperAccountConfig
): PaperAccountState {
  const initialCapital = config.initialCapital;
  let realizedNetPnl = 0;
  let unrealizedNetPnl = 0;
  let marginLocked = 0;
  let cumulativeFees = 0;
  let cumulativeFunding = 0;

  let openPositionsCount = 0;
  let closedTradesCount = 0;
  let winningTradesCount = 0;
  let losingTradesCount = 0;
  let breakEvenTradesCount = 0;

  for (const t of trades) {
    realizedNetPnl += t.realizedNetPnl;
    cumulativeFees += t.totalFeesPaid;
    cumulativeFunding += t.totalFundingPaid;

    if (t.currentQuantity > 0 && t.status !== 'SL_HIT' && t.status !== 'TP3_HIT' && t.status !== 'MANUAL_CLOSED') {
      openPositionsCount++;
      marginLocked += t.marginUsedUsd;
      unrealizedNetPnl += t.unrealizedNetPnl;
    } else {
      closedTradesCount++;
      if (t.realizedNetPnl > 0.01) {
        winningTradesCount++;
      } else if (t.realizedNetPnl < -0.01) {
        losingTradesCount++;
      } else {
        breakEvenTradesCount++;
      }
    }
  }

  const availableBalance = Math.max(0, initialCapital + realizedNetPnl - marginLocked);
  const equity = initialCapital + realizedNetPnl + unrealizedNetPnl;

  return {
    config,
    initialCapital,
    availableBalance,
    marginLocked,
    equity,
    realizedNetPnl,
    unrealizedNetPnl,
    cumulativeFees,
    cumulativeFunding,
    openPositionsCount,
    closedTradesCount,
    winningTradesCount,
    losingTradesCount,
    breakEvenTradesCount,
  };
}

/**
 * Computes comprehensive Paper Trading Statistics strictly on fully closed trades
 */
export function calculatePaperTradingStats(trades: PaperTrade[]): PaperTradingStats {
  const closedTrades = trades.filter(
    (t) => t.currentQuantity <= 0 || t.status === 'SL_HIT' || t.status === 'TP3_HIT' || t.status === 'MANUAL_CLOSED'
  );

  const totalClosedTrades = closedTrades.length;
  const winners = closedTrades.filter((t) => t.realizedNetPnl > 0.01);
  const losers = closedTrades.filter((t) => t.realizedNetPnl < -0.01);
  const breakEvens = closedTrades.filter((t) => Math.abs(t.realizedNetPnl) <= 0.01);

  const winningTrades = winners.length;
  const losingTrades = losers.length;
  const breakEvenTrades = breakEvens.length;

  const winRate = totalClosedTrades > 0 ? (winningTrades / totalClosedTrades) * 100 : 0;

  // Wilson Score 95% Confidence Interval
  let winRateConfidenceInterval = 'N/A';
  if (totalClosedTrades >= 5) {
    const p = winRate / 100;
    const q = 1 - p;
    const z = 1.95996;
    const z2 = z * z;
    const n = totalClosedTrades;
    const denom = 1 + z2 / n;
    const center = (p + z2 / (2 * n)) / denom;
    const margin = (z / denom) * Math.sqrt((p * q) / n + z2 / (4 * n * n));
    const lower = Math.max(0, (center - margin) * 100).toFixed(1);
    const upper = Math.min(100, (center + margin) * 100).toFixed(1);
    winRateConfidenceInterval = `[${lower}% - ${upper}%]`;
  }

  const totalWinUsd = winners.reduce((acc, t) => acc + t.realizedNetPnl, 0);
  const totalLossUsd = Math.abs(losers.reduce((acc, t) => acc + t.realizedNetPnl, 0));

  const averageWinUsd = winningTrades > 0 ? totalWinUsd / winningTrades : 0;
  const averageLossUsd = losingTrades > 0 ? totalLossUsd / losingTrades : 0;

  const pWin = totalClosedTrades > 0 ? winningTrades / totalClosedTrades : 0;
  const pLoss = totalClosedTrades > 0 ? losingTrades / totalClosedTrades : 0;
  const expectancyUsd = (pWin * averageWinUsd) - (pLoss * averageLossUsd);

  // Profit Factor: Total Gains / Total Losses
  let profitFactor = 0;
  if (totalLossUsd > 0) {
    profitFactor = parseFloat((totalWinUsd / totalLossUsd).toFixed(2));
  } else if (totalWinUsd > 0) {
    profitFactor = 99.0; // 0 loss recorded
  }

  // Equity curve and Max Drawdown calculation
  let runningEquity = 10000;
  let peakEquity = 10000;
  let maxDrawdownPercent = 0;

  for (const t of closedTrades) {
    runningEquity += t.realizedNetPnl;
    if (runningEquity > peakEquity) peakEquity = runningEquity;
    const currentDd = ((peakEquity - runningEquity) / peakEquity) * 100;
    if (currentDd > maxDrawdownPercent) maxDrawdownPercent = currentDd;
  }

  const netCumulativeReturnPercent = ((runningEquity - 10000) / 10000) * 100;

  // Breakdown by Symbol
  const performanceBySymbol: Record<string, { trades: number; winRate: number; netPnl: number }> = {};
  for (const t of closedTrades) {
    if (!performanceBySymbol[t.symbol]) {
      performanceBySymbol[t.symbol] = { trades: 0, winRate: 0, netPnl: 0 };
    }
    performanceBySymbol[t.symbol].trades++;
    performanceBySymbol[t.symbol].netPnl += t.realizedNetPnl;
  }
  for (const sym of Object.keys(performanceBySymbol)) {
    const symTrades = closedTrades.filter((t) => t.symbol === sym);
    const symWins = symTrades.filter((t) => t.realizedNetPnl > 0.01).length;
    performanceBySymbol[sym].winRate = (symWins / symTrades.length) * 100;
  }

  // Breakdown by Direction
  const longTrades = closedTrades.filter((t) => t.direction === 'LONG');
  const shortTrades = closedTrades.filter((t) => t.direction === 'SHORT');
  const performanceByDirection = {
    LONG: {
      trades: longTrades.length,
      winRate: longTrades.length > 0 ? (longTrades.filter((t) => t.realizedNetPnl > 0.01).length / longTrades.length) * 100 : 0,
      netPnl: longTrades.reduce((acc, t) => acc + t.realizedNetPnl, 0),
    },
    SHORT: {
      trades: shortTrades.length,
      winRate: shortTrades.length > 0 ? (shortTrades.filter((t) => t.realizedNetPnl > 0.01).length / shortTrades.length) * 100 : 0,
      netPnl: shortTrades.reduce((acc, t) => acc + t.realizedNetPnl, 0),
    },
  };

  // Breakdown by Market
  const spotTrades = closedTrades.filter((t) => t.market === 'spot');
  const futuresTrades = closedTrades.filter((t) => t.market === 'futures');
  const performanceByMarket = {
    spot: {
      trades: spotTrades.length,
      winRate: spotTrades.length > 0 ? (spotTrades.filter((t) => t.realizedNetPnl > 0.01).length / spotTrades.length) * 100 : 0,
      netPnl: spotTrades.reduce((acc, t) => acc + t.realizedNetPnl, 0),
    },
    futures: {
      trades: futuresTrades.length,
      winRate: futuresTrades.length > 0 ? (futuresTrades.filter((t) => t.realizedNetPnl > 0.01).length / futuresTrades.length) * 100 : 0,
      netPnl: futuresTrades.reduce((acc, t) => acc + t.realizedNetPnl, 0),
    },
  };

  // Breakdown by Score Bracket
  const scoreBrackets = ['60-69', '70-79', '80-89', '90-100'];
  const performanceByScoreBracket: Record<string, { trades: number; winRate: number; netPnl: number }> = {};
  for (const b of scoreBrackets) {
    const [min, max] = b.split('-').map(Number);
    const bracketTrades = closedTrades.filter((t) => t.qualityScore >= min && t.qualityScore <= max);
    const bracketWins = bracketTrades.filter((t) => t.realizedNetPnl > 0.01).length;
    performanceByScoreBracket[b] = {
      trades: bracketTrades.length,
      winRate: bracketTrades.length > 0 ? (bracketWins / bracketTrades.length) * 100 : 0,
      netPnl: bracketTrades.reduce((acc, t) => acc + t.realizedNetPnl, 0),
    };
  }

  return {
    totalClosedTrades,
    winningTrades,
    losingTrades,
    breakEvenTrades,
    winRate,
    winRateConfidenceInterval,
    averageWinUsd,
    averageLossUsd,
    expectancyUsd,
    profitFactor,
    maxDrawdownPercent,
    peakEquity,
    netCumulativeReturnPercent,
    performanceBySymbol,
    performanceByDirection,
    performanceByMarket,
    performanceByScoreBracket,
    isSampleSufficient: totalClosedTrades >= 15,
  };
}
