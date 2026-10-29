import { MarketType, TradeSetup } from './crypto';

export type PaperTradeStatus =
  | 'OPEN'
  | 'TP1_HIT'
  | 'TP2_HIT'
  | 'TP3_HIT'
  | 'SL_HIT'
  | 'MANUAL_CLOSED'
  | 'INVALIDATED';

export interface PaperPartialFill {
  level: 'TP1' | 'TP2' | 'TP3' | 'SL' | 'MANUAL';
  percentageClosed: number; // e.g. 50, 25, 25
  quantityClosed: number;
  remainingQuantity: number;
  exitPrice: number;
  executedAt: number;
  grossPnl: number;
  netPnl: number;
  feePaid: number;
  slippagePaid: number;
  fundingPaid: number;
  reason: string;
}

export interface PaperTrade {
  id: string; // Unique deterministic ID: e.g. "pt-futures-BTCUSDT-1729000000"
  symbol: string;
  market: MarketType;
  direction: 'LONG' | 'SHORT';
  status: PaperTradeStatus;

  // Frozen copy of the signal parameters at entry
  entryTime: number;
  entryPrice: number;
  stopLoss: number;
  initialStopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3?: number;
  qualityScore: number;
  ratingLabel?: string;
  initialNetRR: number;

  // Sizing and capital metrics
  initialQuantity: number;
  currentQuantity: number;
  notionalValueUsd: number;
  allocatedRiskUsd: number;
  allocatedRiskPercent: number;
  marginUsedUsd: number;
  leverage: number;
  tickSize?: number;

  // Friction parameters
  feeRatePercent: number; // e.g. 0.04% per side
  slippagePercent: number; // e.g. 0.02%
  fundingRatePer8hPercent: number; // e.g. 0.01%
  entryFeePaid: number; // Entry fee allocated initially

  // Execution tracking
  currentMarketPrice: number;
  lastPriceUpdate: number;
  highestPriceSeen: number;
  lowestPriceSeen: number;
  isStalePrice: boolean;

  // Partial fills list
  partialFills: PaperPartialFill[];

  // Realized & Unrealized PnL
  realizedGrossPnl: number;
  realizedNetPnl: number;
  unrealizedGrossPnl: number;
  unrealizedNetPnl: number;
  totalFeesPaid: number;
  totalFundingPaid: number;

  // Exit information
  closeTime?: number;
  finalExitPrice?: number;
  exitReason?: string;

  // Strategy flags
  breakEvenMoved: boolean;
  breakEvenPrice?: number;
}

export interface PaperAccountConfig {
  initialCapital: number; // default 10,000 USDT
  riskPerTradePercent: number; // default 0.5%, max 1.0%
  tp1ClosePercent: number; // default 50%
  tp2ClosePercent: number; // default 25%
  tp3ClosePercent: number; // default 25%
  moveToBreakEvenAfterTP1: boolean; // default false
  defaultFeeRatePercent: number; // 0.04% futures, 0.10% spot
  defaultSlippagePercent: number; // 0.02%
  defaultFundingRatePercent: number; // 0.01% / 8h
  maxOpenPositions: number; // default 5
  isAutoTradingActive: boolean; // toggle "Activer le Paper Trading"
  isPaused: boolean; // pause monitoring
}

export interface PaperAccountState {
  config: PaperAccountConfig;
  initialCapital: number;
  availableBalance: number;
  marginLocked: number;
  equity: number;
  realizedNetPnl: number;
  unrealizedNetPnl: number;
  cumulativeFees: number;
  cumulativeFunding: number;
  openPositionsCount: number;
  closedTradesCount: number;
  winningTradesCount: number;
  losingTradesCount: number;
  breakEvenTradesCount: number;
}

export interface PaperTradingStats {
  totalClosedTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakEvenTrades: number;
  winRate: number; // %
  winRateConfidenceInterval: string; // Wilson CI 95%
  averageWinUsd: number;
  averageLossUsd: number;
  expectancyUsd: number; // E = p * avgWin - (1-p) * avgLoss
  profitFactor: number;
  maxDrawdownPercent: number;
  peakEquity: number;
  netCumulativeReturnPercent: number;

  // Breakdowns
  performanceBySymbol: Record<string, { trades: number; winRate: number; netPnl: number }>;
  performanceByDirection: {
    LONG: { trades: number; winRate: number; netPnl: number };
    SHORT: { trades: number; winRate: number; netPnl: number };
  };
  performanceByMarket: {
    spot: { trades: number; winRate: number; netPnl: number };
    futures: { trades: number; winRate: number; netPnl: number };
  };
  performanceByScoreBracket: Record<string, { trades: number; winRate: number; netPnl: number }>;
  isSampleSufficient: boolean;
}
