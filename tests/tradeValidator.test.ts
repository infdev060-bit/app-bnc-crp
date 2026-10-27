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

console.log('\n============================================================');
console.log(`RÉSULTAT FINAL : ${passedTests}/${totalTests} tests réussis (${failedTests} échecs)`);
console.log('============================================================\n');

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
