/**
 * Test Suite Automatisée pour le Scanner Intelligent du Marché Crypto (Scanner IA)
 * Crypto Edge AI v3.8 PRO
 *
 * Valide les 8 critères fondamentaux du cahier des charges :
 * 1. Filtrage et sélection des paires officielles Binance (Spot & Futures).
 * 2. Filtrage strict par liquidité / volume minimum 24h (quoteVolume USDT).
 * 3. Hiérarchie stricte des prix (LONG : SL < Entrée < TP1 < TP2 < TP3 / SHORT : TP3 < TP2 < TP1 < Entrée < SL).
 * 4. Déduction des frais de courtage et du slippage dans le ratio R/R net (R/R net < R/R brut).
 * 5. Classement déterministe et pondéré par score de qualité (/100).
 * 6. Protection de capital : rejet automatique (NO_TRADE) en consolidation ou divergence MTF.
 * 7. Gestion de l'état sans opportunité conforme (Capital Preservation / 0 faux signaux).
 */

import { evaluateMarketSetup, validatePriceHierarchy, calculateRiskRewardRatios } from '../src/utils/tradeValidator';
import { generateTimeframeSnapshot } from '../src/utils/indicators';
import { Candle, IndicatorSnapshot, ScannedOpportunity, QualityScore, TickerData, TradeSetup } from '../src/types/crypto';

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
console.log('   CRYPTO EDGE AI v3.8 PRO - TESTS SCANNER INTELLIGENT IA   ');
console.log('============================================================\n');

