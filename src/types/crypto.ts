export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type MarketType = 'spot' | 'futures';

export type Timeframe = '5m' | '15m' | '1h' | '4h' | '1d';

export interface TickerData {
  symbol: string;
  market: MarketType;
  price: number;
  change24h: number;
  change24hAmount: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  quoteVolume24h: number;
  timestamp: number;
  isLive: boolean;
  source: string;
  warning?: string;
  tickSize?: number;
  pricePrecision?: number;
}

export interface IndicatorSnapshot {
  timeframe: Timeframe;
  currentPrice: number;
  ema20: number;
  ema50: number;
  ema200?: number;
  rsi: number;
  atr: number;
  atrPercent: number;
  trend: 'HAUSSIÈRE' | 'BAISSIÈRE' | 'CONSOLIDATION';
  structure: 'BULLISH_STRUCTURE' | 'BEARISH_STRUCTURE' | 'NEUTRAL';
  recentHigh: number;
  recentLow: number;
  averageVolume20: number;
  volumeRatio: number;
  candleCount: number;
  orderBlock?: {
    type: 'BULLISH' | 'BEARISH';
    top: number;
    bottom: number;
    mitigated: boolean;
  };
  fvg?: {
    type: 'BULLISH' | 'BEARISH';
    top: number;
    bottom: number;
    filled: boolean;
  };
  liquiditySweepDetected?: boolean;
  breakOfStructureDetected?: boolean;
  changeOfCharacterDetected?: boolean;
}

export interface VerificationCheck {
  id: string;
  label: string;
  status: 'PASSED' | 'FAILED' | 'WARNING';
  comment: string;
}

export interface TradeSetup {
  direction: 'LONG' | 'SHORT' | 'NO_TRADE';
  pair: string;
  market: MarketType;
  entryPrice: number;
  entryZone: string;
  stopLoss: number;
  invalidationCondition: string;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3?: number;
  riskRewardRatioTP1: number; // Ratio brut TP1
  riskRewardRatioTP2: number; // Ratio brut TP2
  netRiskRewardRatioTP1: number; // Ratio net TP1 après frais et slippage
  netRiskRewardRatioTP2: number; // Ratio net TP2 après frais et slippage
  grossGainPercentTP1: number;
  netGainPercentTP1: number;
  riskPercent: number; // % distance de l'entrée au SL
  suggestedRiskPercent: number;
  tickSize?: number;
  keyConfluences: string[];
  mainRisks: string[];
  dataTimestamp: number;
}

export interface QualityScore {
  total: number; // 0 to 100
  ratingLabel: 'EXCELLENT' | 'BON' | 'MOYEN' | 'INSUFFISANT';
  breakdown: {
    htfAlignment: number; // /20
    marketStructure: number; // /20
    entryQuality: number; // /15
    volumeConfirmation: number; // /15
    riskRewardScore: number; // /15
    volatilityScore: number; // /10
    dataReliability: number; // /5
  };
  explanation: string;
}

export interface VisionAnalysisResult {
  chartReadability: 'EXCELLENTE' | 'MOYENNE' | 'DIFFICILEMENT_LISIBLE';
  detectedPair: string;
  detectedTimeframe: string;
  candlestickStructure: {
    dominantType: string;
    description: string;
    wicksAndRejections: string;
  };
  trend: {
    direction: 'HAUSSIERE' | 'BAISSIERE' | 'RANGE_CONSOLIDATION' | 'INCERTAINE';
    strength: 'FORTE' | 'MODEREE' | 'AFFAIBLIE';
    rationale: string;
  };
  smcElements: {
    breakOfStructure: { present: boolean; details: string };
    changeOfCharacter: { present: boolean; details: string };
    orderBlocks: Array<{
      type: 'BULLISH' | 'BEARISH';
      priceZone: string;
      mitigated: boolean;
      notes: string;
    }>;
    fairValueGaps: Array<{
      type: 'HAUSSIER' | 'BAISSIER';
      priceZone: string;
      filled: boolean;
      notes: string;
    }>;
    liquiditySweeps: {
      detected: boolean;
      side: 'BUY_SIDE' | 'SELL_SIDE' | 'AUCUN';
      details: string;
    };
  };
  supportResistanceLevels: Array<{
    level: string;
    type: 'SUPPORT' | 'RESISTANCE';
    reliability: 'HAUTE' | 'MOYENNE' | 'APPROXIMATIVE';
  }>;
  potentialEntryZones: Array<{
    zone: string;
    bias: 'ACHAT' | 'VENTE' | 'ATTENTE';
    rationale: string;
    invalidation: string;
  }>;
  verificationAlerts: string[];
  overallEvaluation: string;
  tradeVerdict: 'CONFIG_LONG_ENVISAGEABLE' | 'CONFIG_SHORT_ENVISAGEABLE' | 'NO_TRADE_ATTENTE';
}

export interface BacktestTrade {
  id: string;
  date: string;
  type: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice: number;
  result: 'WIN' | 'LOSS';
  pnlPercent: number;
  rrrRealized: number;
  feesPaid: number;
  netPnlPercent: number;
  timeframe: string;
  marketRegime: 'HAUSSIER' | 'BAISSIER' | 'RANGE';
}

export interface BacktestSummary {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number; // %
  profitFactor: number;
  avgWinPercent: number;
  avgLossPercent: number;
  maxDrawdownPercent: number;
  grossReturnPercent: number;
  netReturnPercent: number;
  totalFeesPaidPercent: number;
  equityCurve: Array<{ tradeIndex: number; equity: number }>;
  regimeBreakdown: Record<string, { trades: number; winRate: number; pnl: number }>;
}

export interface RiskCalculation {
  accountBalance: number;
  riskPercent: number;
  entryPrice: number;
  stopLoss: number;
  market: MarketType;
  leverage: number;
  feeRatePercent: number;
  monetaryRisk: number;
  stopLossDistancePercent: number;
  positionSizeCrypto: number;
  positionSizeUsd: number;
  marginRequiredUsd: number;
  estLiquidationPrice: number | null;
  estTotalFeesUsd: number;
}

export interface SavedAnalysis {
  id: string;
  symbol: string;
  market: MarketType;
  timestamp: number;
  verdict: 'LONG' | 'SHORT' | 'NO_TRADE';
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  qualityScore: number;
  summary: string;
}
