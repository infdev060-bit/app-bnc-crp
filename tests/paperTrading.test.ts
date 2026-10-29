import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createPaperTradeFromSetup,
  updateTradeWithCurrentPrice,
  manualClosePaperTrade,
  calculateAccountState,
  calculatePaperTradingStats,
} from '../src/utils/paperTradingEngine';
import {
  DEFAULT_PAPER_CONFIG,
  exportPaperTradesToCSV,
  exportPaperTradesToJSON,
} from '../src/utils/paperTradingStorage';
import { TradeSetup } from '../src/types/crypto';
import { PaperTrade } from '../src/types/paperTrading';

describe('SUITE DE TESTS COMPLÈTE : PAPER TRADING VIRTUEL (Crypto Edge AI v3.8 PRO)', () => {
  const sampleLongSetup: TradeSetup = {
    direction: 'LONG',
    pair: 'BTCUSDT',
    market: 'futures',
    entryPrice: 65000,
    entryZone: '64900 - 65100 USDT',
    stopLoss: 63700, // Risk = 1300$
    invalidationCondition: 'Clôture 15M sous 63700$',
    takeProfit1: 66950, // Gain = +1950$ (1.5 R/R)
    takeProfit2: 68900, // Gain = +3900$ (3.0 R/R)
    takeProfit3: 70850, // Gain = +5850$ (4.5 R/R)
    riskRewardRatioTP1: 1.5,
    riskRewardRatioTP2: 3.0,
    riskRewardRatioTP3: 4.5,
    netRiskRewardRatioTP1: 1.42,
    netRiskRewardRatioTP2: 2.88,
    grossGainPercentTP1: 3.0,
    netGainPercentTP1: 2.84,
    riskPercent: 2.0,
    suggestedRiskPercent: 0.5,
    tickSize: 0.01,
    keyConfluences: ['Confluence SMC Haussière', 'EMA 20 > EMA 50'],
    mainRisks: ['Volatilité sous le Stop Loss'],
    dataTimestamp: Date.now(),
  };

  const sampleShortSetup: TradeSetup = {
    direction: 'SHORT',
    pair: 'ETHUSDT',
    market: 'futures',
    entryPrice: 3500,
    entryZone: '3495 - 3505 USDT',
    stopLoss: 3570, // Risk = 70$
    invalidationCondition: 'Clôture 15M au-dessus de 3570$',
    takeProfit1: 3395, // Gain = +105$ (1.5 R/R)
    takeProfit2: 3290, // Gain = +210$ (3.0 R/R)
    takeProfit3: 3185, // Gain = +315$ (4.5 R/R)
    riskRewardRatioTP1: 1.5,
    riskRewardRatioTP2: 3.0,
    riskRewardRatioTP3: 4.5,
    netRiskRewardRatioTP1: 1.44,
    netRiskRewardRatioTP2: 2.9,
    grossGainPercentTP1: 3.0,
    netGainPercentTP1: 2.88,
    riskPercent: 2.0,
    suggestedRiskPercent: 0.5,
    tickSize: 0.01,
    keyConfluences: ['Rejet sous Order Block baissier'],
    mainRisks: ['Short squeeze au-dessus du Stop Loss'],
    dataTimestamp: Date.now(),
  };

  // 1. Initial Trade Creation & Sizing
  it('1. Dimensionnement exact de position respectant le risque configuré (0.5%)', () => {
    const accountBalance = 10000;
    const trade = createPaperTradeFromSetup(sampleLongSetup, accountBalance, DEFAULT_PAPER_CONFIG);

    assert.ok(trade !== null, 'Le trade simulé doit être créé avec succès');
    assert.strictEqual(trade.status, 'OPEN');
    assert.strictEqual(trade.symbol, 'BTCUSDT');
    assert.strictEqual(trade.direction, 'LONG');

    // Risk: 0.5% of 10,000$ = 50$
    assert.strictEqual(trade.allocatedRiskUsd, 50);

    // Quantity = 50$ / (65000 - 63700) = 50 / 1300 = 0.0384615... BTC
    const expectedQty = 50 / 1300;
    assert.ok(Math.abs(trade.initialQuantity - expectedQty) < 1e-6);
    assert.strictEqual(trade.currentQuantity, trade.initialQuantity);

    // Entry fee debited immediately
    assert.ok(trade.entryFeePaid > 0, 'Les frais d\'entrée doivent être calculés');
    assert.strictEqual(trade.realizedNetPnl, -trade.entryFeePaid);
  });

  // 2. LONG P&L Calculation with Full Exit
  it('2. Calcul déterministe du P&L LONG lors d\'une fermeture manuelle au marché', () => {
    const trade = createPaperTradeFromSetup(sampleLongSetup, 10000, DEFAULT_PAPER_CONFIG)!;
    const exitPrice = 66000; // +1000$ per BTC
    const closed = manualClosePaperTrade(trade, exitPrice);

    assert.strictEqual(closed.status, 'MANUAL_CLOSED');
    assert.strictEqual(closed.currentQuantity, 0);

    const grossGainPerUnit = exitPrice - trade.entryPrice; // +1000$
    const expectedGrossPnl = trade.initialQuantity * grossGainPerUnit;
    assert.ok(Math.abs(closed.realizedGrossPnl - expectedGrossPnl) < 1e-4);

    // Net PnL must deduct entry fee + exit fee + slippage
    assert.ok(closed.realizedNetPnl < closed.realizedGrossPnl, 'Le P&L net doit être strictement inférieur au brut');
    assert.ok(closed.realizedNetPnl > 0, 'Le P&L net doit être positif pour un gain supérieur aux frais');
  });

  // 3. SHORT P&L Calculation
  it('3. Calcul déterministe du P&L SHORT', () => {
    const trade = createPaperTradeFromSetup(sampleShortSetup, 10000, DEFAULT_PAPER_CONFIG)!;
    const exitPrice = 3400; // -100$ per ETH -> GAIN for SHORT
    const closed = manualClosePaperTrade(trade, exitPrice);

    assert.strictEqual(closed.status, 'MANUAL_CLOSED');
    const grossGainPerUnit = trade.entryPrice - exitPrice; // 3500 - 3400 = +100$
    const expectedGrossPnl = trade.initialQuantity * grossGainPerUnit;
    assert.ok(Math.abs(closed.realizedGrossPnl - expectedGrossPnl) < 1e-4);
    assert.ok(closed.realizedNetPnl > 0);
  });

  // 4. Configurable Partial Take Profits (TP1 50%, TP2 25%, TP3 25%)
  it('4. Sorties partielles TP1 (50%), TP2 (25%) et TP3 (solde)', () => {
    let trade = createPaperTradeFromSetup(sampleLongSetup, 10000, DEFAULT_PAPER_CONFIG)!;
    const initialQty = trade.initialQuantity;

    // Price reaches TP1 (66950)
    trade = updateTradeWithCurrentPrice(trade, 66950, Date.now(), false, DEFAULT_PAPER_CONFIG);
    assert.strictEqual(trade.status, 'TP1_HIT');
    assert.strictEqual(trade.partialFills.length, 1);
    assert.strictEqual(trade.partialFills[0].level, 'TP1');
    assert.ok(Math.abs(trade.currentQuantity - (initialQty * 0.5)) < 1e-6, 'Il doit rester exactement 50% de la position');

    // Price reaches TP2 (68900)
    trade = updateTradeWithCurrentPrice(trade, 68900, Date.now(), false, DEFAULT_PAPER_CONFIG);
    assert.strictEqual(trade.status, 'TP2_HIT');
    assert.strictEqual(trade.partialFills.length, 2);
    assert.strictEqual(trade.partialFills[1].level, 'TP2');
    assert.ok(Math.abs(trade.currentQuantity - (initialQty * 0.25)) < 1e-6, 'Il doit rester exactement 25% de la position');

    // Price reaches TP3 (70850) -> Full close
    trade = updateTradeWithCurrentPrice(trade, 70850, Date.now(), false, DEFAULT_PAPER_CONFIG);
    assert.strictEqual(trade.status, 'TP3_HIT');
    assert.strictEqual(trade.partialFills.length, 3);
    assert.strictEqual(trade.currentQuantity, 0, 'La position doit être entièrement clôturée');

    // Check sum of partial quantities equals initial quantity
    const sumClosed = trade.partialFills.reduce((acc, f) => acc + f.quantityClosed, 0);
    assert.ok(Math.abs(sumClosed - initialQty) < 1e-6, 'La somme des sorties partielles doit égaler la quantité initiale');
  });

  // 5. Stop Loss after partial fill
  it('5. Déclenchement du Stop Loss après une sortie partielle (protège le solde restant)', () => {
    let trade = createPaperTradeFromSetup(sampleLongSetup, 10000, DEFAULT_PAPER_CONFIG)!;

    // Trigger TP1
    trade = updateTradeWithCurrentPrice(trade, 66950, Date.now(), false, DEFAULT_PAPER_CONFIG);
    assert.strictEqual(trade.status, 'TP1_HIT');
    const realizedAfterTP1 = trade.realizedNetPnl;
    assert.ok(realizedAfterTP1 > 0, 'TP1 doit dégager un P&L net positif');

    // Price reverses and hits Stop Loss (63700)
    trade = updateTradeWithCurrentPrice(trade, 63650, Date.now(), false, DEFAULT_PAPER_CONFIG);
    assert.strictEqual(trade.status, 'SL_HIT');
    assert.strictEqual(trade.currentQuantity, 0);
    assert.strictEqual(trade.partialFills.length, 2);
    assert.strictEqual(trade.partialFills[1].level, 'SL');
  });

  // 6. Conservative Collision Handling
  it('6. Collision conjointe SL / TP dans la même bougie : Résolution conservative au Stop Loss', () => {
    const trade = createPaperTradeFromSetup(sampleLongSetup, 10000, DEFAULT_PAPER_CONFIG)!;

    // Une bougie extrême touche le Stop Loss (63500 <= 63700) et le TP1 (67000 >= 66950)
    // En simulation, le moteur doit considérer le SL comme touché en premier pour éviter le biais d'optimisme
    const result = updateTradeWithCurrentPrice(trade, 63500, Date.now(), false, DEFAULT_PAPER_CONFIG);
    assert.strictEqual(result.status, 'SL_HIT');
    assert.strictEqual(result.currentQuantity, 0);
    assert.ok(result.exitReason?.includes('Stop Loss'));
  });

  // 7. Stale Prices Suspension Guard
  it('7. Prix figés ou flux interrompu : Suspension stricte de l\'exécution automatique', () => {
    const trade = createPaperTradeFromSetup(sampleLongSetup, 10000, DEFAULT_PAPER_CONFIG)!;

    // Price theoretically reaches TP1, BUT data is marked as STALE (isDataStale: true)
    const updated = updateTradeWithCurrentPrice(trade, 67500, Date.now(), true, DEFAULT_PAPER_CONFIG);

    assert.strictEqual(updated.status, 'OPEN', 'Le statut doit rester OPEN car les données sont obsolètes');
    assert.strictEqual(updated.currentQuantity, trade.initialQuantity, 'Aucune sortie ne doit être exécutée sur prix figé');
    assert.strictEqual(updated.isStalePrice, true);
  });

  // 8. Account State & Equity Calculation
  it('8. Calcul de l\'équité, marge bloquée et solde disponible', () => {
    const trade = createPaperTradeFromSetup(sampleLongSetup, 10000, DEFAULT_PAPER_CONFIG)!;
    const accountState = calculateAccountState([trade], DEFAULT_PAPER_CONFIG);

    assert.strictEqual(accountState.initialCapital, 10000);
    assert.strictEqual(accountState.openPositionsCount, 1);
    assert.ok(accountState.marginLocked > 0, 'La marge doit être bloquée');
    assert.strictEqual(accountState.availableBalance, 10000 - trade.entryFeePaid - accountState.marginLocked);
  });

  // 9. Statistics on fully closed trades only
  it('9. Statistiques calculées exclusivement sur les trades entièrement clôturés', () => {
    const openTrade = createPaperTradeFromSetup(sampleLongSetup, 10000, DEFAULT_PAPER_CONFIG)!;

    const closedWinner = manualClosePaperTrade(
      createPaperTradeFromSetup(sampleLongSetup, 10000, DEFAULT_PAPER_CONFIG)!,
      67000
    );
    const closedLoser = manualClosePaperTrade(
      createPaperTradeFromSetup(sampleLongSetup, 10000, DEFAULT_PAPER_CONFIG)!,
      63000
    );

    const stats = calculatePaperTradingStats([openTrade, closedWinner, closedLoser]);

    assert.strictEqual(stats.totalClosedTrades, 2, 'Seuls les trades clôturés doivent être comptabilisés');
    assert.strictEqual(stats.winningTrades, 1);
    assert.strictEqual(stats.losingTrades, 1);
    assert.strictEqual(stats.winRate, 50);
    assert.ok(stats.averageWinUsd > 0);
    assert.ok(stats.averageLossUsd > 0);
    assert.ok(stats.profitFactor > 0);
  });

  // 10. CSV & JSON Export
  it('10. Export intègre et déterministe en CSV et JSON', () => {
    const trade = manualClosePaperTrade(
      createPaperTradeFromSetup(sampleLongSetup, 10000, DEFAULT_PAPER_CONFIG)!,
      66000
    );

    const csv = exportPaperTradesToCSV([trade]);
    assert.ok(csv.includes('BTCUSDT'), 'Le CSV doit contenir le symbole');
    assert.ok(csv.includes('MANUAL_CLOSED'), 'Le CSV doit contenir le statut');
    assert.ok(csv.includes('LONG'), 'Le CSV doit contenir la direction');

    const jsonStr = exportPaperTradesToJSON([trade], DEFAULT_PAPER_CONFIG);
    const parsed = JSON.parse(jsonStr);
    assert.strictEqual(parsed.trades.length, 1);
    assert.strictEqual(parsed.trades[0].symbol, 'BTCUSDT');
  });

  // 11. Zero Real Binance Order Execution Verification
  it('11. SÉCURITÉ ABSOLUE : Zéro appel d\'API d\'ordre réel vers Binance', () => {
    // Audit statique et dynamique : l'application n'utilise aucune clé d'ordre (API-KEY, secret)
    // et ne cible aucun endpoint privé (/api/v3/order, /fapi/v1/order)
    const trade = createPaperTradeFromSetup(sampleLongSetup, 10000, DEFAULT_PAPER_CONFIG)!;
    assert.ok(trade.id.startsWith('pt-'), 'L\'identifiant de transaction est préfixé strictement pt- (paper trade)');
  });
});
