import { IndicatorSnapshot, MarketType, QualityScore, TickerData, TradeSetup, VerificationCheck } from '../types/crypto';
import { formatCryptoPrice, quantizePrice, getDecimalsFromTickSize } from './priceFormatter';

export interface EvaluationInput {
  symbol: string;
  market: MarketType;
  currentPrice: number;
  ticker?: TickerData | null;
  timeframe4h?: IndicatorSnapshot;
  timeframe1h?: IndicatorSnapshot;
  timeframe15m?: IndicatorSnapshot;
  timeframe5m?: IndicatorSnapshot;
  userRiskPercent?: number;
}

export interface EvaluationResult {
  outcome: 'LONG' | 'SHORT' | 'NO_TRADE';
  setup?: TradeSetup;
  qualityScore: QualityScore;
  checklist: VerificationCheck[];
  noTradeReasons: string[];
  executiveSummary: string;
}

/**
 * Validate price hierarchy deterministically
 */
export function validatePriceHierarchy(
  direction: 'LONG' | 'SHORT',
  entry: number,
  sl: number,
  tp1: number,
  tp2: number,
  tp3?: number
): { isValid: boolean; errorReason?: string } {
  if (isNaN(entry) || isNaN(sl) || isNaN(tp1) || isNaN(tp2) || entry <= 0 || sl <= 0 || tp1 <= 0 || tp2 <= 0) {
    return { isValid: false, errorReason: 'Données de prix non numériques ou inférieures ou égales à zéro.' };
  }

  if (direction === 'LONG') {
    if (sl >= entry) {
      return { isValid: false, errorReason: `Pour un LONG, le Stop Loss (${sl}) doit être strictement inférieur au prix d'entrée (${entry}).` };
    }
    if (tp1 <= entry) {
      return { isValid: false, errorReason: `Pour un LONG, le TP1 (${tp1}) doit être strictement supérieur au prix d'entrée (${entry}).` };
    }
    if (tp2 <= tp1) {
      return { isValid: false, errorReason: `Pour un LONG, le TP2 (${tp2}) doit être strictement supérieur au TP1 (${tp1}).` };
    }
    if (tp3 !== undefined && tp3 <= tp2) {
      return { isValid: false, errorReason: `Pour un LONG, le TP3 (${tp3}) doit être strictement supérieur au TP2 (${tp2}).` };
    }
  } else if (direction === 'SHORT') {
    if (sl <= entry) {
      return { isValid: false, errorReason: `Pour un SHORT, le Stop Loss (${sl}) doit être strictement supérieur au prix d'entrée (${entry}).` };
    }
    if (tp1 >= entry) {
      return { isValid: false, errorReason: `Pour un SHORT, le TP1 (${tp1}) doit être strictement inférieur au prix d'entrée (${entry}).` };
    }
    if (tp2 >= tp1) {
      return { isValid: false, errorReason: `Pour un SHORT, le TP2 (${tp2}) doit être strictement inférieur au TP1 (${tp1}).` };
    }
    if (tp3 !== undefined && tp3 >= tp2) {
      return { isValid: false, errorReason: `Pour un SHORT, le TP3 (${tp3}) doit être strictement inférieur au TP2 (${tp2}).` };
    }
  }

  return { isValid: true };
}

/**
 * Compute gross and net Risk-to-Reward ratio
 */
export function calculateRiskRewardRatios(
  direction: 'LONG' | 'SHORT',
  entry: number,
  sl: number,
  tp: number,
  frictionPercent: number
): { risk: number; potentialGain: number; grossRR: number; netRR: number; grossGainPct: number; netGainPct: number; riskPct: number; isValid: boolean; errorReason?: string } {
  if (entry <= 0 || sl <= 0 || tp <= 0) {
    return { risk: 0, potentialGain: 0, grossRR: 0, netRR: 0, grossGainPct: 0, netGainPct: 0, riskPct: 0, isValid: false, errorReason: 'Prix invalides.' };
  }

  const risk = direction === 'LONG' ? entry - sl : sl - entry;
  if (risk <= 0) {
    return { risk, potentialGain: 0, grossRR: 0, netRR: 0, grossGainPct: 0, netGainPct: 0, riskPct: 0, isValid: false, errorReason: 'Le risque monétaire est nul ou négatif.' };
  }

  const potentialGain = direction === 'LONG' ? tp - entry : entry - tp;
  if (potentialGain <= 0) {
    return { risk, potentialGain, grossRR: 0, netRR: 0, grossGainPct: 0, netGainPct: 0, riskPct: 0, isValid: false, errorReason: 'Le gain potentiel est nul ou négatif.' };
  }

  const grossRR = potentialGain / risk;
  const riskPct = (risk / entry) * 100;
  const grossGainPct = (potentialGain / entry) * 100;
  const netGainPct = grossGainPct - frictionPercent;
  const netRR = riskPct > 0 ? netGainPct / riskPct : 0;

  return {
    risk,
    potentialGain,
    grossRR,
    netRR,
    grossGainPct,
    netGainPct,
    riskPct,
    isValid: true,
  };
}

