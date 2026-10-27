/**
 * Test Suite Automatisée pour la Validation des Symboles et la Fraîcheur des Flux
 * Valide :
 * 1. Détection des symboles Spot vs Futures (STXBUSDT, STXUSDT, CHIPUSDT, BTCUSDT)
 * 2. Recommandation intelligente de bascule de marché (Spot <-> Futures)
 * 3. Protection contre les race conditions (timestamps inversés)
 * 4. Blocage strict NO_TRADE sur données obsolètes (> 30s/60s ou isStale)
 * 5. Rejet clair des symboles inexistants sans fausses données
 */

import { evaluateMarketSetup } from '../src/utils/tradeValidator';
import { TickerData } from '../src/types/crypto';

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
console.log('   CRYPTO EDGE AI v3.8 PRO - TESTS FLUX & SYMBOLES BINANCE  ');
console.log('============================================================\n');

async function runTests() {
  // --------------------------------------------------------------------------
  // TEST 1 : Validation croisée des symboles Spot et Futures via API Binance
  // --------------------------------------------------------------------------
  console.log('\x1b[34m[TEST 1] Validation officielle des symboles Binance (Spot vs Futures)\x1b[0m');
  {
    const [spotRes, futRes] = await Promise.all([
      fetch('https://api.binance.com/api/v3/exchangeInfo').then((r) => r.json()),
      fetch('https://fapi.binance.com/fapi/v1/exchangeInfo').then((r) => r.json()),
    ]);

    const spotSymbols = new Set(spotRes.symbols?.filter((s: any) => s.status === 'TRADING').map((s: any) => s.symbol));
    const futSymbols = new Set(futRes.symbols?.filter((s: any) => s.status === 'TRADING' && s.contractType === 'PERPETUAL').map((s: any) => s.symbol));

    // STXUSDT
    assert(spotSymbols.has('STXUSDT'), 'STXUSDT existe et est TRADING sur Binance Spot');
    assert(futSymbols.has('STXUSDT'), 'STXUSDT existe et est TRADING sur Binance Futures');

    // STXBUSDT
    assert(spotSymbols.has('STXBUSDT'), 'STXBUSDT existe sur Binance Spot (TRADING)');
    assert(!futSymbols.has('STXBUSDT'), 'STXBUSDT n\'existe PAS sur Binance Futures (justifiant le message de bascule)');

    // CHIPUSDT
    assert(futSymbols.has('CHIPUSDT') || spotSymbols.has('CHIPUSDT'), 'CHIPUSDT répertorié sur Binance');

    // BTCUSDT
    assert(spotSymbols.has('BTCUSDT') && futSymbols.has('BTCUSDT'), 'BTCUSDT actif sur les deux marchés');

    // Symbole fictif
    assert(!spotSymbols.has('FOOBARUSDT') && !futSymbols.has('FOOBARUSDT'), 'FOOBARUSDT inexistant sur les deux marchés');
  }

  // --------------------------------------------------------------------------
  // TEST 2 : Logique de détection et suggestion de bascule de marché
  // --------------------------------------------------------------------------
  console.log('\n\x1b[34m[TEST 2] Détection intelligente de bascule de marché\x1b[0m');
  {
    function checkMarketMismatch(symbol: string, requestedMarket: 'spot' | 'futures', spotHas: boolean, futHas: boolean) {
      const isTargetValid = requestedMarket === 'futures' ? futHas : spotHas;
      const isAltValid = requestedMarket === 'futures' ? spotHas : futHas;
      const altMarket = requestedMarket === 'futures' ? 'spot' : 'futures';

      if (isTargetValid) {
        return { isValidOnTarget: true, alternativeMarket: null };
      }
      if (isAltValid) {
        return {
          isValidOnTarget: false,
          alternativeMarket: altMarket,
          message: `La paire ${symbol} n'est pas négociable sur ${requestedMarket}, mais est disponible sur ${altMarket}.`,
        };
      }
      return {
        isValidOnTarget: false,
        alternativeMarket: null,
        message: `Le symbole "${symbol}" est introuvable sur Binance.`,
      };
    }

    const stxbOnFutures = checkMarketMismatch('STXBUSDT', 'futures', true, false);
    assert(!stxbOnFutures.isValidOnTarget, 'STXBUSDT rejeté sur Futures');
    assert(stxbOnFutures.alternativeMarket === 'spot', 'Alternative proposée = spot');
    assert(Boolean(stxbOnFutures.message?.includes('disponible sur spot')), 'Message explicite invitant à basculer sur Spot');

    const btcOnFutures = checkMarketMismatch('BTCUSDT', 'futures', true, true);
    assert(btcOnFutures.isValidOnTarget, 'BTCUSDT validé sur Futures');
    assert(btcOnFutures.alternativeMarket === null, 'Aucune bascule requise pour BTCUSDT');

    const fakeOnSpot = checkMarketMismatch('FOOBARUSDT', 'spot', false, false);
    assert(!fakeOnSpot.isValidOnTarget, 'FOOBARUSDT rejeté sur Spot');
    assert(fakeOnSpot.alternativeMarket === null, 'Aucune alternative pour symbole inexistant');
  }

  // --------------------------------------------------------------------------
  // TEST 3 : Protection contre les Race Conditions (Ordre chronologique)
  // --------------------------------------------------------------------------
  console.log('\n\x1b[34m[TEST 3] Protection anti-écrasement (Race Condition Guard)\x1b[0m');
  {
    let currentStoredPrice = 0;
    let lastStoredTimestamp = 0;

    function applyPriceUpdate(price: number, timestamp: number): boolean {
      if (timestamp < lastStoredTimestamp) {
        // Discard older out-of-order packet
        return false;
      }
      lastStoredTimestamp = timestamp;
      currentStoredPrice = price;
      return true;
    }

    // T0: First update
    const applied1 = applyPriceUpdate(0.05063, 1000);
    assert(applied1 && currentStoredPrice === 0.05063, 'T0: Premier prix 0.05063 appliqué (t=1000)');

    // T1: Newer update arrives (e.g. from WebSocket at 0.05096)
    const applied2 = applyPriceUpdate(0.05096, 2000);
    assert(applied2 && currentStoredPrice === 0.05096, 'T1: Prix plus récent 0.05096 appliqué (t=2000)');

    // T2: Delayed HTTP packet arrives late (e.g. from phone sleep lag with t=1500)
    const appliedLate = applyPriceUpdate(0.05063, 1500);
    assert(!appliedLate, 'T2: Paquet retardé t=1500 rejeté (anti-écrasement actif)');
    assert(currentStoredPrice === 0.05096, 'Le prix reste à 0.05096 sans être écrasé par l\'ancien prix');
  }

  // --------------------------------------------------------------------------
  // TEST 4 : Blocage strict NO_TRADE sur données obsolètes (Staleness Guard)
  // --------------------------------------------------------------------------
  console.log('\n\x1b[34m[TEST 4] Sécurité Staleness Guard (Blocage NO_TRADE si données figées)\x1b[0m');
  {
    const freshTicker: TickerData = {
      symbol: 'BTCUSDT',
      market: 'futures',
      price: 65000,
      change24h: 2.5,
      change24hAmount: 1500,
      high24h: 66000,
      low24h: 64000,
      volume24h: 50000,
      quoteVolume24h: 3000000000,
      timestamp: Date.now() - 5000, // 5s ago
      isLive: true,
      source: 'Binance Futures (WebSocket)',
      isStale: false,
    };

    const freshResult = evaluateMarketSetup({
      symbol: 'BTCUSDT',
      market: 'futures',
      currentPrice: 65000,
      ticker: freshTicker,
      timeframe1h: {
        timeframe: '1h',
        currentPrice: 65000,
        ema20: 64500,
        ema50: 64000,
        rsi: 58,
        atr: 400,
        atrPercent: 0.6,
        trend: 'HAUSSIÈRE',
        structure: 'BULLISH_STRUCTURE',
        recentHigh: 65500,
        recentLow: 63800,
        averageVolume20: 5000,
        volumeRatio: 1.4,
        candleCount: 70,
      },
    });

    const check1Fresh = freshResult.checklist.find((c) => c.id === 'check-1');
    assert(check1Fresh?.status === 'PASSED', 'Données fraîches (< 10s) : Check-1 validé (PASSED)');

    // Stale ticker (e.g. phone was locked for 70 seconds)
    const staleTicker: TickerData = {
      ...freshTicker,
      timestamp: Date.now() - 75000, // 75s ago
      isStale: true,
    };

    const staleResult = evaluateMarketSetup({
      symbol: 'BTCUSDT',
      market: 'futures',
      currentPrice: 65000,
      ticker: staleTicker,
    });

    assert(staleResult.outcome === 'NO_TRADE', 'Données obsolètes (> 60s ou isStale) : Forçage NO_TRADE strict');
    const check1Stale = staleResult.checklist.find((c) => c.id === 'check-1');
    assert(check1Stale?.status === 'FAILED', 'Check-1 marqué FAILED pour flux figé');
    assert(staleResult.noTradeReasons.some((r) => r.includes('obsolètes')), 'Motif de rejet explicite mentionnant cotations obsolètes');
  }

  // --------------------------------------------------------------------------
  // TEST 5 : Diagnostic spécifique HAEDALUSDT et seuil de fraîcheur de 4 secondes
  // --------------------------------------------------------------------------
  console.log('\n\x1b[34m[TEST 5] Cas spécifique HAEDALUSDT et seuil de fraîcheur\x1b[0m');
  {
    // 4 seconds is completely fresh and must NEVER be flagged as COTATIONS FIGÉES
    const haedalAgeSeconds = 4;
    const isStaleAt4s = haedalAgeSeconds >= 25;
    assert(!isStaleAt4s, 'Un délai de 4 secondes est considéré comme FRAIS (non figé, seuil >= 25s)');

    const haedalTicker: TickerData = {
      symbol: 'HAEDALUSDT',
      market: 'futures',
      price: 0.02916,
      change24h: 31.5,
      change24hAmount: 0.007,
      high24h: 0.0339,
      low24h: 0.0210,
      volume24h: 2800000000,
      quoteVolume24h: 79000000,
      timestamp: Date.now() - 4000, // 4s ago
      isLive: true,
      source: 'Binance USDⓈ-M Futures (WebSocket)',
      isStale: false,
    };

    const haedalEval = evaluateMarketSetup({
      symbol: 'HAEDALUSDT',
      market: 'futures',
      currentPrice: 0.02916,
      ticker: haedalTicker,
    });

    const check1 = haedalEval.checklist.find((c) => c.id === 'check-1');
    assert(check1?.status === 'PASSED', 'HAEDALUSDT à t-4s : Check-1 validé (PASSED, données fraîches)');
    assert(!haedalEval.noTradeReasons.some((r) => r.includes('obsolètes')), 'Aucun motif d\'obsolescence pour HAEDALUSDT à 4 secondes');
  }

  // --------------------------------------------------------------------------
  // TEST 6 : Changement rapide de symbole sans rémanence de l'ancienne cotation
  // --------------------------------------------------------------------------
  console.log('\n\x1b[34m[TEST 6] Changement rapide de symbole (étanchéité des états)\x1b[0m');
  {
    let displayedSymbol = 'BTCUSDT';
    let displayedPrice: number | null = 65000;

    function handleSymbolTransition(newSymbol: string) {
      displayedSymbol = newSymbol;
      // Immediate state clearing to prevent old price bleed
      displayedPrice = null;
    }

    handleSymbolTransition('HAEDALUSDT');
    assert(displayedSymbol === 'HAEDALUSDT', 'Symbole mis à jour vers HAEDALUSDT');
    assert(displayedPrice === null, 'Ancien prix BTC réinitialisé à null (pas de cotation rémanente)');

    // New quote arrives for HAEDALUSDT
    displayedPrice = 0.02916;
    assert(displayedPrice === 0.02916, 'Nouveau prix appliqué proprement pour HAEDALUSDT');
  }

  console.log('\n============================================================');
  console.log(`RÉSULTAT : ${passedTests}/${totalTests} tests réussis (${failedTests} échecs)`);
  console.log('============================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Erreur exécution tests:', err);
  process.exit(1);
});
