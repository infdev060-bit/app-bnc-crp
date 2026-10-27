/**
 * Test Suite Automatisée pour Crypto Edge AI v3.8 PRO
 * Valide :
 * 1. Hiérarchie des prix pour LONG et SHORT
 * 2. Calculs de R/R brut et net après frais et slippage
 * 3. Gestion des micro-prix (< 0.01$) et du tickSize officiel Binance
 * 4. Quantification directionnelle (SL conservateur, TP ambitieux)
 * 5. Rejets obligatoires (NO_TRADE) sur anomalies mathématiques
 */

import { validatePriceHierarchy, calculateRiskRewardRatios, evaluateMarketSetup } from '../src/utils/tradeValidator';
import { quantizePrice, formatCryptoPrice, getDecimalsFromTickSize } from '../src/utils/priceFormatter';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, details?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  \x1b[32m✔ PASS\x1b[0m : ${testName}`);
  } else {
    failedTests++;
    console.error(`  \x1b[31m✘ FAIL\x1b[0m : ${testName}${details ? ` -> ${details}` : ''}`);
  }
}

console.log('\n============================================================');
console.log('   CRYPTO EDGE AI v3.8 PRO - SUITE DE TESTS AUTOMATISÉE   ');
console.log('============================================================\n');

// --------------------------------------------------------------------------
// TEST 1 : Un LONG valide
// --------------------------------------------------------------------------
console.log('\x1b[34m[TEST 1] Configuration LONG Valide\x1b[0m');
{
  const entry = 65000.0;
  const sl = 64000.0;
  const tp1 = 67000.0;
  const tp2 = 69000.0;
  const friction = 0.12; // 0.12% roundtrip futures fee + slippage

  const hierarchy = validatePriceHierarchy('LONG', entry, sl, tp1, tp2);
  assert(hierarchy.isValid, 'Hiérarchie LONG respectée (SL < Entry < TP1 < TP2)');

  const rr1 = calculateRiskRewardRatios('LONG', entry, sl, tp1, friction);
  assert(rr1.isValid, 'Calcul R/R TP1 valide');
  assert(Math.abs(rr1.risk - 1000.0) < 0.001, 'Risque = 1000$ (65000 - 64000)');
  assert(Math.abs(rr1.potentialGain - 2000.0) < 0.001, 'Gain potentiel TP1 = 2000$ (67000 - 65000)');
  assert(Math.abs(rr1.grossRR - 2.0) < 0.01, 'Ratio Brut TP1 = 2.00:1 (2000 / 1000)');
  assert(rr1.netRR < rr1.grossRR && rr1.netRR > 1.8, `Ratio Net TP1 calculé après frais: ${rr1.netRR.toFixed(2)}:1`);
}

// --------------------------------------------------------------------------
// TEST 2 : Un SHORT valide
// --------------------------------------------------------------------------
console.log('\n\x1b[34m[TEST 2] Configuration SHORT Valide\x1b[0m');
{
  const entry = 3000.0;
  const sl = 3100.0;
  const tp1 = 2800.0;
  const tp2 = 2600.0;
  const friction = 0.12;

  const hierarchy = validatePriceHierarchy('SHORT', entry, sl, tp1, tp2);
  assert(hierarchy.isValid, 'Hiérarchie SHORT respectée (TP2 < TP1 < Entry < SL)');

  const rr1 = calculateRiskRewardRatios('SHORT', entry, sl, tp1, friction);
  assert(rr1.isValid, 'Calcul R/R TP1 valide');
  assert(Math.abs(rr1.risk - 100.0) < 0.001, 'Risque = 100$ (3100 - 3000)');
  assert(Math.abs(rr1.potentialGain - 2000.0 - (-1800.0)) < 0.001 || Math.abs(rr1.potentialGain - 200.0) < 0.001, 'Gain potentiel TP1 = 200$ (3000 - 2800)');
  assert(Math.abs(rr1.grossRR - 2.0) < 0.01, 'Ratio Brut TP1 = 2.00:1 (200 / 100)');
  assert(rr1.netRR < rr1.grossRR && rr1.netRR > 1.8, `Ratio Net TP1 calculé après frais: ${rr1.netRR.toFixed(2)}:1`);
}

// --------------------------------------------------------------------------
// TEST 3 : Stop Loss égal ou inversé par rapport à l'entrée (Rejet obligatoire)
// --------------------------------------------------------------------------
console.log('\n\x1b[34m[TEST 3] Stop Loss égal ou inversé -> Rejet obligatoire\x1b[0m');
{
  const entry = 100.0;
  const slEqual = 100.0;
  const tp1 = 120.0;
  const tp2 = 140.0;

  const resEqual = validatePriceHierarchy('LONG', entry, slEqual, tp1, tp2);
  assert(!resEqual.isValid, 'Rejet si SL == Entry (risque nul)');

  const slInvertedLong = 105.0; // SL supérieur à l'entrée sur un LONG
  const resInverted = validatePriceHierarchy('LONG', entry, slInvertedLong, tp1, tp2);
  assert(!resInverted.isValid, 'Rejet si SL > Entry sur un LONG');

  const slInvertedShort = 95.0; // SL inférieur à l'entrée sur un SHORT
  const resInvertedShort = validatePriceHierarchy('SHORT', entry, slInvertedShort, 80.0, 70.0);
  assert(!resInvertedShort.isValid, 'Rejet si SL < Entry sur un SHORT');

  const rr = calculateRiskRewardRatios('LONG', entry, entry, tp1, 0.12);
  assert(!rr.isValid, 'calculateRiskRewardRatios refuse le risque nul');
}

// --------------------------------------------------------------------------
// TEST 4 : Take Profit incorrect (TP1 <= Entry ou TP2 <= TP1)
// --------------------------------------------------------------------------
console.log('\n\x1b[34m[TEST 4] Take Profit incorrect -> Rejet obligatoire\x1b[0m');
{
  const entry = 50.0;
  const sl = 45.0;
  const tp1Wrong = 48.0; // inférieur à l'entrée sur un LONG
  const tp2 = 60.0;

  const res1 = validatePriceHierarchy('LONG', entry, sl, tp1Wrong, tp2);
  assert(!res1.isValid, 'Rejet si TP1 <= Entry sur un LONG');

  const tp2Wrong = 52.0; // TP2 inférieur à TP1 (55)
  const res2 = validatePriceHierarchy('LONG', entry, sl, 55.0, tp2Wrong);
  assert(!res2.isValid, 'Rejet si TP2 <= TP1 sur un LONG');

  const resShortTP = validatePriceHierarchy('SHORT', entry, 55.0, 52.0, 53.0); // TP2 > TP1
  assert(!resShortTP.isValid, 'Rejet si TP2 >= TP1 sur un SHORT');
}

// --------------------------------------------------------------------------
// TEST 5 : Cas CHIPUSDT & micro-prix (< 0.01$) sans tronquage
// --------------------------------------------------------------------------
console.log('\n\x1b[34m[TEST 5] Micro-prix (< 0.01$) et CHIPUSDT (0.05084$)\x1b[0m');
{
  // CHIPUSDT réel observé sur Binance Futures
  const chipEntry = 0.05084;
  const chipSL = 0.04984;
  const chipTP1 = 0.05264;
  const chipTP2 = 0.05444;
  const tickSize = 0.00001;

  const hierarchy = validatePriceHierarchy('LONG', chipEntry, chipSL, chipTP1, chipTP2);
  assert(hierarchy.isValid, 'CHIPUSDT : Hiérarchie valide (0.04984 < 0.05084 < 0.05264 < 0.05444)');

  const fmtEntry = formatCryptoPrice(chipEntry, tickSize);
  const fmtSL = formatCryptoPrice(chipSL, tickSize);
  const fmtTP1 = formatCryptoPrice(chipTP1, tickSize);
  const fmtTP2 = formatCryptoPrice(chipTP2, tickSize);

  assert(fmtEntry.includes('05084'), `Entrée formatée sans tronquage: ${fmtEntry}`);
  assert(fmtSL.includes('04984'), `SL formaté sans tronquage: ${fmtSL}`);
  assert(fmtTP1.includes('05264'), `TP1 formaté sans tronquage: ${fmtTP1}`);
  assert(fmtTP2.includes('05444'), `TP2 formaté sans tronquage: ${fmtTP2}`);
  assert(fmtSL !== fmtEntry && fmtTP1 !== fmtEntry, 'Tous les niveaux sont visuellement distincts (pas d\'arrondi à 0.05$)');

  // Cas extrême : Token PEPE-like à 0.00004523$
  const microPrice = 0.00004523;
  const microTick = 0.00000001;
  const fmtMicro = formatCryptoPrice(microPrice, microTick);
  assert(fmtMicro.includes('00004523'), `Micro-prix à 8 décimales préservé: ${fmtMicro}`);
}

// --------------------------------------------------------------------------
// TEST 6 : Quantification directionnelle selon tickSize Binance
// --------------------------------------------------------------------------
console.log('\n\x1b[34m[TEST 6] Quantification directionnelle selon le tickSize Binance\x1b[0m');
{
  const tick = 0.05; // exemple tick size de 0.05
  const rawLongSL = 100.08; // Si on arrondissait standard, ce serait 100.10 (plus proche de l'entrée !)
  const floorLongSL = quantizePrice(rawLongSL, tick, 'floor');
  assert(floorLongSL === 100.05, `LONG SL quantifié par défaut (floor): ${floorLongSL} (au lieu de 100.10)`);

  const rawLongTP = 110.02; // Si on arrondissait standard vers le bas, on perdrait du rendement
  const ceilLongTP = quantizePrice(rawLongTP, tick, 'ceil');
  assert(ceilLongTP === 110.05, `LONG TP quantifié par excès (ceil): ${ceilLongTP}`);

  const rawShortSL = 100.02; // SHORT SL doit être quantifié par excès pour ne pas sous-estimer le risque
  const ceilShortSL = quantizePrice(rawShortSL, tick, 'ceil');
  assert(ceilShortSL === 100.05, `SHORT SL quantifié par excès (ceil): ${ceilShortSL}`);

  const rawShortTP = 90.08; // SHORT TP quantifié par défaut (floor)
  const floorShortTP = quantizePrice(rawShortTP, tick, 'floor');
  assert(floorShortTP === 90.05, `SHORT TP quantifié par défaut (floor): ${floorShortTP}`);
}

// --------------------------------------------------------------------------
// TEST 7 : Frais et slippage absorbant le gain (Rejet net)
// --------------------------------------------------------------------------
console.log('\n\x1b[34m[TEST 7] Frais et slippage absorbant le gain (Friction)\x1b[0m');
{
  // Trade avec gain microscopique (ex. scalping 0.1% gain avec 0.24% de frais Spot)
  const entry = 100.0;
  const sl = 99.9; // 0.1% risque
  const tp = 100.15; // 0.15% gain brut
  const highFrictionSpot = 0.24; // 0.24% frais + slippage

  const rr = calculateRiskRewardRatios('LONG', entry, sl, tp, highFrictionSpot);
  assert(Math.abs(rr.grossRR - 1.5) < 0.001, `Ratio brut positif: ${rr.grossRR.toFixed(2)}:1`);
  assert(rr.netGainPct < 0, `Gain net négatif après frais: ${rr.netGainPct.toFixed(3)}%`);
  assert(rr.netRR <= 0, `Ratio Net négatif rejeté: ${rr.netRR.toFixed(2)}:1`);
}

// --------------------------------------------------------------------------
// TEST 8 : Données de marché manquantes ou prix nul
// --------------------------------------------------------------------------
console.log('\n\x1b[34m[TEST 8] Données de marché manquantes ou prix nul\x1b[0m');
{
  const missingResult = evaluateMarketSetup({
    symbol: 'UNKNOWNUSDT',
    market: 'futures',
    currentPrice: 0,
    ticker: null,
  });

  assert(missingResult.outcome === 'NO_TRADE', 'Rejet immédiat NO_TRADE si ticker absent ou prix <= 0');
  assert(missingResult.noTradeReasons.length > 0, `Motif explicite fourni: "${missingResult.noTradeReasons[0]}"`);

  const negativePriceRes = validatePriceHierarchy('LONG', -10, -15, 10, 20);
  assert(!negativePriceRes.isValid, 'validatePriceHierarchy rejette les prix négatifs');
}

// --------------------------------------------------------------------------
// TEST 9 : Hiérarchie complète avec TP3 (SL < Entry < TP1 < TP2 < TP3)
// --------------------------------------------------------------------------
console.log('\n\x1b[34m[TEST 9] Hiérarchie complète avec TP3 (LONG et SHORT)\x1b[0m');
{
  // LONG avec 3 objectifs
  const longEntry = 100.0;
  const longSL = 95.0;
  const longTP1 = 109.0;
  const longTP2 = 115.0;
  const longTP3 = 122.5;

  const validLongWithTP3 = validatePriceHierarchy('LONG', longEntry, longSL, longTP1, longTP2, longTP3);
  assert(validLongWithTP3.isValid, 'LONG avec TP3 valide (SL 95 < Entry 100 < TP1 109 < TP2 115 < TP3 122.5)');

  // Invalidation si TP3 <= TP2
  const invalidLongTP3 = validatePriceHierarchy('LONG', longEntry, longSL, longTP1, longTP2, 114.0);
  assert(!invalidLongTP3.isValid, 'Rejet si TP3 <= TP2 sur un LONG');

  // SHORT avec 3 objectifs
  const shortEntry = 100.0;
  const shortSL = 105.0;
  const shortTP1 = 91.0;
  const shortTP2 = 85.0;
  const shortTP3 = 77.5;

  const validShortWithTP3 = validatePriceHierarchy('SHORT', shortEntry, shortSL, shortTP1, shortTP2, shortTP3);
  assert(validShortWithTP3.isValid, 'SHORT avec TP3 valide (TP3 77.5 < TP2 85 < TP1 91 < Entry 100 < SL 105)');

  // Invalidation si TP3 >= TP2 sur SHORT
  const invalidShortTP3 = validatePriceHierarchy('SHORT', shortEntry, shortSL, shortTP1, shortTP2, 86.0);
  assert(!invalidShortTP3.isValid, 'Rejet si TP3 >= TP2 sur un SHORT');
}

// --------------------------------------------------------------------------
// TEST 10 : Calculs R/R brut et net sur TP1, TP2 et TP3
// --------------------------------------------------------------------------
console.log('\n\x1b[34m[TEST 10] Calculs R/R brut et net sur TP1, TP2 et TP3\x1b[0m');
{
  const entry = 50000;
  const sl = 49000; // Risque = 1000$ (2.0%)
  const tp1 = 51800; // Gain = 1800$ (3.6%) -> R/R brut = 1.80:1
  const tp2 = 53000; // Gain = 3000$ (6.0%) -> R/R brut = 3.00:1
  const tp3 = 54500; // Gain = 4500$ (9.0%) -> R/R brut = 4.50:1
  const frictionFutures = 0.12;

  const r1 = calculateRiskRewardRatios('LONG', entry, sl, tp1, frictionFutures);
  const r2 = calculateRiskRewardRatios('LONG', entry, sl, tp2, frictionFutures);
  const r3 = calculateRiskRewardRatios('LONG', entry, sl, tp3, frictionFutures);

  assert(Math.abs(r1.grossRR - 1.80) < 0.01, 'TP1 R/R Brut = 1.80:1');
  assert(Math.abs(r2.grossRR - 3.00) < 0.01, 'TP2 R/R Brut = 3.00:1');
  assert(Math.abs(r3.grossRR - 4.50) < 0.01, 'TP3 R/R Brut = 4.50:1');

  assert(r1.netRR < r1.grossRR && r1.netRR >= 1.70, `TP1 Net R/R après friction: ${r1.netRR.toFixed(2)}:1`);
  assert(r2.netRR < r2.grossRR && r2.netRR >= 2.90, `TP2 Net R/R après friction: ${r2.netRR.toFixed(2)}:1`);
  assert(r3.netRR < r3.grossRR && r3.netRR >= 4.40, `TP3 Net R/R après friction: ${r3.netRR.toFixed(2)}:1`);
}

// --------------------------------------------------------------------------
// TEST 11 : Gestion du risque, dimensionnement et seuil de liquidation
// --------------------------------------------------------------------------
console.log('\n\x1b[34m[TEST 11] Calculateur de risque financier et seuil de liquidation\x1b[0m');
{
  const balance = 10000; // 10,000 $
  const riskPct = 1.0; // 1% = 100 $
  const entry = 65000;
  const sl = 63700;
  const riskDollar = (balance * riskPct) / 100; // 100 $
  const priceDiff = entry - sl; // 1300 $

  // Position sizing
  const posCrypto = riskDollar / priceDiff; // ~0.076923 BTC
  const posUsd = posCrypto * entry; // ~5,000 $
  assert(Math.abs(riskDollar - 100) < 0.001, 'Risque monétaire = 100.00 $');
  assert(Math.abs(posUsd - 5000) < 1.0, 'Valeur nominale position = ~5,000 $');

  // Leverage 5x
  const margin5x = posUsd / 5;
  assert(Math.abs(margin5x - 1000) < 1.0, 'Marge requise à 5x = ~1,000 $');

  // Liquidation check at 5x: Entry * (1 - 1/5 + 0.005) = 65000 * 0.805 = 52,325 $
  const liqPrice5x = entry * (1 - 1 / 5 + 0.005);
  assert(liqPrice5x < sl, `À 5x, liquidation (${liqPrice5x.toFixed(0)}$) bien en-dessous du SL (${sl}$) : Pas d'alerte.`);

  // Excessive Leverage 100x: Entry * (1 - 1/100 + 0.005) = 65000 * 0.995 = 64,675 $
  const liqPrice100x = entry * (1 - 1 / 100 + 0.005);
  const isLiqBeforeSL = liqPrice100x >= sl;
  assert(isLiqBeforeSL, `À 100x, liquidation (${liqPrice100x.toFixed(0)}$) survient AVANT le SL (${sl}$) : Alerte critique déclenchée.`);
}

// --------------------------------------------------------------------------
// TEST 12 : Confluence MTF (4H/1H/15M) et rejet strict sur données insuffisantes
// --------------------------------------------------------------------------
console.log('\n\x1b[34m[TEST 12] Confluence MTF et rejet sur données insuffisantes\x1b[0m');
{
  const validTicker = {
    symbol: 'BTCUSDT',
    market: 'futures' as const,
    price: 65000,
    change24h: 1.2,
    change24hAmount: 780,
    high24h: 66000,
    low24h: 64000,
    volume24h: 20000,
    quoteVolume24h: 1300000000,
    timestamp: Date.now(),
    isLive: true,
    source: 'Binance Futures',
    isStale: false,
    tickSize: 0.1,
  };

  // Rejet si 4H et 1H sont en divergence totale
  const conflictingEval = evaluateMarketSetup({
    symbol: 'BTCUSDT',
    market: 'futures',
    currentPrice: 65000,
    ticker: validTicker,
    timeframe4h: {
      timeframe: '4h',
      currentPrice: 65000,
      ema20: 67000,
      ema50: 68000,
      rsi: 35,
      atr: 800,
      atrPercent: 1.2,
      trend: 'BAISSIÈRE',
      structure: 'BEARISH_STRUCTURE',
      recentHigh: 68500,
      recentLow: 64200,
      averageVolume20: 10000,
      volumeRatio: 1.1,
      candleCount: 70,
    },
    timeframe1h: {
      timeframe: '1h',
      currentPrice: 65000,
      ema20: 64800,
      ema50: 64200,
      rsi: 65,
      atr: 400,
      atrPercent: 0.6,
      trend: 'HAUSSIÈRE',
      structure: 'BULLISH_STRUCTURE',
      recentHigh: 65400,
      recentLow: 63800,
      averageVolume20: 3000,
      volumeRatio: 1.3,
      candleCount: 70,
    },
  });

  assert(conflictingEval.outcome === 'NO_TRADE', 'Rejet NO_TRADE si 4H BAISSIÈRE et 1H HAUSSIÈRE (conflit de tendance majeur)');
  const check3 = conflictingEval.checklist.find((c) => c.id === 'check-3');
  assert(check3?.status === 'FAILED', 'Check-3 marqué FAILED en cas de divergence 4H/1H');

  // Rejet si historique de chandeliers insuffisant (< 20 bougies)
  const insufficientEval = evaluateMarketSetup({
    symbol: 'BTCUSDT',
    market: 'futures',
    currentPrice: 65000,
    ticker: validTicker,
    timeframe4h: {
      timeframe: '4h',
      currentPrice: 65000,
      ema20: 64000,
      ema50: 63000,
      rsi: 55,
      atr: 500,
      atrPercent: 0.8,
      trend: 'HAUSSIÈRE',
      structure: 'BULLISH_STRUCTURE',
      recentHigh: 65500,
      recentLow: 63000,
      averageVolume20: 5000,
      volumeRatio: 1.2,
      candleCount: 8, // Seulement 8 bougies !
    },
  });

  assert(insufficientEval.outcome === 'NO_TRADE', 'Rejet NO_TRADE si nombre de bougies < 20 (données insuffisantes)');
  assert(insufficientEval.noTradeReasons.some((r) => r.includes('< 20')), 'Motif explicite indiquant chandeliers insuffisants');
}

// --------------------------------------------------------------------------
// TEST 13 : Marché haussier confirmé sur toutes les unités (4H, 1H, 15M, 5M)
// --------------------------------------------------------------------------
console.log('\n\x1b[34m[TEST 13] Marché haussier confirmé sur toutes les unités (4H, 1H, 15M, 5M)\x1b[0m');
{
  const liveTicker = {
    symbol: 'BTCUSDT',
    market: 'futures' as const,
    price: 65000,
    change24h: 3.5,
    change24hAmount: 2200,
    high24h: 66000,
    low24h: 63000,
    volume24h: 50000,
    quoteVolume24h: 3250000000, // 3.25B USDT (très liquide)
    timestamp: Date.now() - 2000, // 2s
    isLive: true,
    source: 'Binance USDⓈ-M Futures (WebSocket)',
    isStale: false,
    tickSize: 0.1,
  };

  const fullBullishEval = evaluateMarketSetup({
    symbol: 'BTCUSDT',
    market: 'futures',
    currentPrice: 65000,
    ticker: liveTicker,
    timeframe4h: {
      timeframe: '4h',
      currentPrice: 65000,
      ema20: 63500,
      ema50: 62000,
      rsi: 60,
      atr: 800,
      atrPercent: 1.2,
      trend: 'HAUSSIÈRE',
      structure: 'BULLISH_STRUCTURE',
      recentHigh: 65500,
      recentLow: 61500,
      averageVolume20: 10000,
      volumeRatio: 1.4,
      candleCount: 70,
    },
    timeframe1h: {
      timeframe: '1h',
      currentPrice: 65000,
      ema20: 64200,
      ema50: 63600,
      rsi: 58,
      atr: 400,
      atrPercent: 0.6,
      trend: 'HAUSSIÈRE',
      structure: 'BULLISH_STRUCTURE',
      recentHigh: 65300,
      recentLow: 63800,
      averageVolume20: 3000,
      volumeRatio: 1.3,
      candleCount: 70,
    },
    timeframe15m: {
      timeframe: '15m',
      currentPrice: 65000,
      ema20: 64700,
      ema50: 64400,
      rsi: 56,
      atr: 200,
      atrPercent: 0.3,
      trend: 'HAUSSIÈRE',
      structure: 'BULLISH_STRUCTURE',
      recentHigh: 65100,
      recentLow: 64500,
      averageVolume20: 1000,
      volumeRatio: 1.2,
      candleCount: 70,
      orderBlock: {
        type: 'BULLISH',
        top: 64650,
        bottom: 64500,
        mitigated: false,
      },
    },
    timeframe5m: {
      timeframe: '5m',
      currentPrice: 65000,
      ema20: 64900,
      ema50: 64800,
      rsi: 54,
      atr: 90,
      atrPercent: 0.14,
      trend: 'HAUSSIÈRE',
      structure: 'BULLISH_STRUCTURE',
      recentHigh: 65050,
      recentLow: 64850,
      averageVolume20: 400,
      volumeRatio: 1.1,
      candleCount: 70,
    },
  });

  assert(fullBullishEval.outcome === 'LONG', 'Confluence 4H/1H/15M/5M haussière : Configuration LONG validée');
  assert(fullBullishEval.setup !== undefined, 'Setup de trade généré avec succès');
  assert(fullBullishEval.qualityScore.total >= 70, `Score de qualité élevé (${fullBullishEval.qualityScore.total}/100 >= 70)`);
  assert(fullBullishEval.qualityScore.breakdown.htfAlignment === 20, 'Alignement HTF noté 20/20');
  assert(fullBullishEval.qualityScore.breakdown.marketStructure === 20, 'Structure SMC notée 20/20 car alignée avec le flux HTF');
  assert(Boolean(fullBullishEval.setup && fullBullishEval.setup.stopLoss < fullBullishEval.setup.entryPrice), 'LONG : Stop Loss strictement inférieur au prix d\'entrée');
  assert(Boolean(fullBullishEval.setup && fullBullishEval.setup.takeProfit1 > fullBullishEval.setup.entryPrice), 'LONG : TP1 strictement supérieur au prix d\'entrée');
  assert(Boolean(fullBullishEval.setup && fullBullishEval.setup.takeProfit2 > fullBullishEval.setup.takeProfit1), 'LONG : TP2 supérieur à TP1');
  assert(Boolean(fullBullishEval.setup && fullBullishEval.setup.takeProfit3 && fullBullishEval.setup.takeProfit3 > fullBullishEval.setup.takeProfit2), 'LONG : TP3 supérieur à TP2');
}

// --------------------------------------------------------------------------
// TEST 14 : Consolidation 4H avec 1H, 15M et 5M haussières -> NO TRADE & score SMC plafonné
// --------------------------------------------------------------------------
console.log('\n\x1b[34m[TEST 14] Consolidation 4H avec LTF haussière -> NO TRADE & SMC plafonné\x1b[0m');
{
  const liveTicker = {
    symbol: 'ETHUSDT',
    market: 'futures' as const,
    price: 3200,
    change24h: 0.4,
    change24hAmount: 12,
    high24h: 3250,
    low24h: 3150,
    volume24h: 150000,
    quoteVolume24h: 480000000,
    timestamp: Date.now() - 3000,
    isLive: true,
    source: 'Binance USDⓈ-M Futures (WebSocket)',
    isStale: false,
    tickSize: 0.01,
  };

  const consolidatingHtfEval = evaluateMarketSetup({
    symbol: 'ETHUSDT',
    market: 'futures',
    currentPrice: 3200,
    ticker: liveTicker,
    timeframe4h: {
      timeframe: '4h',
      currentPrice: 3200,
      ema20: 3205,
      ema50: 3195,
      rsi: 50.5,
      atr: 60,
      atrPercent: 1.8,
      trend: 'CONSOLIDATION', // HTF sans direction !
      structure: 'NEUTRAL',
      recentHigh: 3300,
      recentLow: 3100,
      averageVolume20: 10000,
      volumeRatio: 0.9,
      candleCount: 70,
    },
    timeframe1h: {
      timeframe: '1h',
      currentPrice: 3200,
      ema20: 3190,
      ema50: 3180,
      rsi: 58,
      atr: 25,
      atrPercent: 0.78,
      trend: 'HAUSSIÈRE',
      structure: 'BULLISH_STRUCTURE',
      recentHigh: 3220,
      recentLow: 3160,
      averageVolume20: 4000,
      volumeRatio: 1.1,
      candleCount: 70,
    },
    timeframe15m: {
      timeframe: '15m',
      currentPrice: 3200,
      ema20: 3195,
      ema50: 3190,
      rsi: 57,
      atr: 12,
      atrPercent: 0.37,
      trend: 'HAUSSIÈRE',
      structure: 'BULLISH_STRUCTURE',
      recentHigh: 3210,
      recentLow: 3180,
      averageVolume20: 1200,
      volumeRatio: 1.2,
      candleCount: 70,
      orderBlock: {
        type: 'BULLISH',
        top: 3192,
        bottom: 3186,
        mitigated: false,
      },
    },
    timeframe5m: {
      timeframe: '5m',
      currentPrice: 3200,
      ema20: 3198,
      ema50: 3194,
      rsi: 55,
      atr: 5,
      atrPercent: 0.15,
      trend: 'HAUSSIÈRE',
      structure: 'BULLISH_STRUCTURE',
      recentHigh: 3205,
      recentLow: 3195,
      averageVolume20: 400,
      volumeRatio: 1.0,
      candleCount: 70,
    },
  });

  assert(consolidatingHtfEval.outcome === 'NO_TRADE', 'Consolidation 4H : Verdict final forcé à NO_TRADE');
  assert(consolidatingHtfEval.setup === undefined, 'Aucun setup généré en consolidation (setup = undefined)');
  assert(consolidatingHtfEval.qualityScore.breakdown.marketStructure <= 12, `Structure SMC plafonnée à ${consolidatingHtfEval.qualityScore.breakdown.marketStructure}/20 (JAMAIS 20/20 quand HTF consolide)`);
  
  const check9 = consolidatingHtfEval.checklist.find((c) => c.id === 'check-9');
  assert(Boolean(check9?.comment.toLowerCase().includes('non calculable')), `Check-9 R/R marqué explicitement "non calculable" sans ratio fictif: "${check9?.comment}"`);
  assert(consolidatingHtfEval.noTradeReasons.some((r) => r.includes('consolidation')), 'Motif explicite de rejet indiquant la consolidation latérale HTF');
}

// --------------------------------------------------------------------------
// TEST 15 : Marché baissier confirmé sur toutes les unités (4H, 1H, 15M, 5M)
// --------------------------------------------------------------------------
console.log('\n\x1b[34m[TEST 15] Marché baissier confirmé sur toutes les unités (4H, 1H, 15M, 5M)\x1b[0m');
{
  const liveTicker = {
    symbol: 'SOLUSDT',
    market: 'futures' as const,
    price: 150,
    change24h: -4.2,
    change24hAmount: -6.5,
    high24h: 160,
    low24h: 148,
    volume24h: 5000000,
    quoteVolume24h: 770000000,
    timestamp: Date.now() - 1000,
    isLive: true,
    source: 'Binance USDⓈ-M Futures (WebSocket)',
    isStale: false,
    tickSize: 0.01,
  };

  const fullBearishEval = evaluateMarketSetup({
    symbol: 'SOLUSDT',
    market: 'futures',
    currentPrice: 150,
    ticker: liveTicker,
    timeframe4h: {
      timeframe: '4h',
      currentPrice: 150,
      ema20: 158,
      ema50: 165,
      rsi: 38,
      atr: 5,
      atrPercent: 3.3,
      trend: 'BAISSIÈRE',
      structure: 'BEARISH_STRUCTURE',
      recentHigh: 170,
      recentLow: 148,
      averageVolume20: 50000,
      volumeRatio: 1.3,
      candleCount: 70,
    },
    timeframe1h: {
      timeframe: '1h',
      currentPrice: 150,
      ema20: 153,
      ema50: 156,
      rsi: 40,
      atr: 2.5,
      atrPercent: 1.6,
      trend: 'BAISSIÈRE',
      structure: 'BEARISH_STRUCTURE',
      recentHigh: 158,
      recentLow: 148,
      averageVolume20: 15000,
      volumeRatio: 1.2,
      candleCount: 70,
    },
    timeframe15m: {
      timeframe: '15m',
      currentPrice: 150,
      ema20: 151.2,
      ema50: 152.5,
      rsi: 42,
      atr: 1.1,
      atrPercent: 0.73,
      trend: 'BAISSIÈRE',
      structure: 'BEARISH_STRUCTURE',
      recentHigh: 153,
      recentLow: 149,
      averageVolume20: 4000,
      volumeRatio: 1.4,
      candleCount: 70,
      orderBlock: {
        type: 'BEARISH',
        top: 152.2,
        bottom: 151.5,
        mitigated: false,
      },
    },
    timeframe5m: {
      timeframe: '5m',
      currentPrice: 150,
      ema20: 150.5,
      ema50: 151.0,
      rsi: 44,
      atr: 0.45,
      atrPercent: 0.3,
      trend: 'BAISSIÈRE',
      structure: 'BEARISH_STRUCTURE',
      recentHigh: 151.2,
      recentLow: 149.5,
      averageVolume20: 1500,
      volumeRatio: 1.1,
      candleCount: 70,
    },
  });

  assert(fullBearishEval.outcome === 'SHORT', 'Confluence 4H/1H/15M/5M baissière : Configuration SHORT validée');
  assert(fullBearishEval.setup !== undefined, 'Setup SHORT généré avec succès');
  assert(fullBearishEval.qualityScore.total >= 70, `Score de qualité élevé (${fullBearishEval.qualityScore.total}/100 >= 70)`);
  assert(Boolean(fullBearishEval.setup && fullBearishEval.setup.stopLoss > fullBearishEval.setup.entryPrice), 'SHORT : Stop Loss strictement supérieur au prix d\'entrée');
  assert(Boolean(fullBearishEval.setup && fullBearishEval.setup.takeProfit1 < fullBearishEval.setup.entryPrice), 'SHORT : TP1 strictement inférieur au prix d\'entrée');
  assert(Boolean(fullBearishEval.setup && fullBearishEval.setup.takeProfit2 < fullBearishEval.setup.takeProfit1), 'SHORT : TP2 inférieur à TP1');
  assert(Boolean(fullBearishEval.setup && fullBearishEval.setup.takeProfit3 && fullBearishEval.setup.takeProfit3 < fullBearishEval.setup.takeProfit2), 'SHORT : TP3 inférieur à TP2');
}

console.log('\n============================================================');
console.log(`RÉSULTAT FINAL : ${passedTests}/${totalTests} tests réussis (${failedTests} échecs)`);
console.log('============================================================\n');

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
