import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  calculateRiskRewardRatios,
  validatePriceHierarchy,
  evaluateMarketSetup,
} from '../src/utils/tradeValidator';
import { quantizePrice, getDecimalsFromTickSize, formatCryptoPrice } from '../src/utils/priceFormatter';
import {
  isArticleMatchingCoin,
  calculateNewsImpactScore,
  combineTechnicalAndNewsVerdict,
  isSimilarStory,
} from '../src/utils/newsAnalyzer';
import { Candle, IndicatorSnapshot, TickerData } from '../src/types/crypto';

describe('Audit Technique et Mathématique : Crypto Edge AI v3.8 PRO', () => {
  // =========================================================================
  // 1. Audit des Calculs LONG
  // =========================================================================
  it('1.1. Calcul LONG déterministe : R/R brut, R/R net, P&L unitaire et hiérarchie', () => {
    const entry = 65000.0;
    const sl = 64200.0; // Risk = 800.0 USDT
    const tp1 = 66440.0; // Gain = 1440.0 USDT (1.80 R/R)
    const tp2 = 67400.0; // Gain = 2400.0 USDT (3.00 R/R)
    const tp3 = 68600.0; // Gain = 3600.0 USDT (4.50 R/R)
    const frictionPercent = 0.12; // Futures (0.08% fees + 0.04% buffer)

    // Vérification de la hiérarchie des prix : SL < Entry < TP1 < TP2 < TP3
    const hierarchy = validatePriceHierarchy('LONG', entry, sl, tp1, tp2, tp3);
    assert.strictEqual(hierarchy.isValid, true, 'La hiérarchie des prix LONG doit être valide');

    // Calcul indépendant TP1
    const rr1 = calculateRiskRewardRatios('LONG', entry, sl, tp1, frictionPercent);
    assert.strictEqual(rr1.isValid, true);
    assert.strictEqual(rr1.risk, 800.0, 'Le risque par unité doit être 800.0 USDT');
    assert.strictEqual(rr1.potentialGain, 1440.0, 'Le gain potentiel TP1 par unité doit être 1440.0 USDT');
    assert.strictEqual(parseFloat(rr1.grossRR.toFixed(2)), 1.80, 'R/R brut TP1 doit être 1.80:1');

    const expectedRiskPct = (800 / 65000) * 100; // ~1.230769%
    const expectedGainPct = (1440 / 65000) * 100; // ~2.215384%
    const expectedNetGainPct = expectedGainPct - frictionPercent; // ~2.095384%
    const expectedNetRR = expectedNetGainPct / expectedRiskPct; // ~1.7025:1

    assert.strictEqual(parseFloat(rr1.riskPct.toFixed(2)), parseFloat(expectedRiskPct.toFixed(2)));
    assert.strictEqual(parseFloat(rr1.grossGainPct.toFixed(2)), parseFloat(expectedGainPct.toFixed(2)));
    assert.strictEqual(parseFloat(rr1.netGainPct.toFixed(2)), parseFloat(expectedNetGainPct.toFixed(2)));
    assert.strictEqual(parseFloat(rr1.netRR.toFixed(2)), parseFloat(expectedNetRR.toFixed(2)));

    // Calcul indépendant TP2
    const rr2 = calculateRiskRewardRatios('LONG', entry, sl, tp2, frictionPercent);
    assert.strictEqual(parseFloat(rr2.grossRR.toFixed(2)), 3.00);

    // Calcul indépendant TP3
    const rr3 = calculateRiskRewardRatios('LONG', entry, sl, tp3, frictionPercent);
    assert.strictEqual(parseFloat(rr3.grossRR.toFixed(2)), 4.50);
  });

  // =========================================================================
  // 2. Audit des Calculs SHORT
  // =========================================================================
  it('2.1. Calcul SHORT déterministe : R/R brut, R/R net, P&L unitaire et hiérarchie', () => {
    const entry = 3000.0;
    const sl = 3050.0; // Risk = 50.0 USDT
    const tp1 = 2910.0; // Gain = 90.0 USDT (1.80 R/R)
    const tp2 = 2850.0; // Gain = 150.0 USDT (3.00 R/R)
    const tp3 = 2775.0; // Gain = 225.0 USDT (4.50 R/R)
    const frictionPercent = 0.24; // Spot (0.20% fees + 0.04% slippage)

    // Hiérarchie SHORT : TP3 < TP2 < TP1 < Entry < SL
    const hierarchy = validatePriceHierarchy('SHORT', entry, sl, tp1, tp2, tp3);
    assert.strictEqual(hierarchy.isValid, true, 'La hiérarchie des prix SHORT doit être valide');

    const rr1 = calculateRiskRewardRatios('SHORT', entry, sl, tp1, frictionPercent);
    assert.strictEqual(rr1.isValid, true);
    assert.strictEqual(rr1.risk, 50.0, 'Le risque par unité doit être 50.0 USDT');
    assert.strictEqual(rr1.potentialGain, 90.0, 'Le gain potentiel TP1 doit être 90.0 USDT');
    assert.strictEqual(parseFloat(rr1.grossRR.toFixed(2)), 1.80, 'R/R brut TP1 doit être 1.80:1');

    const expectedRiskPct = (50 / 3000) * 100; // 1.66667%
    const expectedGainPct = (90 / 3000) * 100; // 3.00%
    const expectedNetGainPct = 3.00 - frictionPercent; // 2.76%
    const expectedNetRR = expectedNetGainPct / expectedRiskPct; // ~1.656:1

    assert.strictEqual(parseFloat(rr1.riskPct.toFixed(2)), parseFloat(expectedRiskPct.toFixed(2)));
    assert.strictEqual(parseFloat(rr1.grossGainPct.toFixed(2)), parseFloat(expectedGainPct.toFixed(2)));
    assert.strictEqual(parseFloat(rr1.netGainPct.toFixed(2)), parseFloat(expectedNetGainPct.toFixed(2)));
    assert.strictEqual(parseFloat(rr1.netRR.toFixed(2)), parseFloat(expectedNetRR.toFixed(2)));
  });

  // =========================================================================
  // 3. Audit de la Précision et des Décimales (Tick Size)
  // =========================================================================
  it('3.1. Quantisation exacte sur différentes échelles de prix (BTC, ETH, micro-tokens)', () => {
    // Cas BTC : tickSize 0.01
    assert.strictEqual(quantizePrice(84250.3478, 0.01, 'round'), 84250.35);
    assert.strictEqual(quantizePrice(84250.3478, 0.01, 'floor'), 84250.34);
    assert.strictEqual(quantizePrice(84250.3412, 0.01, 'ceil'), 84250.35);

    // Cas ETH : tickSize 0.01
    assert.strictEqual(quantizePrice(2745.892, 0.01, 'floor'), 2745.89);

    // Cas token à micro-prix (ex: 0.00001548 avec tickSize 0.0000001 - 7 décimales)
    const tickMicro = 0.0000001; // 1e-7
    const decimals = getDecimalsFromTickSize(tickMicro);
    assert.strictEqual(decimals, 7);
    const quantized = quantizePrice(0.00001548, tickMicro, 'round');
    assert.strictEqual(quantized, 0.0000155);

    // P&L unitaire sans troncature sur 1e-7
    const entryMicro = 0.0000155;
    const slMicro = 0.0000145;
    const unitRisk = parseFloat(Math.abs(entryMicro - slMicro).toFixed(decimals));
    assert.strictEqual(unitRisk, 0.000001);

    // Cas token à nano-prix avec tickSize 1e-8 (0.00000001 - 8 décimales)
    const tickNano = 0.00000001; // 1e-8
    const decimalsNano = getDecimalsFromTickSize(tickNano);
    assert.strictEqual(decimalsNano, 8);
    const quantizedNano = quantizePrice(0.0000001234, tickNano, 'round');
    assert.strictEqual(quantizedNano, 0.00000012);

    const entryNano = 0.00000012;
    const slNano = 0.00000010;
    const tpNano = 0.00000015;
    const unitRiskNano = parseFloat(Math.abs(entryNano - slNano).toFixed(decimalsNano));
    const unitGainNano = parseFloat(Math.abs(tpNano - entryNano).toFixed(decimalsNano));
    assert.strictEqual(unitRiskNano, 0.00000002);
    assert.strictEqual(unitGainNano, 0.00000003);

    const rrNano = calculateRiskRewardRatios('LONG', entryNano, slNano, tpNano, 0.12);
    assert.strictEqual(rrNano.isValid, true);
    assert.strictEqual(parseFloat(rrNano.grossRR.toFixed(2)), 1.50);
  });

  it('3.2. Distinction formelle entre P&L unitaire et P&L de position totale', () => {
    const entry = 65000.0;
    const sl = 64200.0;
    const tp1 = 66440.0;
    const accountBalance = 10000.0;
    const riskPercent = 1.0; // 100 USDT de risque maximal

    // 1. Risque et gain par unité (Per-Unit P&L)
    const unitRisk = entry - sl; // 800 USDT
    const unitGain = tp1 - entry; // 1440 USDT

    // 2. Taille de position dimensionnée pour risquer exactement 100 USDT
    const monetaryRisk = (accountBalance * riskPercent) / 100; // 100 USDT
    const positionSizeCrypto = monetaryRisk / unitRisk; // 100 / 800 = 0.125 BTC
    const positionSizeUsd = positionSizeCrypto * entry; // 0.125 * 65000 = 8125 USDT

    // 3. P&L Total de la position (Total-Position P&L)
    const totalGrossLoss = positionSizeCrypto * unitRisk; // 0.125 * 800 = 100 USDT
    const totalGrossProfit = positionSizeCrypto * unitGain; // 0.125 * 1440 = 180 USDT

    assert.strictEqual(totalGrossLoss, monetaryRisk, 'La perte totale au Stop Loss doit être exactement égale au risque monétaire');
    assert.strictEqual(totalGrossProfit, 180.0, 'Le profit total sur TP1 doit être 180 USDT');
    assert.notStrictEqual(unitGain, totalGrossProfit, 'Le gain unitaire (1440$) ne doit jamais être confondu avec le gain de position (180$)');
  });

  // =========================================================================
  // 4. Détection des Erreurs de Hiérarchie et R/R Non Calculables
  // =========================================================================
  it('4.1. Rejet strict des géométries de prix invalides (SL au-dessus de l\'entrée sur LONG)', () => {
    const invalidLongSL = validatePriceHierarchy('LONG', 100, 105, 120, 130);
    assert.strictEqual(invalidLongSL.isValid, false);
    assert.ok(invalidLongSL.errorReason?.includes('Stop Loss'));

    const invalidLongTP = validatePriceHierarchy('LONG', 100, 95, 98, 130);
    assert.strictEqual(invalidLongTP.isValid, false);
    assert.ok(invalidLongTP.errorReason?.includes('TP1'));

    const invalidShortSL = validatePriceHierarchy('SHORT', 100, 95, 80, 70);
    assert.strictEqual(invalidShortSL.isValid, false);

    const rrZeroRisk = calculateRiskRewardRatios('LONG', 100, 100, 120, 0.12);
    assert.strictEqual(rrZeroRisk.isValid, false);
    assert.strictEqual(rrZeroRisk.grossRR, 0);
  });

  // =========================================================================
  // 5. Invalidation sur Rupture Structurelle et Données Obsolètes
  // =========================================================================
  it('5.1. Rejet NO_TRADE si le prix a déjà franchi le creux/sommet structurel', () => {
    const mockSnapshots: IndicatorSnapshot = {
      timeframe: '15m',
      currentPrice: 64600,
      trend: 'HAUSSIÈRE',
      structure: 'BULLISH_STRUCTURE',
      rsi: 52,
      atr: 50,
      atrPercent: 1.2,
      ema20: 64500,
      ema50: 64000,
      ema200: 63000,
      recentHigh: 66000,
      recentLow: 64800, // Le creux structurel est à 64800
      candleCount: 50,
      averageVolume20: 1000,
      volumeRatio: 1.2,
    };

    const mockTicker: TickerData = {
      symbol: 'BTCUSDT',
      market: 'futures',
      price: 64600, // Le prix est à 64600, donc DÉJÀ EN DESSOUS du creux structurel (64800)!
      change24h: 1.5,
      change24hAmount: 950,
      high24h: 66000,
      low24h: 64000,
      volume24h: 10000,
      quoteVolume24h: 50000000,
      timestamp: Date.now(),
      tickSize: 0.01,
      source: 'Binance',
      isLive: true,
      isStale: false,
    };

    const res = evaluateMarketSetup({
      symbol: 'BTCUSDT',
      market: 'futures',
      currentPrice: 64600,
      ticker: mockTicker,
      timeframe4h: mockSnapshots,
      timeframe1h: mockSnapshots,
      timeframe15m: mockSnapshots,
      timeframe5m: mockSnapshots,
    });

    assert.strictEqual(res.outcome, 'NO_TRADE', 'Un prix déjà sous le creux structurel doit invalider le setup LONG');
    assert.ok(res.noTradeReasons.some((r) => r.includes('creux structurel')));
  });

  it('5.2. Rejet NO_TRADE si les cotations sont obsolètes (> 60s ou isStale: true)', () => {
    const mockTickerStale: TickerData = {
      symbol: 'BTCUSDT',
      market: 'futures',
      price: 65000,
      change24h: 1.5,
      change24hAmount: 950,
      high24h: 66000,
      low24h: 64000,
      volume24h: 10000,
      quoteVolume24h: 50000000,
      timestamp: Date.now() - 120000, // Il y a 120 secondes (2 minutes)
      tickSize: 0.01,
      source: 'Binance',
      isLive: true,
      isStale: true,
    };

    const res = evaluateMarketSetup({
      symbol: 'BTCUSDT',
      market: 'futures',
      currentPrice: 65000,
      ticker: mockTickerStale,
    });

    assert.strictEqual(res.outcome, 'NO_TRADE');
    assert.ok(res.noTradeReasons.some((r) => r.includes('obsolètes') || r.includes('interrompu')));
  });

  it('5.3. Expiration d\'un setup datant de plus de 90 secondes dans combineTechnicalAndNewsVerdict', () => {
    const expiredSetup: any = {
      direction: 'LONG',
      pair: 'BTCUSDT',
      entryPrice: 65000,
      stopLoss: 64200,
      takeProfit1: 66440,
      takeProfit2: 67400,
      riskRewardRatioTP1: 1.8,
      netRiskRewardRatioTP1: 1.7,
      dataTimestamp: Date.now() - 150000, // 150s écoulées
    };

    const combined = combineTechnicalAndNewsVerdict({
      technicalVerdict: 'LONG',
      technicalScore: 85,
      newsImpactScore: 20,
      setup: expiredSetup,
      symbol: 'BTCUSDT',
      hasStaleData: false,
    });

    assert.strictEqual(combined.combinedVerdict, 'NO_TRADE');
    assert.ok(combined.verdictRationale.includes('expirée'));
  });

  // =========================================================================
  // 6. Audit de la Classification des Actualités de ZECUSDT
  // =========================================================================
  it('6.1. ZECUSDT : Correspondance avec Zcash et ZEC, rejet strict des actions bStocks et Applovin', () => {
    // 1. Article mentionnant spécifiquement ZEC / Zcash
    const zecArticle1 = 'Bitcoin nears $81,000 ahead of Fed decision as ZEC jumps 8%';
    const zecArticle2 = 'Zcash privacy upgrades deployed successfully on mainnet';
    const zecArticle3 = 'Traders eye $ZEC resistance breakout after privacy protocol update';

    assert.strictEqual(isArticleMatchingCoin(zecArticle1, '', 'ZEC'), true, 'ZEC dans le titre doit matcher ZEC');
    assert.strictEqual(isArticleMatchingCoin(zecArticle2, '', 'ZEC'), true, 'Zcash doit matcher ZEC via la résolution d\'entité');
    assert.strictEqual(isArticleMatchingCoin(zecArticle3, '', 'ZEC'), true, '$ZEC doit matcher ZEC');

    // 2. Annonces officielles d\'actions tokenisées et autres tokens
    const bstocksAnnouncement = 'Binance Will Add 5 bStocks Tokenized Securities as Collateral Asset - 2026-10-28';
    const applovinAnnouncement = 'Binance Exchange Adds Applovin Corp (APPB), Bending Spoons (BSPB) bStocks Trading Pairs';
    const macroArticle = 'Canadian crypto king case to go to jury as criminal trial winds down';

    assert.strictEqual(isArticleMatchingCoin(bstocksAnnouncement, '', 'ZEC'), false, 'bStocks ne doit JAMAIS matcher ZEC');
    assert.strictEqual(isArticleMatchingCoin(applovinAnnouncement, '', 'ZEC'), false, 'Applovin ne doit JAMAIS matcher ZEC');
    assert.strictEqual(isArticleMatchingCoin(macroArticle, '', 'ZEC'), false, 'Un article criminel général ne doit pas matcher ZEC');

    // 3. Vérification du calcul d\'impact sur jump/jumps
    const scoredJump = calculateNewsImpactScore({
      title: zecArticle1,
      source: 'CoinDesk',
      isOfficial: false,
      publishedAt: Date.now(),
    });
    assert.ok(scoredJump.impactScore > 0, 'Le terme "jumps" doit conférer un score d\'impact positif');
  });

  // =========================================================================
  // 7. Sémantique des Scores et Absence de Fausses Allégations
  // =========================================================================
  it('7.1. Le Score de Qualité est un score de confluence (0-100) et non une probabilité de gain', () => {
    const mockSnapshots: IndicatorSnapshot = {
      timeframe: '15m',
      currentPrice: 65000,
      trend: 'HAUSSIÈRE',
      structure: 'BULLISH_STRUCTURE',
      rsi: 52,
      atr: 50,
      atrPercent: 1.2,
      ema20: 64500,
      ema50: 64000,
      ema200: 63000,
      recentHigh: 66000,
      recentLow: 64000,
      candleCount: 50,
      averageVolume20: 1000,
      volumeRatio: 1.2,
      orderBlock: { type: 'BULLISH', top: 64800, bottom: 64500, mitigated: false },
    };

    const mockTicker: TickerData = {
      symbol: 'BTCUSDT',
      market: 'futures',
      price: 65000,
      change24h: 2.5,
      change24hAmount: 1580,
      high24h: 66000,
      low24h: 64000,
      volume24h: 15000,
      quoteVolume24h: 80000000, // 80M USDT liquide
      timestamp: Date.now(),
      tickSize: 0.01,
      source: 'Binance',
      isLive: true,
      isStale: false,
    };

    const res = evaluateMarketSetup({
      symbol: 'BTCUSDT',
      market: 'futures',
      currentPrice: 65000,
      ticker: mockTicker,
      timeframe4h: mockSnapshots,
      timeframe1h: mockSnapshots,
      timeframe15m: mockSnapshots,
      timeframe5m: mockSnapshots,
    });

    assert.strictEqual(res.outcome, 'LONG');
    assert.ok(res.qualityScore.total >= 70, 'Un setup valide doit avoir un score de confluence >= 70');
    assert.ok(
      res.qualityScore.explanation.includes('ne constitue en aucun cas une probabilité mathématique de gain'),
      'L\'explication doit explicitement dissiper toute confusion avec un taux de réussite ou win rate'
    );
  });

  it('7.2. Les qualificatifs de momentum (jumps, climbs) sont descriptifs et ne constituent pas une preuve de gains futurs', () => {
    const scoredJump = calculateNewsImpactScore({
      title: 'ZEC jumps 8% as privacy tokens bounce',
      source: 'CoinDesk',
      isOfficial: false,
      publishedAt: Date.now(),
    });
    // L'impact score mesure l'intensité de la nouvelle constatée, mais combineTechnicalAndNewsVerdict
    // refuse STRICTEMENT de déclencher un trade si la configuration technique SMC est NO_TRADE
    assert.ok(scoredJump.impactScore > 0, 'Score d\'impact descriptif positif');

    const combinedWithNoTrade = combineTechnicalAndNewsVerdict({
      technicalVerdict: 'NO_TRADE',
      technicalScore: 40,
      newsImpactScore: scoredJump.impactScore, // Impact positif
      symbol: 'ZECUSDT',
      hasStaleData: false,
    });

    assert.strictEqual(
      combinedWithNoTrade.combinedVerdict,
      'NO_TRADE',
      'Une actualité positive ou un saut de cours passé ne peut JAMAIS justifier un trade si le setup SMC est NO_TRADE'
    );
  });

  it('7.3. Déduplication des dépêches syndiquées pour éviter l\'inflation artificielle du sentiment', () => {
    const titleA = 'Bitcoin breaks above $81,000 as institutional demand accelerates';
    const titleB = 'Bitcoin breaking above $81,000 amid institutional demand surge';
    const isDup = isSimilarStory(titleA, titleB);
    assert.strictEqual(isDup, true, 'Deux titres syndiqués couvrant le même événement doivent être détectés comme doublons');
  });
});