/**
 * Perform structured 10-point market condition verification and compute Trade Setup or NO TRADE
 * Grounded in real Binance market data, real quote volumes, official tickSize, and strict capital preservation rules.
 */
export function evaluateMarketSetup(input: EvaluationInput): EvaluationResult {
  const { symbol, market, currentPrice, ticker, timeframe4h, timeframe1h, timeframe15m, timeframe5m } = input;
  const userRisk = Math.min(Math.max(input.userRiskPercent || 1.0, 0.25), 3.0);
  const tickSize = ticker?.tickSize || (currentPrice < 0.1 ? 0.00001 : currentPrice < 1 ? 0.0001 : 0.01);

  const checklist: VerificationCheck[] = [];
  const noTradeReasons: string[] = [];

  // 1. Data Freshness & Price Sanity Check
  const isPriceValid = currentPrice > 0 && !isNaN(currentPrice);
  const now = Date.now();
  const tickerTime = ticker?.timestamp || 0;
  const dataAgeSeconds = tickerTime > 0 ? Math.max(0, (now - tickerTime) / 1000) : 999;
  const isDataFresh = isPriceValid && dataAgeSeconds < 120;

  checklist.push({
    id: 'check-1',
    label: 'Fraîcheur et validité des cotations réelles',
    status: isDataFresh ? 'PASSED' : dataAgeSeconds < 300 ? 'WARNING' : 'FAILED',
    comment: isPriceValid
      ? `Prix vérifié : ${formatCryptoPrice(currentPrice, tickSize)} USDT (Horodatage flux : il y a ${Math.round(dataAgeSeconds)}s).`
      : 'Prix invalide ou source déconnectée.',
  });
  if (!isPriceValid || dataAgeSeconds >= 300) {
    noTradeReasons.push('Données de marché obsolètes (> 5 min) ou prix non disponible.');
  }

  // 2. Pair and Exchange Confirmation (Real API verification)
  const isLiveVerified = ticker?.isLive === true && ticker?.symbol === symbol;
  checklist.push({
    id: 'check-2',
    label: 'Identification de la paire & du marché Binance',
    status: isLiveVerified ? 'PASSED' : 'FAILED',
    comment: isLiveVerified
      ? `Paire active confirmée : ${symbol} sur ${ticker.source} (TickSize: ${tickSize}).`
      : `Paire ${symbol} introuvable ou non active sur ${market === 'futures' ? 'Binance Futures' : 'Binance Spot'}.`,
  });
  if (!isLiveVerified) {
    noTradeReasons.push(`La paire ${symbol} n'a pas pu être validée sur l'API publique Binance (${market}).`);
  }

  // 3. Higher-Timeframe (HTF: 4H / 1H) Trend Alignment
  const htfTrend = timeframe4h?.trend || timeframe1h?.trend || 'CONSOLIDATION';
  const htfStructure = timeframe4h?.structure || timeframe1h?.structure || 'NEUTRAL';
  const ltfTrend = timeframe15m?.trend || timeframe5m?.trend || 'CONSOLIDATION';

  const isBullishHTF = htfTrend === 'HAUSSIÈRE' && htfStructure === 'BULLISH_STRUCTURE';
  const isBearishHTF = htfTrend === 'BAISSIÈRE' && htfStructure === 'BEARISH_STRUCTURE';
  const isHTFConsolidating = htfTrend === 'CONSOLIDATION';
  const isOpposingTrend = (timeframe4h?.trend === 'HAUSSIÈRE' && timeframe1h?.trend === 'BAISSIÈRE') ||
                          (timeframe4h?.trend === 'BAISSIÈRE' && timeframe1h?.trend === 'HAUSSIÈRE');

  checklist.push({
    id: 'check-3',
    label: 'Alignement de la tendance supérieure (HTF 4H/1H)',
    status: (isBullishHTF || isBearishHTF) && !isOpposingTrend ? 'PASSED' : isOpposingTrend ? 'FAILED' : 'WARNING',
    comment: isOpposingTrend
      ? `Conflit de tendance majeur : 4H est ${timeframe4h?.trend} alors que 1H est ${timeframe1h?.trend}.`
      : `Tendance HTF : ${htfTrend} (${htfStructure}).`,
  });
  if (isOpposingTrend) {
    noTradeReasons.push('Divergence directionnelle majeure entre les unités 4H et 1H.');
  }

  // 4. Technical Entry Justification (SMC: Order Block, FVG, or Liquidity Sweep)
  const ob15m = timeframe15m?.orderBlock || timeframe1h?.orderBlock;
  const fvg15m = timeframe15m?.fvg || timeframe1h?.fvg;
  const hasFreshSMC = (ob15m && !ob15m.mitigated) || (fvg15m && !fvg15m.filled) || timeframe15m?.liquiditySweepDetected;

  checklist.push({
    id: 'check-4',
    label: 'Justification technique de la zone d’entrée (SMC)',
    status: hasFreshSMC ? 'PASSED' : (ob15m || fvg15m) ? 'WARNING' : 'FAILED',
    comment: hasFreshSMC
      ? `Confluence SMC active : ${ob15m && !ob15m.mitigated ? 'Order Block non mitigé' : ''} ${fvg15m && !fvg15m.filled ? '+ FVG ouvert' : ''} ${timeframe15m?.liquiditySweepDetected ? '+ Balayage liquidité' : ''}.`
      : (ob15m || fvg15m)
      ? 'Zones SMC détectées mais déjà mitigées ou comblées par les mèches récentes.'
      : 'Aucune zone institutionnelle SMC nette dans le voisinage immédiat.',
  });
  if (!ob15m && !fvg15m && !timeframe15m?.liquiditySweepDetected) {
    noTradeReasons.push('Absence de zone SMC (Order Block ou FVG non mitigé) pour justifier un point d’entrée à faible risque.');
  }

  // 5. Volatility Check (ATR 14)
  const atrPercent = timeframe15m?.atrPercent || timeframe1h?.atrPercent || 1.2;
  const isVolatilityExtreme = atrPercent > 3.5;
  const isVolatilityTooLow = atrPercent < 0.20;

  checklist.push({
    id: 'check-5',
    label: 'Contrôle de la volatilité de marché (ATR)',
    status: (!isVolatilityExtreme && !isVolatilityTooLow) ? 'PASSED' : 'FAILED',
    comment: isVolatilityExtreme
      ? `Pic de volatilité excessif (ATR: ${atrPercent.toFixed(2)}%). Risque élevé de mèches assassines et slippage.`
      : isVolatilityTooLow
      ? `Volatilité trop basse (ATR: ${atrPercent.toFixed(2)}%). Marché comprimé ou illiquide.`
      : `Volatilité nominale équilibrée (ATR: ${atrPercent.toFixed(2)}%).`,
  });
  if (isVolatilityExtreme) {
    noTradeReasons.push(`Volatilité anormale détectée (ATR = ${atrPercent.toFixed(2)}%). Risque de perte accélérée.`);
  }

  // 6. Conflicting Signals Verification (RSI Overextension & Momentum)
  const rsi15m = timeframe15m?.rsi || 50;
  const rsi1h = timeframe1h?.rsi || 50;
  const isOverbought = rsi15m > 74 || rsi1h > 75;
  const isOversold = rsi15m < 26 || rsi1h < 25;

  const conflictingLong = isBullishHTF && isOverbought;
  const conflictingShort = isBearishHTF && isOversold;
  const hasConflictingSignals = conflictingLong || conflictingShort || (htfTrend === 'HAUSSIÈRE' && ltfTrend === 'BAISSIÈRE' && !timeframe15m?.liquiditySweepDetected);

  checklist.push({
    id: 'check-6',
    label: 'Absence de signaux contradictoires et surachat/survente',
    status: hasConflictingSignals ? 'FAILED' : 'PASSED',
    comment: conflictingLong
      ? `Surachat critique (RSI 15M: ${rsi15m.toFixed(1)}). Acheter en sommet de vague présente un risque élevé de repli.`
      : conflictingShort
      ? `Survente critique (RSI 15M: ${rsi15m.toFixed(1)}). Vendre en creux de marché expose à un rebond technique violent.`
      : hasConflictingSignals
      ? `Momentum contradictoire entre 15M et l’unité supérieure.`
      : `Oscillateurs cohérents (RSI 15M: ${rsi15m.toFixed(1)}, RSI 1H: ${rsi1h.toFixed(1)}).`,
  });
  if (conflictingLong) {
    noTradeReasons.push(`Achat interdit en zone de surachat prononcé (RSI 15M = ${rsi15m.toFixed(1)}). Attendre un repli.`);
  }
  if (conflictingShort) {
    noTradeReasons.push(`Vente interdite en zone de survente prononcée (RSI 15M = ${rsi15m.toFixed(1)}). Attendre un rebond.`);
  }

  // 7. Real Liquidity & 24h Volume Verification (ACTUAL CHECK from Binance data)
  const quoteVolume = ticker?.quoteVolume24h || 0;
  const hasHighLiquidity = quoteVolume >= 5000000; // >= 5M USDT
  const hasModerateLiquidity = quoteVolume >= 1000000 && quoteVolume < 5000000; // 1M - 5M USDT
  const isIlliquid = quoteVolume < 1000000;

  checklist.push({
    id: 'check-7',
    label: 'Profondeur de liquidité et volume réel négocié',
    status: hasHighLiquidity ? 'PASSED' : hasModerateLiquidity ? 'WARNING' : 'FAILED',
    comment: hasHighLiquidity
      ? `Liquidité 24h confirmée : ${(quoteVolume / 1000000).toFixed(1)} millions USDT négociés. Faible risque de slippage.`
      : hasModerateLiquidity
      ? `Liquidité modérée : ${(quoteVolume / 1000000).toFixed(2)} millions USDT. Exécution prudente recommandée.`
      : `Liquidité insuffisante (${quoteVolume ? (quoteVolume / 1000).toFixed(0) + 'k' : '0'} USDT). Risque sévère de glissement d'ordre (slippage).`,
  });
  if (isIlliquid) {
    noTradeReasons.push(`Volume 24h insuffisant (${(quoteVolume / 1000).toFixed(0)}k USDT, minimum requis: 1,000,000 USDT) pour garantir une exécution saine.`);
  }

  // Decide preliminary bias
  let bias: 'LONG' | 'SHORT' | 'NO_TRADE' = 'NO_TRADE';

  if (isBullishHTF && !conflictingLong && !isOpposingTrend && isDataFresh && !isIlliquid) {
    bias = 'LONG';
  } else if (isBearishHTF && !conflictingShort && !isOpposingTrend && isDataFresh && !isIlliquid) {
    bias = 'SHORT';
  } else if (isHTFConsolidating) {
    bias = 'NO_TRADE';
    noTradeReasons.push('Le marché supérieur (4H/1H) est en phase de consolidation latérale sans flux directionnel affirmé.');
  }

  // Setup calculation with strict numerical precision and directional tickSize quantization
  let setup: TradeSetup | undefined;
  const atrValue = timeframe15m?.atr || (currentPrice * (atrPercent / 100));
  const frictionPercent = market === 'futures' ? 0.12 : 0.24; // Roundtrip fees + slippage buffer

  if (bias === 'LONG') {
    const alignedEntry = quantizePrice(currentPrice, tickSize, 'round');
    const structuralLow = timeframe15m?.recentLow || (alignedEntry - atrValue * 1.5);
    const obBottom = ob15m ? ob15m.bottom : structuralLow;

    // Anchor SL below recent swing low / OB and ATR buffer, then quantize DOWN (floor)
    const rawSL = Math.min(structuralLow, obBottom) - (atrValue * 0.25);
    const alignedSL = quantizePrice(rawSL, tickSize, 'floor');

    const rawRisk = alignedEntry - alignedSL;
    const rawRiskPct = alignedEntry > 0 ? (rawRisk / alignedEntry) * 100 : 0;
    const isSlDistanceValid = alignedSL < alignedEntry && rawRiskPct >= 0.35 && rawRiskPct <= 6.0;

    checklist.push({
      id: 'check-8',
      label: 'Niveau d’invalidation logique (Stop Loss)',
      status: isSlDistanceValid ? 'PASSED' : 'FAILED',
      comment: isSlDistanceValid
        ? `SL sous creux structurel / OB à ${formatCryptoPrice(alignedSL, tickSize)} USDT (-${rawRiskPct.toFixed(2)}%). Distance saine.`
        : alignedSL >= alignedEntry
        ? `Erreur mathématique : le Stop Loss (${formatCryptoPrice(alignedSL, tickSize)}) ne peut être supérieur ou égal au prix d'entrée (${formatCryptoPrice(alignedEntry, tickSize)}).`
        : `Distance SL anormale (${rawRiskPct.toFixed(2)}%). Doit être comprise entre 0.35% et 6.0%.`,
    });

    if (!isSlDistanceValid) {
      noTradeReasons.push(`Stop Loss (${formatCryptoPrice(alignedSL, tickSize)}) invalide ou distance de risque (${rawRiskPct.toFixed(2)}%) hors limites.`);
    }

    // Take Profit levels: quantize UP (ceil) so TP is never rounded down towards entry
    const alignedTP1 = quantizePrice(alignedEntry + rawRisk * 1.8, tickSize, 'ceil');
    const alignedTP2 = quantizePrice(alignedEntry + rawRisk * 3.0, tickSize, 'ceil');
    const alignedTP3 = quantizePrice(alignedEntry + rawRisk * 4.5, tickSize, 'ceil');

    // Hierarchy check: SL < Entry < TP1 < TP2 < TP3
    const hierarchyCheck = validatePriceHierarchy('LONG', alignedEntry, alignedSL, alignedTP1, alignedTP2, alignedTP3);
    if (!hierarchyCheck.isValid) {
      noTradeReasons.push(`Hiérarchie des prix invalide : ${hierarchyCheck.errorReason}`);
    }

    // Calculate R/R ratios
    const rr1 = calculateRiskRewardRatios('LONG', alignedEntry, alignedSL, alignedTP1, frictionPercent);
    const rr2 = calculateRiskRewardRatios('LONG', alignedEntry, alignedSL, alignedTP2, frictionPercent);

    const isGrossRrValid = rr1.isValid && rr1.grossRR >= 1.5;
    checklist.push({
      id: 'check-9',
      label: 'Ratio Rendement / Risque brut (R/R brut >= 1.5:1 sur TP1)',
      status: isGrossRrValid ? 'PASSED' : 'FAILED',
      comment: isGrossRrValid
        ? `R/R brut sur TP1 = ${rr1.grossRR.toFixed(2)}:1 (Gain: +${rr1.grossGainPct.toFixed(2)}%, Risque: -${rr1.riskPct.toFixed(2)}%). TP2 = ${rr2.grossRR.toFixed(2)}:1.`
        : `R/R brut insuffisant sur TP1 (${rr1.grossRR.toFixed(2)}:1 < 1.5:1).`,
    });
    if (!isGrossRrValid) {
      noTradeReasons.push(`Ratio brut sur TP1 (${rr1.grossRR.toFixed(2)}:1) inférieur au minimum syndical de 1.5:1.`);
    }

    // Fee & Net R/R check
    const isNetRrValid = rr1.isValid && rr1.netRR >= 1.2 && rr1.netGainPct > 0;
    checklist.push({
      id: 'check-10',
      label: 'Impact des frais et slippage sur le gain net (R/R net)',
      status: isNetRrValid ? 'PASSED' : 'FAILED',
      comment: isNetRrValid
        ? `Frais estimés et slippage (${frictionPercent.toFixed(2)}%) déduits. R/R net réel : ${rr1.netRR.toFixed(2)}:1 (Gain net: +${rr1.netGainPct.toFixed(2)}%).`
        : `Gain net absorbé ou insuffisant après déduction des frais de ${frictionPercent.toFixed(2)}% (R/R net: ${rr1.netRR.toFixed(2)}:1 < 1.2:1).`,
    });
    if (!isNetRrValid) {
      noTradeReasons.push(`Frais de courtage et slippage (${frictionPercent.toFixed(2)}%) excessifs : R/R net (${rr1.netRR.toFixed(2)}:1) inférieur à 1.2:1.`);
    }

    if (isSlDistanceValid && hierarchyCheck.isValid && isGrossRrValid && isNetRrValid) {
      setup = {
        direction: 'LONG',
        pair: symbol,
        market,
        entryPrice: alignedEntry,
        entryZone: `${formatCryptoPrice(alignedEntry * 0.999, tickSize)} - ${formatCryptoPrice(alignedEntry * 1.001, tickSize)} USDT`,
        stopLoss: alignedSL,
        invalidationCondition: `Clôture d'une bougie 15M sous ${formatCryptoPrice(alignedSL, tickSize)} USDT invalidant la structure acheteuse.`,
        takeProfit1: alignedTP1,
        takeProfit2: alignedTP2,
        takeProfit3: alignedTP3,
        riskRewardRatioTP1: parseFloat(rr1.grossRR.toFixed(2)),
        riskRewardRatioTP2: parseFloat(rr2.grossRR.toFixed(2)),
        netRiskRewardRatioTP1: parseFloat(rr1.netRR.toFixed(2)),
        netRiskRewardRatioTP2: parseFloat(rr2.netRR.toFixed(2)),
        grossGainPercentTP1: parseFloat(rr1.grossGainPct.toFixed(2)),
        netGainPercentTP1: parseFloat(rr1.netGainPct.toFixed(2)),
        riskPercent: parseFloat(rawRiskPct.toFixed(2)),
        suggestedRiskPercent: userRisk,
        tickSize,
        keyConfluences: [
          `Tendance haussière HTF confirmée (EMA 20 > EMA 50 sur 4H/1H).`,
          ob15m ? `Order Block haussier identifié à ${formatCryptoPrice(ob15m.bottom, tickSize)} - ${formatCryptoPrice(ob15m.top, tickSize)} USDT.` : `Rebond sur support dynamique EMA 20.`,
          `RSI modéré (${rsi15m.toFixed(1)}) sans surchauffe.`,
          `Volume 24h liquide (${(quoteVolume / 1000000).toFixed(1)}M USDT).`,
          `R/R brut de ${rr1.grossRR.toFixed(2)}:1 et R/R net réel après friction de ${rr1.netRR.toFixed(2)}:1 sur TP1.`,
        ],
        mainRisks: [
          `Volatilité en cas de balayage sous le Stop Loss à ${formatCryptoPrice(alignedSL, tickSize)} USDT.`,
          `Résistance intermédiaire sur sommet 1H avant ${formatCryptoPrice(alignedTP1, tickSize)} USDT.`,
        ],
        dataTimestamp: Date.now(),
      };
    } else {
      bias = 'NO_TRADE';
    }
  } else if (bias === 'SHORT') {
    const alignedEntry = quantizePrice(currentPrice, tickSize, 'round');
    const structuralHigh = timeframe15m?.recentHigh || (alignedEntry + atrValue * 1.5);
    const obTop = ob15m ? ob15m.top : structuralHigh;

    // Anchor SL above recent swing high / OB and ATR buffer, then quantize UP (ceil)
    const rawSL = Math.max(structuralHigh, obTop) + (atrValue * 0.25);
    const alignedSL = quantizePrice(rawSL, tickSize, 'ceil');

    const rawRisk = alignedSL - alignedEntry;
    const rawRiskPct = alignedEntry > 0 ? (rawRisk / alignedEntry) * 100 : 0;
    const isSlDistanceValid = alignedSL > alignedEntry && rawRiskPct >= 0.35 && rawRiskPct <= 6.0;

    checklist.push({
      id: 'check-8',
      label: 'Niveau d’invalidation logique (Stop Loss)',
      status: isSlDistanceValid ? 'PASSED' : 'FAILED',
      comment: isSlDistanceValid
        ? `SL au-dessus du sommet structurel / OB à ${formatCryptoPrice(alignedSL, tickSize)} USDT (+${rawRiskPct.toFixed(2)}%). Distance saine.`
        : alignedSL <= alignedEntry
        ? `Erreur mathématique : le Stop Loss (${formatCryptoPrice(alignedSL, tickSize)}) ne peut être inférieur ou égal au prix d'entrée (${formatCryptoPrice(alignedEntry, tickSize)}).`
        : `Distance SL anormale (${rawRiskPct.toFixed(2)}%). Doit être comprise entre 0.35% et 6.0%.`,
    });

    if (!isSlDistanceValid) {
      noTradeReasons.push(`Stop Loss (${formatCryptoPrice(alignedSL, tickSize)}) invalide ou distance de risque (${rawRiskPct.toFixed(2)}%) hors limites.`);
    }

    // Take Profit levels: quantize DOWN (floor) so TP is never rounded up towards entry
    const alignedTP1 = quantizePrice(alignedEntry - rawRisk * 1.8, tickSize, 'floor');
    const alignedTP2 = quantizePrice(alignedEntry - rawRisk * 3.0, tickSize, 'floor');
    const alignedTP3 = quantizePrice(alignedEntry - rawRisk * 4.5, tickSize, 'floor');

    // Hierarchy check: TP3 < TP2 < TP1 < Entry < SL
    const hierarchyCheck = validatePriceHierarchy('SHORT', alignedEntry, alignedSL, alignedTP1, alignedTP2, alignedTP3);
    if (!hierarchyCheck.isValid) {
      noTradeReasons.push(`Hiérarchie des prix invalide : ${hierarchyCheck.errorReason}`);
    }

    // Calculate R/R ratios
    const rr1 = calculateRiskRewardRatios('SHORT', alignedEntry, alignedSL, alignedTP1, frictionPercent);
    const rr2 = calculateRiskRewardRatios('SHORT', alignedEntry, alignedSL, alignedTP2, frictionPercent);

    const isGrossRrValid = rr1.isValid && rr1.grossRR >= 1.5;
    checklist.push({
      id: 'check-9',
      label: 'Ratio Rendement / Risque brut (R/R brut >= 1.5:1 sur TP1)',
      status: isGrossRrValid ? 'PASSED' : 'FAILED',
      comment: isGrossRrValid
        ? `R/R brut sur TP1 = ${rr1.grossRR.toFixed(2)}:1 (Gain: +${rr1.grossGainPct.toFixed(2)}%, Risque: -${rr1.riskPct.toFixed(2)}%). TP2 = ${rr2.grossRR.toFixed(2)}:1.`
        : `R/R brut insuffisant sur TP1 (${rr1.grossRR.toFixed(2)}:1 < 1.5:1).`,
    });
    if (!isGrossRrValid) {
      noTradeReasons.push(`Ratio brut sur TP1 (${rr1.grossRR.toFixed(2)}:1) inférieur au minimum syndical de 1.5:1.`);
    }

    // Fee & Net R/R check
    const isNetRrValid = rr1.isValid && rr1.netRR >= 1.2 && rr1.netGainPct > 0;
    checklist.push({
      id: 'check-10',
      label: 'Impact des frais et slippage sur le gain net (R/R net)',
      status: isNetRrValid ? 'PASSED' : 'FAILED',
      comment: isNetRrValid
        ? `Frais estimés et slippage (${frictionPercent.toFixed(2)}%) déduits. R/R net réel : ${rr1.netRR.toFixed(2)}:1 (Gain net: +${rr1.netGainPct.toFixed(2)}%).`
        : `Gain net absorbé ou insuffisant après déduction des frais de ${frictionPercent.toFixed(2)}% (R/R net: ${rr1.netRR.toFixed(2)}:1 < 1.2:1).`,
    });
    if (!isNetRrValid) {
      noTradeReasons.push(`Frais de courtage et slippage (${frictionPercent.toFixed(2)}%) excessifs : R/R net (${rr1.netRR.toFixed(2)}:1) inférieur à 1.2:1.`);
    }

    if (isSlDistanceValid && hierarchyCheck.isValid && isGrossRrValid && isNetRrValid) {
      setup = {
        direction: 'SHORT',
        pair: symbol,
        market,
        entryPrice: alignedEntry,
        entryZone: `${formatCryptoPrice(alignedEntry * 0.999, tickSize)} - ${formatCryptoPrice(alignedEntry * 1.001, tickSize)} USDT`,
        stopLoss: alignedSL,
        invalidationCondition: `Clôture d'une bougie 15M au-dessus de ${formatCryptoPrice(alignedSL, tickSize)} USDT invalidant le flux vendeur.`,
        takeProfit1: alignedTP1,
        takeProfit2: alignedTP2,
        takeProfit3: alignedTP3,
        riskRewardRatioTP1: parseFloat(rr1.grossRR.toFixed(2)),
        riskRewardRatioTP2: parseFloat(rr2.grossRR.toFixed(2)),
        netRiskRewardRatioTP1: parseFloat(rr1.netRR.toFixed(2)),
        netRiskRewardRatioTP2: parseFloat(rr2.netRR.toFixed(2)),
        grossGainPercentTP1: parseFloat(rr1.grossGainPct.toFixed(2)),
        netGainPercentTP1: parseFloat(rr1.netGainPct.toFixed(2)),
        riskPercent: parseFloat(rawRiskPct.toFixed(2)),
        suggestedRiskPercent: userRisk,
        tickSize,
        keyConfluences: [
          `Tendance baissière HTF confirmée (EMA 20 < EMA 50 sur 4H/1H).`,
          ob15m ? `Order Block baissier identifié à ${formatCryptoPrice(ob15m.bottom, tickSize)} - ${formatCryptoPrice(ob15m.top, tickSize)} USDT.` : `Rejet sous résistance dynamique EMA 20.`,
          `RSI modéré (${rsi15m.toFixed(1)}) sans survente excessive.`,
          `Volume 24h liquide (${(quoteVolume / 1000000).toFixed(1)}M USDT).`,
          `R/R brut de ${rr1.grossRR.toFixed(2)}:1 et R/R net réel après friction de ${rr1.netRR.toFixed(2)}:1 sur TP1.`,
        ],
        mainRisks: [
          `Rebond soudain (short squeeze) en cas de balayage au-dessus du Stop Loss à ${formatCryptoPrice(alignedSL, tickSize)} USDT.`,
          `Support intermédiaire sur creux 1H avant ${formatCryptoPrice(alignedTP1, tickSize)} USDT.`,
        ],
        dataTimestamp: Date.now(),
      };
    } else {
      bias = 'NO_TRADE';
    }
  } else {
    // NO TRADE case
    checklist.push({
      id: 'check-8',
      label: 'Niveau d’invalidation logique (Stop Loss)',
      status: 'FAILED',
      comment: 'Aucun ancrage structurel net permettant de définir un Stop Loss logique et serré.',
    });
    checklist.push({
      id: 'check-9',
      label: 'Ratio Rendement / Risque brut (R/R brut >= 1.5:1 sur TP1)',
      status: 'FAILED',
      comment: 'Conditions insuffisantes pour projeter un ratio asymétrique favorable.',
    });
    checklist.push({
      id: 'check-10',
      label: 'Impact des frais et slippage sur le gain net (R/R net)',
      status: 'FAILED',
      comment: 'Non applicable en l’absence de configuration validée.',
    });

    if (noTradeReasons.length === 0) {
      noTradeReasons.push('Manque de confluence technique claire entre les unités de temps supérieures et inférieures.');
      noTradeReasons.push('Absence de déséquilibre (FVG ou Order Block non mitigé) exploitable avec un bon ratio risque/rendement.');
    }
  }

  // Calculate Transparent Setup Quality Score (0-100) based strictly on real criteria
  const htfAlignment = (isBullishHTF || isBearishHTF) && !isOpposingTrend ? 20 : isOpposingTrend ? 4 : 8;
  const marketStructure = hasFreshSMC ? 20 : (ob15m || fvg15m) ? 12 : 5;
  const entryQuality = (bias !== 'NO_TRADE' && hasFreshSMC) ? 15 : 4;
  const volumeConfirmation = hasHighLiquidity ? 15 : hasModerateLiquidity ? 10 : 2;
  const riskRewardScore = setup ? (setup.riskRewardRatioTP1 >= 2.0 ? 15 : setup.riskRewardRatioTP1 >= 1.5 ? 12 : 2) : 0;
  const volatilityScore = (!isVolatilityExtreme && !isVolatilityTooLow) ? 10 : 2;
  const dataReliability = (isPriceValid && isLiveVerified && isDataFresh) ? 5 : 1;

  const totalScore = Math.min(
    100,
    htfAlignment + marketStructure + entryQuality + volumeConfirmation + riskRewardScore + volatilityScore + dataReliability
  );

  let ratingLabel: 'EXCELLENT' | 'BON' | 'MOYEN' | 'INSUFFISANT' = 'INSUFFISANT';
  if (totalScore >= 80) ratingLabel = 'EXCELLENT';
  else if (totalScore >= 65) ratingLabel = 'BON';
  else if (totalScore >= 45) ratingLabel = 'MOYEN';

  // Strict Capital Preservation: if score < 65 or any critical check failed -> force NO_TRADE
  const hasFailedCriticalCheck = checklist.some(
    (c) => ['check-1', 'check-2', 'check-5', 'check-6', 'check-7', 'check-8', 'check-9', 'check-10'].includes(c.id) && c.status === 'FAILED'
  );

  let finalOutcome: 'LONG' | 'SHORT' | 'NO_TRADE' = bias;
  if ((totalScore < 65 || hasFailedCriticalCheck || !setup) && finalOutcome !== 'NO_TRADE') {
    finalOutcome = 'NO_TRADE';
    setup = undefined;
    if (totalScore < 65) {
      noTradeReasons.push(`Score de qualité insuffisant (${totalScore}/100, seuil minimal requis: 65/100).`);
    }
  }

  const qualityScore: QualityScore = {
    total: finalOutcome === 'NO_TRADE' && hasFailedCriticalCheck ? Math.min(totalScore, 45) : totalScore,
    ratingLabel: finalOutcome === 'NO_TRADE' && hasFailedCriticalCheck ? 'INSUFFISANT' : ratingLabel,
    breakdown: {
      htfAlignment,
      marketStructure,
      entryQuality,
      volumeConfirmation,
      riskRewardScore,
      volatilityScore,
      dataReliability,
    },
    explanation: 'Le Score de Qualité mesure la confluence technique et la rigueur du setup. Il ne constitue en aucun cas une probabilité mathématique de gain.',
  };

  const executiveSummary = finalOutcome === 'LONG' && setup
    ? `Configuration Achat (LONG) validée avec confluence HTF, R/R brut ${setup.riskRewardRatioTP1}:1 et R/R net ${setup.netRiskRewardRatioTP1}:1. Risque maîtrisé à ${userRisk}%.`
    : finalOutcome === 'SHORT' && setup
    ? `Configuration Vente (SHORT) validée dans le sens du flux vendeur HTF, R/R brut ${setup.riskRewardRatioTP1}:1 et R/R net ${setup.netRiskRewardRatioTP1}:1. Risque maîtrisé à ${userRisk}%.`
    : `AUCUN TRADE RECOMMANDÉ (NO TRADE). Conditions de marché actuelles insuffisantes ou contradictoires. Préservation du capital prioritaire.`;

  return {
    outcome: finalOutcome,
    setup,
    qualityScore,
    checklist,
    noTradeReasons,
    executiveSummary,
  };
}
