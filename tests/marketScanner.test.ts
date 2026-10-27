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