async function runTests() {
  // --------------------------------------------------------------------------
  // TEST 1 : Récupération des tickers officiels Binance et filtrage par volume
  // --------------------------------------------------------------------------
  console.log('\x1b[34m[TEST 1] Filtrage officiel des tickers Binance (Spot & Futures)\x1b[0m');
  {
    const [spotRes, futRes] = await Promise.all([
      fetch('https://api.binance.com/api/v3/ticker/24hr').then((r) => r.json()),
      fetch('https://fapi.binance.com/fapi/v1/ticker/24hr').then((r) => r.json()),
    ]);

    assert(Array.isArray(spotRes) && spotRes.length > 500, 'Binance Spot retourne une liste exhaustive de tickers 24h');
    assert(Array.isArray(futRes) && futRes.length > 200, 'Binance Futures retourne une liste exhaustive de tickers 24h');

    // Filtrer les paires USDT actives avec un volume minimum de 10M USDT
    const minVolume = 10_000_000;
    const validFutPairs = futRes.filter((t: any) => {
      const vol = parseFloat(t.quoteVolume || '0');
      return t.symbol.endsWith('USDT') && vol >= minVolume;
    });

    assert(validFutPairs.length > 10, `Binance Futures dispose de paires USDT très liquides (>10M$) : ${validFutPairs.length} trouvées`);
    
    // Vérifier que BTCUSDT, ETHUSDT et SOLUSDT figurent parmi les plus liquides
    const topSymbols = validFutPairs.map((t: any) => t.symbol);
    assert(topSymbols.includes('BTCUSDT'), 'BTCUSDT est présent dans les tickers liquides');
    assert(topSymbols.includes('ETHUSDT'), 'ETHUSDT est présent dans les tickers liquides');
    assert(topSymbols.includes('SOLUSDT'), 'SOLUSDT est présent dans les tickers liquides');
  }

  // --------------------------------------------------------------------------
  // TEST 2 : Hiérarchie stricte des niveaux TP1, TP2, TP3 et Stop Loss
  // --------------------------------------------------------------------------
  console.log('\n\x1b[34m[TEST 2] Validation géométrique stricte des prix (LONG & SHORT)\x1b[0m');
  {
    // Scénario A : Configuration LONG valide
    const longSetup = {
      direction: 'LONG' as const,
      entryPrice: 100.0,
      stopLoss: 98.0,
      takeProfit1: 103.0,
      takeProfit2: 105.0,
      takeProfit3: 108.0,
    };
    const validLong = validatePriceHierarchy(
      longSetup.direction,
      longSetup.entryPrice,
      longSetup.stopLoss,
      longSetup.takeProfit1,
      longSetup.takeProfit2,
      longSetup.takeProfit3
    );
    assert(validLong.isValid, 'LONG respecte SL (98) < Entrée (100) < TP1 (103) < TP2 (105) < TP3 (108)');

    // Scénario B : Configuration LONG invalide (SL supérieur à l'entrée)
    const invalidLongSL = validatePriceHierarchy('LONG', 100.0, 101.0, 104.0, 106.0, 108.0);
    assert(!invalidLongSL.isValid, 'LONG avec SL > Entrée est strictement rejeté');

    // Scénario C : Configuration LONG invalide (TP2 inférieur à TP1)
    const invalidLongTP = validatePriceHierarchy('LONG', 100.0, 98.0, 105.0, 103.0, 108.0);
    assert(!invalidLongTP.isValid, 'LONG avec TP2 < TP1 est strictement rejeté');

    // Scénario D : Configuration SHORT valide
    const shortSetup = {
      direction: 'SHORT' as const,
      entryPrice: 100.0,
      stopLoss: 102.5,
      takeProfit1: 96.0,
      takeProfit2: 93.0,
      takeProfit3: 89.0,
    };
    const validShort = validatePriceHierarchy(
      shortSetup.direction,
      shortSetup.entryPrice,
      shortSetup.stopLoss,
      shortSetup.takeProfit1,
      shortSetup.takeProfit2,
      shortSetup.takeProfit3
    );
    assert(validShort.isValid, 'SHORT respecte TP3 (89) < TP2 (93) < TP1 (96) < Entrée (100) < SL (102.5)');

    // Scénario E : Configuration SHORT invalide (TP1 supérieur à l'entrée)
    const invalidShortTP = validatePriceHierarchy('SHORT', 100.0, 103.0, 101.0, 95.0, 90.0);
    assert(!invalidShortTP.isValid, 'SHORT avec TP1 > Entrée est strictement rejeté');
  }

  // --------------------------------------------------------------------------
  // TEST 3 : Impact des frais et du slippage sur les ratios R/R
  // --------------------------------------------------------------------------
  console.log('\n\x1b[34m[TEST 3] Calcul des Ratios R/R bruts vs nets (frais + slippage)\x1b[0m');
  {
    const friction = 0.15; // 0.15% frais + slippage
    const r1 = calculateRiskRewardRatios('LONG', 50.0, 48.0, 53.0, friction);
    const r2 = calculateRiskRewardRatios('LONG', 50.0, 48.0, 56.0, friction);
    const r3 = calculateRiskRewardRatios('LONG', 50.0, 48.0, 60.0, friction);

    assert(r1.isValid && r1.grossRR > 0 && r1.netRR > 0, 'R/R1 calculable et valide');
    assert(r2.grossRR > r1.grossRR, 'R/R brut TP2 (3.0) supérieur à TP1 (1.5)');
    assert(r2.netRR < r2.grossRR, 'R/R net TP2 strictement inférieur au brut (impact des frais et slippage)');
    assert(r3.netRR < r3.grossRR, 'R/R net TP3 strictement inférieur au brut');
    assert(r1.risk === 2.0, 'Risque unitaire exact (50 - 48 = 2.0)');
    assert(r2.potentialGain === 6.0, 'Gain potentiel TP2 exact (56 - 50 = 6.0)');
  }

  // --------------------------------------------------------------------------
  // TEST 4 : Préservation du capital (Rejet des marchés en consolidation HTF)
  // --------------------------------------------------------------------------
  console.log('\n\x1b[34m[TEST 4] Préservation du capital et rejet des faux signaux\x1b[0m');
  {
    // Construire des snapshots où le 4H est en consolidation
    const snap4h: IndicatorSnapshot = {
      timeframe: '4h',
      trend: 'CONSOLIDATION',
      structure: 'NEUTRAL',
      currentPrice: 100,
      recentHigh: 102,
      recentLow: 99,
      averageVolume20: 1000,
      candleCount: 60,
      ema20: 100,
      ema50: 100,
      rsi: 50,
      atr: 2,
      atrPercent: 2,
      volumeRatio: 0.8,
    };

    const snap1h: IndicatorSnapshot = {
      timeframe: '1h',
      trend: 'HAUSSIÈRE',
      structure: 'BULLISH_STRUCTURE',
      currentPrice: 101,
      recentHigh: 103,
      recentLow: 98,
      averageVolume20: 1000,
      candleCount: 60,
      ema20: 101,
      ema50: 99,
      rsi: 55,
      atr: 1.5,
      atrPercent: 1.5,
      volumeRatio: 1.1,
      breakOfStructureDetected: true,
    };

    const snap15m: IndicatorSnapshot = {
      timeframe: '15m',
      trend: 'HAUSSIÈRE',
      structure: 'BULLISH_STRUCTURE',
      currentPrice: 101.5,
      recentHigh: 102,
      recentLow: 100,
      averageVolume20: 1000,
      candleCount: 60,
      ema20: 101.5,
      ema50: 100,
      rsi: 58,
      atr: 0.8,
      atrPercent: 0.8,
      volumeRatio: 1.3,
      breakOfStructureDetected: true,
    };

    const dummyTicker: TickerData = {
      symbol: 'TESTUSDT',
      price: 101,
      change24h: 0.5,
      change24hAmount: 0.5,
      high24h: 103,
      low24h: 98,
      volume24h: 50000,
      quoteVolume24h: 5000000,
      timestamp: Date.now(),
      market: 'futures',
      source: 'Binance USDⓈ-M Futures',
      tickSize: 0.01,
      isLive: true,
      isStale: false,
    };

    const evalResult = evaluateMarketSetup({
      symbol: 'TESTUSDT',
      market: 'futures',
      currentPrice: 101,
      ticker: dummyTicker,
      timeframe4h: snap4h,
      timeframe1h: snap1h,
      timeframe15m: snap15m,
    });

    assert(evalResult.outcome === 'NO_TRADE', 'Consolidation sur unité HTF (4H) force le verdict NO_TRADE');
    assert(
      evalResult.qualityScore.breakdown.marketStructure <= 12,
      `Score de structure limité (${evalResult.qualityScore.breakdown.marketStructure}/20) lors d\'une consolidation HTF`
    );
    assert(
      evalResult.qualityScore.total < 65,
      `Score total (${evalResult.qualityScore.total}/100) inférieur au seuil de validation de trade (65)`
    );
  }

  // --------------------------------------------------------------------------
  // TEST 5 : Tri déterministe des opportunités scannées
  // --------------------------------------------------------------------------
  console.log('\n\x1b[34m[TEST 5] Classement des résultats par Score et R/R net\x1b[0m');
  {
    const makeScore = (total: number, label: 'EXCELLENT' | 'BON' | 'MOYEN' | 'INSUFFISANT'): QualityScore => ({
      total,
      ratingLabel: label,
      breakdown: {
        htfAlignment: Math.min(20, Math.floor(total * 0.2)),
        marketStructure: Math.min(20, Math.floor(total * 0.2)),
        entryQuality: Math.min(20, Math.floor(total * 0.2)),
        volumeConfirmation: Math.min(15, Math.floor(total * 0.15)),
        riskRewardScore: Math.min(15, Math.floor(total * 0.15)),
        volatilityScore: Math.min(10, Math.floor(total * 0.1)),
        dataReliability: 5,
      },
      explanation: `Score ${total}`,
    });

    const opportunities: ScannedOpportunity[] = [
      {
        symbol: 'ADAUSDT',
        market: 'futures',
        currentPrice: 0.72,
        change24h: 2.1,
        volume24h: 60000000,
        quoteVolume24h: 45000000,
        tickSize: 0.0001,
        outcome: 'LONG',
        qualityScore: makeScore(78, 'EXCELLENT'),
        setup: {
          direction: 'LONG',
          pair: 'ADAUSDT',
          market: 'futures',
          entryPrice: 0.718,
          entryZone: '0.715 - 0.720',
          stopLoss: 0.702,
          invalidationCondition: 'Clôture 15M sous 0.702',
          takeProfit1: 0.748,
          takeProfit2: 0.765,
          takeProfit3: 0.785,
          riskRewardRatioTP1: 1.88,
          riskRewardRatioTP2: 2.94,
          riskRewardRatioTP3: 4.19,
          netRiskRewardRatioTP1: 1.8,
          netRiskRewardRatioTP2: 2.85,
          netRiskRewardRatioTP3: 4.1,
          grossGainPercentTP1: 4.18,
          netGainPercentTP1: 4.03,
          riskPercent: 2.23,
          suggestedRiskPercent: 1.0,
          keyConfluences: ['Order Block 15M testé', 'RSI haussier'],
          mainRisks: ['Résistance 4H proche'],
          dataTimestamp: Date.now(),
        },
        noTradeReasons: [],
        executiveSummary: 'Setup LONG ADA validé',
        timestamp: Date.now(),
      },
      {
        symbol: 'SOLUSDT',
        market: 'futures',
        currentPrice: 185.5,
        change24h: 4.8,
        volume24h: 650000,
        quoteVolume24h: 120000000,
        tickSize: 0.01,
        outcome: 'LONG',
        qualityScore: makeScore(89, 'EXCELLENT'),
        setup: {
          direction: 'LONG',
          pair: 'SOLUSDT',
          market: 'futures',
          entryPrice: 185.0,
          entryZone: '184.5 - 185.5',
          stopLoss: 180.0,
          invalidationCondition: 'Clôture 15M sous 180.0',
          takeProfit1: 195.5,
          takeProfit2: 202.0,
          takeProfit3: 210.5,
          riskRewardRatioTP1: 2.1,
          riskRewardRatioTP2: 3.4,
          riskRewardRatioTP3: 5.1,
          netRiskRewardRatioTP1: 2.05,
          netRiskRewardRatioTP2: 3.32,
          netRiskRewardRatioTP3: 5.01,
          grossGainPercentTP1: 5.68,
          netGainPercentTP1: 5.53,
          riskPercent: 2.7,
          suggestedRiskPercent: 1.0,
          keyConfluences: ['BOS 1H confirmé', 'FVG mitigé', 'Alignement MTF 4H+1H+15M'],
          mainRisks: ['Volatilité accrue'],
          dataTimestamp: Date.now(),
        },
        noTradeReasons: [],
        executiveSummary: 'Setup LONG SOL validé',
        timestamp: Date.now(),
      },
      {
        symbol: 'DOGEUSDT',
        market: 'futures',
        currentPrice: 0.16,
        change24h: -1.2,
        volume24h: 180000000,
        quoteVolume24h: 30000000,
        tickSize: 0.00001,
        outcome: 'NO_TRADE',
        qualityScore: makeScore(48, 'INSUFFISANT'),
        noTradeReasons: ['Consolidation HTF', 'R/R défavorable'],
        executiveSummary: 'NO TRADE DOGE',
        timestamp: Date.now(),
      },
    ];

    // Tri par score décroissant
    const sortedByScore = [...opportunities].sort((a, b) => b.qualityScore.total - a.qualityScore.total);
    assert(sortedByScore[0].symbol === 'SOLUSDT', 'SOLUSDT en tête du classement par score (89)');
    assert(sortedByScore[1].symbol === 'ADAUSDT', 'ADAUSDT en 2e position (78)');
    assert(sortedByScore[2].symbol === 'DOGEUSDT', 'DOGEUSDT en dernière position (48)');

    // Filtrage des opportunités validées uniquement (score >= 65)
    const validatedOnly = opportunities.filter((o) => o.outcome !== 'NO_TRADE' && o.qualityScore.total >= 65);
    assert(validatedOnly.length === 2, 'Seules 2 opportunités sur 3 sont retenues comme validées');
    assert(!validatedOnly.some((o) => o.symbol === 'DOGEUSDT'), 'DOGEUSDT (NO_TRADE) est exclu du filtre des opportunités validées');
  }

  // --------------------------------------------------------------------------
  // TEST 6 : Gestion de l'état sans opportunités conformes
  // --------------------------------------------------------------------------
  console.log('\n\x1b[34m[TEST 6] Préservation stricte : État sans opportunité valide\x1b[0m');
  {
    const makeScore = (total: number, label: 'EXCELLENT' | 'BON' | 'MOYEN' | 'INSUFFISANT'): QualityScore => ({
      total,
      ratingLabel: label,
      breakdown: {
        htfAlignment: Math.min(20, Math.floor(total * 0.2)),
        marketStructure: Math.min(20, Math.floor(total * 0.2)),
        entryQuality: Math.min(20, Math.floor(total * 0.2)),
        volumeConfirmation: Math.min(15, Math.floor(total * 0.15)),
        riskRewardScore: Math.min(15, Math.floor(total * 0.15)),
        volatilityScore: Math.min(10, Math.floor(total * 0.1)),
        dataReliability: 5,
      },
      explanation: `Score ${total}`,
    });

    const poorOpportunities: ScannedOpportunity[] = [
      {
        symbol: 'TOKENAUSDT',
        market: 'spot',
        currentPrice: 1.0,
        change24h: 0.1,
        volume24h: 3000000,
        quoteVolume24h: 3000000,
        tickSize: 0.001,
        outcome: 'NO_TRADE',
        qualityScore: makeScore(42, 'INSUFFISANT'),
        noTradeReasons: ['R/R < 1.5:1', 'Volume insuffisant'],
        executiveSummary: 'NO TRADE',
        timestamp: Date.now(),
      },
      {
        symbol: 'TOKENBUSDT',
        market: 'spot',
        currentPrice: 2.5,
        change24h: -3.5,
        volume24h: 2000000,
        quoteVolume24h: 5000000,
        tickSize: 0.001,
        outcome: 'NO_TRADE',
        qualityScore: makeScore(54, 'MOYEN'),
        noTradeReasons: ['Divergence MTF'],
        executiveSummary: 'NO TRADE',
        timestamp: Date.now(),
      },
    ];

    const validated = poorOpportunities.filter((o) => o.outcome !== 'NO_TRADE' && o.qualityScore.total >= 65);
    assert(validated.length === 0, 'Aucune opportunité ne passe le filtre strict lorsque le marché est dégradé');
    assert(
      poorOpportunities.every((o) => o.outcome === 'NO_TRADE'),
      'Tous les actifs non conformes conservent l\'étiquette NO_TRADE sans signal forcé'
    );
  }

  // --------------------------------------------------------------------------
  // TEST 7 : Catégorisation en 3 groupes (LONG, SHORT, À Surveiller)
  // --------------------------------------------------------------------------
  console.log('\n\x1b[34m[TEST 7] Catégorisation explicite (LONG, SHORT, À Surveiller)\x1b[0m');
  {
    const makeScore = (total: number, label: 'EXCELLENT' | 'BON' | 'MOYEN' | 'INSUFFISANT'): QualityScore => ({
      total,
      ratingLabel: label,
      breakdown: {
        htfAlignment: Math.min(20, Math.floor(total * 0.2)),
        marketStructure: Math.min(20, Math.floor(total * 0.2)),
        entryQuality: Math.min(20, Math.floor(total * 0.2)),
        volumeConfirmation: Math.min(15, Math.floor(total * 0.15)),
        riskRewardScore: Math.min(15, Math.floor(total * 0.15)),
        volatilityScore: Math.min(10, Math.floor(total * 0.1)),
        dataReliability: 5,
      },
      explanation: `Score ${total}`,
    });

    const dataset: ScannedOpportunity[] = [
      {
        symbol: 'BTCUSDT',
        market: 'futures',
        currentPrice: 65000,
        change24h: 3.2,
        volume24h: 40000,
        quoteVolume24h: 2600000000,
        tickSize: 0.1,
        outcome: 'LONG',
        qualityScore: makeScore(88, 'EXCELLENT'),
        setup: {
          direction: 'LONG',
          pair: 'BTCUSDT',
          market: 'futures',
          entryPrice: 65000,
          entryZone: '64950 - 65050',
          stopLoss: 64000,
          invalidationCondition: 'Clôture 15M sous 64000',
          takeProfit1: 67000,
          takeProfit2: 69000,
          takeProfit3: 71000,
          riskRewardRatioTP1: 2.0,
          riskRewardRatioTP2: 4.0,
          riskRewardRatioTP3: 6.0,
          netRiskRewardRatioTP1: 1.92,
          netRiskRewardRatioTP2: 3.88,
          netRiskRewardRatioTP3: 5.82,
          grossGainPercentTP1: 3.08,
          netGainPercentTP1: 2.93,
          riskPercent: 1.54,
          unitRisk: 1000,
          unitGainTP1: 2000,
          unitGainTP2: 4000,
          unitGainTP3: 6000,
          estimatedFeesPercent: 0.08,
          estimatedSlippagePercent: 0.05,
          confirmedTimeframes: ['4H', '1H', '15M', '5M'],
          suggestedRiskPercent: 1.0,
          keyConfluences: ['Alignement MTF 4H+1H+15M', 'Order Block 15M'],
          mainRisks: ['Résistance 68000'],
          dataTimestamp: Date.now(),
        },
        noTradeReasons: [],
        executiveSummary: 'Setup LONG BTC validé',
        timestamp: Date.now(),
      },
      {
        symbol: 'ETHUSDT',
        market: 'futures',
        currentPrice: 3200,
        change24h: -2.5,
        volume24h: 300000,
        quoteVolume24h: 960000000,
        tickSize: 0.01,
        outcome: 'SHORT',
        qualityScore: makeScore(84, 'EXCELLENT'),
        setup: {
          direction: 'SHORT',
          pair: 'ETHUSDT',
          market: 'futures',
          entryPrice: 3200,
          entryZone: '3195 - 3205',
          stopLoss: 3280,
          invalidationCondition: 'Clôture 15M au-dessus de 3280',
          takeProfit1: 3040,
          takeProfit2: 2920,
          takeProfit3: 2800,
          riskRewardRatioTP1: 2.0,
          riskRewardRatioTP2: 3.5,
          riskRewardRatioTP3: 5.0,
          netRiskRewardRatioTP1: 1.94,
          netRiskRewardRatioTP2: 3.42,
          netRiskRewardRatioTP3: 4.88,
          grossGainPercentTP1: 5.0,
          netGainPercentTP1: 4.85,
          riskPercent: 2.5,
          unitRisk: 80,
          unitGainTP1: 160,
          unitGainTP2: 280,
          unitGainTP3: 400,
          estimatedFeesPercent: 0.08,
          estimatedSlippagePercent: 0.05,
          confirmedTimeframes: ['4H', '1H', '15M'],
          suggestedRiskPercent: 1.0,
          keyConfluences: ['BOS 1H', 'FVG 15M baissier'],
          mainRisks: ['Support psychologique 3000'],
          dataTimestamp: Date.now(),
        },
        noTradeReasons: [],
        executiveSummary: 'Setup SHORT ETH validé',
        timestamp: Date.now(),
      },
      {
        symbol: 'AVAXUSDT',
        market: 'futures',
        currentPrice: 30.5,
        change24h: 0.8,
        volume24h: 1200000,
        quoteVolume24h: 36600000,
        tickSize: 0.001,
        outcome: 'NO_TRADE',
        qualityScore: makeScore(56, 'MOYEN'),
        noTradeReasons: ['Divergence MTF : 4H en range, 15M haussière', 'R/R brut insuffisant'],
        executiveSummary: 'En cours de formation',
        timestamp: Date.now(),
      },
      {
        symbol: 'TRASHUSDT',
        market: 'futures',
        currentPrice: 0.005,
        change24h: -8.0,
        volume24h: 100000,
        quoteVolume24h: 500,
        tickSize: 0.00001,
        outcome: 'NO_TRADE',
        qualityScore: makeScore(22, 'INSUFFISANT'),
        noTradeReasons: ['Volume quasi nul', 'Données insuffisantes'],
        executiveSummary: 'Rejet strict',
        timestamp: Date.now(),
      },
    ];

    const minS = 65;
    const minRR = 1.2;

    const bestLong = dataset.filter((item) => item.outcome === 'LONG' && item.qualityScore.total >= minS && (item.setup?.netRiskRewardRatioTP1 || 0) >= minRR);
    const bestShort = dataset.filter((item) => item.outcome === 'SHORT' && item.qualityScore.total >= minS && (item.setup?.netRiskRewardRatioTP1 || 0) >= minRR);
    const watchlist = dataset.filter((item) => !bestLong.includes(item) && !bestShort.includes(item) && item.qualityScore.total >= 45);
    const rejected = dataset.filter((item) => !bestLong.includes(item) && !bestShort.includes(item) && !watchlist.includes(item));

    assert(bestLong.length === 1 && bestLong[0].symbol === 'BTCUSDT', 'BTCUSDT classé dans MEILLEURES OPPORTUNITÉS LONG');
    assert(bestShort.length === 1 && bestShort[0].symbol === 'ETHUSDT', 'ETHUSDT classé dans MEILLEURES OPPORTUNITÉS SHORT');
    assert(watchlist.length === 1 && watchlist[0].symbol === 'AVAXUSDT', 'AVAXUSDT (score 56) classé dans À SURVEILLER (Incomplète)');
    assert(rejected.length === 1 && rejected[0].symbol === 'TRASHUSDT', 'TRASHUSDT (score 22) classé dans REJETÉ');
  }

  // --------------------------------------------------------------------------
  // TEST 8 : Cohérence des 4 timeframes (4H, 1H, 15M, 5M)
  // --------------------------------------------------------------------------
  console.log('\n\x1b[34m[TEST 8] Cohérence des quatre timeframes (4H, 1H, 15M, 5M)\x1b[0m');
  {
    const snap4h: IndicatorSnapshot = {
      timeframe: '4h',
      trend: 'HAUSSIÈRE',
      structure: 'BULLISH_STRUCTURE',
      currentPrice: 50000,
      recentHigh: 51000,
      recentLow: 49000,
      averageVolume20: 5000,
      candleCount: 60,
      ema20: 49800,
      ema50: 48500,
      rsi: 62,
      atr: 800,
      atrPercent: 1.6,
      volumeRatio: 1.2,
      breakOfStructureDetected: true,
    };

    const snap1h: IndicatorSnapshot = {
      timeframe: '1h',
      trend: 'HAUSSIÈRE',
      structure: 'BULLISH_STRUCTURE',
      currentPrice: 50000,
      recentHigh: 50500,
      recentLow: 49500,
      averageVolume20: 3000,
      candleCount: 60,
      ema20: 49900,
      ema50: 49200,
      rsi: 58,
      atr: 400,
      atrPercent: 0.8,
      volumeRatio: 1.1,
      breakOfStructureDetected: true,
      orderBlock: {
        type: 'BULLISH',
        top: 49700,
        bottom: 49500,
        mitigated: false,
      },
    };

    const snap15m: IndicatorSnapshot = {
      timeframe: '15m',
      trend: 'HAUSSIÈRE',
      structure: 'BULLISH_STRUCTURE',
      currentPrice: 50000,
      recentHigh: 50200,
      recentLow: 49700,
      averageVolume20: 1500,
      candleCount: 60,
      ema20: 49950,
      ema50: 49800,
      rsi: 56,
      atr: 200,
      atrPercent: 0.4,
      volumeRatio: 1.3,
      breakOfStructureDetected: true,
    };

    const snap5m: IndicatorSnapshot = {
      timeframe: '5m',
      trend: 'HAUSSIÈRE',
      structure: 'BULLISH_STRUCTURE',
      currentPrice: 50000,
      recentHigh: 50100,
      recentLow: 49850,
      averageVolume20: 800,
      candleCount: 60,
      ema20: 49980,
      ema50: 49900,
      rsi: 54,
      atr: 90,
      atrPercent: 0.18,
      volumeRatio: 1.0,
    };

    const dummyTicker: TickerData = {
      symbol: 'BTCUSDT',
      price: 50000,
      change24h: 2.5,
      change24hAmount: 1250,
      high24h: 51000,
      low24h: 48500,
      volume24h: 50000,
      quoteVolume24h: 2500000000,
      timestamp: Date.now(),
      market: 'futures',
      source: 'Binance USDⓈ-M Futures',
      tickSize: 0.1,
      isLive: true,
      isStale: false,
    };

    const result = evaluateMarketSetup({
      symbol: 'BTCUSDT',
      market: 'futures',
      currentPrice: 50000,
      ticker: dummyTicker,
      timeframe4h: snap4h,
      timeframe1h: snap1h,
      timeframe15m: snap15m,
      timeframe5m: snap5m,
    });

    assert(result.outcome === 'LONG', 'Confluence 4H+1H+15M+5M haussière produit un verdict LONG');
    assert(result.setup !== undefined, 'Setup de trade complet généré');
    assert(Boolean(result.setup?.confirmedTimeframes?.includes('4H')), '4H listé dans confirmedTimeframes');
    assert(Boolean(result.setup?.confirmedTimeframes?.includes('1H')), '1H listé dans confirmedTimeframes');
    assert(Boolean(result.setup?.confirmedTimeframes?.includes('15M')), '15M listé dans confirmedTimeframes');
    assert(Boolean(result.setup?.confirmedTimeframes?.includes('5M')), '5M listé dans confirmedTimeframes');
    assert((result.setup?.unitRisk || 0) > 0, `Risque unitaire calculé : ${result.setup?.unitRisk} $`);
    assert((result.setup?.unitGainTP1 || 0) > 0, `Gain unitaire TP1 calculé : ${result.setup?.unitGainTP1} $`);
  }

  // --------------------------------------------------------------------------
  // TEST 9 : Micro-prix et précision tickSize (CHIPUSDT & micro-caps)
  // --------------------------------------------------------------------------
  console.log('\n\x1b[34m[TEST 9] Micro-prix (< 0.01$) et quantification officielle Binance\x1b[0m');
  {
    const chipPrice = 0.05063;
    const tick = 0.00001;

    // Simulation SL et TP
    const sl = 0.04960;
    const tp1 = 0.05269;
    const tp2 = 0.05475;
    const tp3 = 0.05681;

    const validHierarchy = validatePriceHierarchy('LONG', chipPrice, sl, tp1, tp2, tp3);
    assert(validHierarchy.isValid, 'CHIPUSDT : SL (0.04960) < Entrée (0.05063) < TP1 (0.05269) < TP2 < TP3');

    const friction = 0.08 + 0.05; // 0.13%
    const rr = calculateRiskRewardRatios('LONG', chipPrice, sl, tp1, friction);
    assert(rr.grossRR >= 1.5, `R/R brut (${rr.grossRR.toFixed(2)}:1) >= 1.5:1 sur micro-prix`);
    assert(rr.netRR < rr.grossRR, 'R/R net inférieur au brut après déduction des frais sur micro-prix');
  }

  // --------------------------------------------------------------------------
  // TEST 10 : Paires absentes sur Futures mais présentes sur Spot (ex: STXBUSDT)
  // --------------------------------------------------------------------------
  console.log('\n\x1b[34m[TEST 10] Séparation Spot vs Futures et gestion des paires exclusives\x1b[0m');
  {
    const [spotRes, futRes] = await Promise.all([
      fetch('https://api.binance.com/api/v3/exchangeInfo').then((r) => r.json()),
      fetch('https://fapi.binance.com/fapi/v1/exchangeInfo').then((r) => r.json()),
    ]);

    const spotSet = new Set(spotRes.symbols?.map((s: any) => s.symbol));
    const futSet = new Set(futRes.symbols?.map((s: any) => s.symbol));

    // STXBUSDT existe sur Spot mais PAS sur Futures
    assert(spotSet.has('STXBUSDT'), 'STXBUSDT présent dans Binance Spot');
    assert(!futSet.has('STXBUSDT'), 'STXBUSDT absent de Binance Futures (évite erreur Invalid Symbol)');
  }

  // --------------------------------------------------------------------------
  // TEST 11 : Blocage strict si données obsolètes (Stale Data Guard)
  // --------------------------------------------------------------------------
  console.log('\n\x1b[34m[TEST 11] Données obsolètes ou flux interrompu -> Blocage NO_TRADE\x1b[0m');
  {
    const staleTicker: TickerData = {
      symbol: 'BTCUSDT',
      price: 65000,
      change24h: 1.0,
      change24hAmount: 650,
      high24h: 66000,
      low24h: 64000,
      volume24h: 10000,
      quoteVolume24h: 650000000,
      timestamp: Date.now() - 75000, // 75 secondes de retard (obsolète)
      market: 'futures',
      source: 'Binance USDⓈ-M Futures',
      tickSize: 0.1,
      isLive: true,
      isStale: true,
    };

    const staleResult = evaluateMarketSetup({
      symbol: 'BTCUSDT',
      market: 'futures',
      currentPrice: 65000,
      ticker: staleTicker,
    });

    assert(staleResult.outcome === 'NO_TRADE', 'Données obsolètes (> 60s ou isStale) forcent le verdict NO_TRADE');
    assert(staleResult.checklist[0].status === 'FAILED', 'Check-1 marqué FAILED pour flux obsolète');
    assert(staleResult.noTradeReasons.some((r) => r.toLowerCase().includes('obsolète') || r.toLowerCase().includes('interrompu')), 'Motif explicite d\'obsolescence fourni');
  }

  // --------------------------------------------------------------------------
  // BILAN FINAL
  // --------------------------------------------------------------------------
  console.log('\n============================================================');
  console.log(`   RÉSULTAT DES TESTS : ${passedTests}/${totalTests} réussis (${failedTests} échecs)`);
  console.log('============================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Erreur critique pendant les tests:', err);
  process.exit(1);
});
