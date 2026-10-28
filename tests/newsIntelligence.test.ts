import {
  calculateNewsImpactScore,
  generateDarijaExplanation,
  combineTechnicalAndNewsVerdict,
  isArticleMatchingCoin,
  isSimilarStory,
} from '../src/utils/newsAnalyzer';
import { TradeSetup } from '../src/types/crypto';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${msg}`);
  }
}

console.log('--- COMPREHENSIVE TEST SUITE: NEWS INTELLIGENCE AUDIT ---');

// 1. Tests for calculateNewsImpactScore (Section 3 of Audit)
console.log('\n[1] calculateNewsImpactScore tests:');
{
  const bullish = calculateNewsImpactScore({
    title: 'SEC officially approved Bitcoin ETF spot application for major institutions',
    description: 'Massive capital inflows expected across markets.',
    source: 'Binance Official',
    isOfficial: true,
  });
  assert(bullish.impactScore > 40, `Bullish ETF score should be > 40 (got ${bullish.impactScore})`);
  assert(bullish.sentiment === 'BULLISH', `Sentiment should be BULLISH (got ${bullish.sentiment})`);
  assert(bullish.isConfirmed === true, `Official source should be confirmed`);

  const bearish = calculateNewsImpactScore({
    title: 'Major protocol exploit: $60M stolen in smart contract vulnerability and drain',
    description: 'Funds moved to privacy mixer, team paused bridges.',
    source: 'CoinDesk',
    isOfficial: false,
  });
  assert(bearish.impactScore < -40, `Exploit score should be < -40 (got ${bearish.impactScore})`);
  assert(bearish.sentiment === 'BEARISH', `Sentiment should be BEARISH (got ${bearish.sentiment})`);

  const rumor = calculateNewsImpactScore({
    title: 'Rumors circulate that SEC may consider investigation into token distribution',
    description: 'Unconfirmed report alleges regulators could face developers.',
    source: 'CryptoMedia',
    isOfficial: false,
  });
  assert(!rumor.isConfirmed, `Rumor item should not be confirmed`);
  assert(Math.abs(rumor.impactScore) <= 50, `Rumor score impact should be dampened (got ${rumor.impactScore})`);

  // Clamping test with extreme repetitions
  const extremePositive = calculateNewsImpactScore({
    title: 'ETF approved approval partnership record high all-time high ATH breakout rally adoption listing launch',
    description: 'ETF institutional inflow reserves mainnet upgrade',
    source: 'Binance',
    isOfficial: true,
  });
  assert(extremePositive.impactScore <= 100, `Impact score should never exceed +100 (got ${extremePositive.impactScore})`);
  assert(extremePositive.impactScore >= -100, `Impact score should never drop below -100`);

  // Freshness decay test
  const oldNews = calculateNewsImpactScore({
    title: 'Massive partnership announced for cross-chain settlement',
    source: 'CoinTelegraph',
    publishedAt: Date.now() - 72 * 3600 * 1000, // 3 days ago
  });
  const recentNews = calculateNewsImpactScore({
    title: 'Massive partnership announced for cross-chain settlement',
    source: 'CoinTelegraph',
    publishedAt: Date.now() - 2 * 3600 * 1000, // 2 hours ago
  });
  assert(oldNews.impactScore < recentNews.impactScore, `Old news impact should decay vs recent news (old: ${oldNews.impactScore}, recent: ${recentNews.impactScore})`);
}

// 2. Tests for Cryptocurrency Matching & False Positive Prevention (Section 2 of Audit)
console.log('\n[2] isArticleMatchingCoin entity matching tests:');
{
  // CHIP collisions
  const chipStockFalse = isArticleMatchingCoin(
    'Kospi surges 7% as SK Hynix earnings fuel chip rally and semiconductor gains',
    'South Korea tech stocks rallied as global chipmakers expanded orders',
    'CHIP'
  );
  assert(chipStockFalse === false, 'CHIP: Semiconductor chip rally must NOT match crypto CHIP');

  const chipBtcFalse = isArticleMatchingCoin(
    'Bitcoin rebounds above $81,000 as Asian stock markets bounce, chip makers gain',
    'Tech stocks and semiconductor equities rebounded',
    'CHIP'
  );
  assert(chipBtcFalse === false, 'CHIP: Bitcoin article with "chip makers" must NOT match crypto CHIP');

  const chipRealTrue = isArticleMatchingCoin(
    'Binance Lists CHIP/USDT Perpetual Contracts with up to 50x Leverage',
    'Trading will open at 12:00 UTC with CHIPUSDT pair',
    'CHIP'
  );
  assert(chipRealTrue === true, 'CHIP: Explicit CHIP/USDT or CHIPUSDT must match crypto CHIP');

  // NEAR collisions
  const nearFalse = isArticleMatchingCoin(
    'Bitcoin hits new monthly high near $80,000 as institutional demand grows',
    'Price came near resistance before pulling back',
    'NEAR'
  );
  assert(nearFalse === false, 'NEAR: English preposition "near $80k" must NOT match crypto NEAR');

  const nearTrue = isArticleMatchingCoin(
    'Near Protocol unveils cross-chain sharding milestone and ecosystem grant program',
    'Developers on Near Foundation announced Phase 2',
    'NEAR'
  );
  assert(nearTrue === true, 'NEAR: "Near Protocol" or "Near Foundation" matches crypto NEAR');

  // SOL collisions
  const solFalse = isArticleMatchingCoin(
    'Liquidators seek resolution and solvent restructuring solution for creditors',
    'Court documents indicate absolute resolution needed',
    'SOL'
  );
  assert(solFalse === false, 'SOL: English words "solution/insolvent/resolution" must NOT match crypto SOL');

  const solTrue = isArticleMatchingCoin(
    'Solana DeFi total value locked reaches yearly peak with decentralized exchange volume surge',
    'Activity on Solana network surpassed Ethereum daily volume',
    'SOL'
  );
  assert(solTrue === true, 'SOL: "Solana" matches crypto SOL');

  // LINK collisions
  const linkFalse = isArticleMatchingCoin(
    'Developers provide useful link to documentation and website links below',
    'Click link for more information',
    'LINK'
  );
  assert(linkFalse === false, 'LINK: English word "link/links" must NOT match Chainlink');

  const linkTrue = isArticleMatchingCoin(
    'Chainlink integrates Cross-Chain Interoperability Protocol (CCIP) across 5 networks',
    'LINK staking rewards increased by 8%',
    'LINK'
  );
  assert(linkTrue === true, 'LINK: "Chainlink" or "$LINK" matches crypto LINK');

  // BTC & ETH
  const btcTrue = isArticleMatchingCoin(
    'Bitcoin breaks through key resistance as institutional custody inflows surge',
    'Satoshi era wallet woke up after 12 years',
    'BTC'
  );
  assert(btcTrue === true, 'BTC: Bitcoin / Satoshi matches BTC');

  const btcNotEth = isArticleMatchingCoin(
    'Bitcoin breaks through key resistance with massive trading volume',
    'MicroStrategy acquired additional 15,000 BTC',
    'ETH'
  );
  assert(btcNotEth === false, 'ETH: Pure Bitcoin article must NOT match ETH');
}

// 3. Tests for Duplicate Story Detection (Section 3 of Audit)
console.log('\n[3] isSimilarStory duplicate clustering tests:');
{
  const duplicateA = 'Bitcoin bounces above $81,000 as Asian stock markets rally';
  const duplicateB = 'Bitcoin tops $81,000 as Asian stock markets bounce strongly';
  assert(isSimilarStory(duplicateA, duplicateB) === true, 'Detects identical story reported by CoinTelegraph and CoinDesk');

  const differentA = 'Federal Reserve holds interest rates steady at 5.25%';
  const differentB = 'Solana decentralized exchange volume surpasses Ethereum mainnet';
  assert(isSimilarStory(differentA, differentB) === false, 'Distinct stories are correctly kept separate');
}

// 4. Tests for Moroccan Darija Explanations (Section 4 of Audit)
console.log('\n[4] generateDarijaExplanation tests:');
{
  const darijaCoinSpecific = generateDarijaExplanation(
    'Binance adds new BTC perpetual contract with 50x leverage',
    'Trading opens today with zero maker fee promotion',
    'Binance Official',
    'BTCUSDT',
    60,
    true,
    true // isCoinSpecific
  );

  assert(Boolean(darijaCoinSpecific.whatHappened && darijaCoinSpecific.whatHappened.length > 10), 'شنو وقع؟ is provided and non-empty');
  assert(Boolean(darijaCoinSpecific.whyImportant && darijaCoinSpecific.whyImportant.length > 10), 'علاش هاد الخبر مهم؟ is provided and non-empty');
  assert(Boolean(darijaCoinSpecific.sentimentVerdict && darijaCoinSpecific.sentimentVerdict.length > 10), 'واش الخبر إيجابي، سلبي، ولا محايد؟ is provided and non-empty');
  assert(Boolean(darijaCoinSpecific.priceImpact && darijaCoinSpecific.priceImpact.length > 10), 'واش ممكن يأثر على السعر؟ is provided and non-empty');
  assert(Boolean(darijaCoinSpecific.isConfirmedVsRumor && darijaCoinSpecific.isConfirmedVsRumor.length > 10), 'واش الخبر مؤكد ولا غير إشاعة؟ is provided and non-empty');
  assert(Boolean(darijaCoinSpecific.risksToWatch && darijaCoinSpecific.risksToWatch.length > 10), 'شنو المخاطر اللي خاص المتداول ينتبه ليها؟ is provided and non-empty');

  // Verify truthfulness when an article is general macro and NOT coin-specific
  const darijaMacro = generateDarijaExplanation(
    'Federal Reserve leaves interest rates unchanged at 5.25%',
    'Fed chairman signals cautious stance on monetary policy',
    'CoinDesk',
    'CHIPUSDT',
    0,
    true,
    false // isCoinSpecific = false
  );
  assert(darijaMacro.whatHappened.includes('Macro Crypto') || darijaMacro.whatHappened.includes('السوق العام'), 'Macro news truthfully clarifies in Darija that it does NOT directly name the altcoin');
  assert(darijaMacro.risksToWatch.includes('ما تاخدش خبر عام'), 'Darija risk warns trader never to use general Bitcoin news to buy an unrelated altcoin');
}

// 5. Tests for Trading Decision Integration & Confluence (Section 5 of Audit)
console.log('\n[5] combineTechnicalAndNewsVerdict trading decision tests:');
{
  const mockSetup: TradeSetup = {
    direction: 'LONG',
    pair: 'BTCUSDT',
    market: 'futures',
    entryPrice: 65000,
    entryZone: '64800 - 65100',
    stopLoss: 64000,
    invalidationCondition: 'Clôture 1H sous 64000',
    takeProfit1: 66500,
    takeProfit2: 67500,
    takeProfit3: 69000,
    riskRewardRatioTP1: 1.5,
    riskRewardRatioTP2: 2.5,
    riskRewardRatioTP3: 4.0,
    netRiskRewardRatioTP1: 1.4,
    netRiskRewardRatioTP2: 2.35,
    netRiskRewardRatioTP3: 3.85,
    grossGainPercentTP1: 2.3,
    netGainPercentTP1: 2.1,
    riskPercent: 1.54,
    unitRisk: 1000,
    unitGainTP1: 1500,
    unitGainTP2: 2500,
    unitGainTP3: 4000,
    estimatedFeesPercent: 0.12,
    estimatedSlippagePercent: 0.05,
    confirmedTimeframes: ['4H', '1H', '15M'],
    suggestedRiskPercent: 1.0,
    keyConfluences: ['Order block 4H', 'FVG 1H'],
    mainRisks: ['Haute volatilité'],
    dataTimestamp: Date.now(),
  };

  // Case 1: Bullish technical setup with positive confirmed news -> LONG
  const case1 = combineTechnicalAndNewsVerdict({
    technicalVerdict: 'LONG',
    technicalScore: 82,
    newsImpactScore: 55,
    setup: mockSetup,
    symbol: 'BTCUSDT',
    hasStaleData: false,
  });
  assert(case1.combinedVerdict === 'LONG', `Case 1: Bullish + Positive news -> LONG (got ${case1.combinedVerdict})`);
  assert(case1.confidenceScore >= 70, `Case 1: High confidence score (${case1.confidenceScore}%)`);

  // Case 2: Bullish setup with serious negative news (score <= -40) -> WAIT
  const case2 = combineTechnicalAndNewsVerdict({
    technicalVerdict: 'LONG',
    technicalScore: 85,
    newsImpactScore: -65, // Exploit / Lawsuit
    setup: mockSetup,
    symbol: 'BTCUSDT',
    hasStaleData: false,
  });
  assert(case2.combinedVerdict === 'WAIT', `Case 2: Bullish setup + Bad news -> MUST be WAIT (got ${case2.combinedVerdict})`);
  assert(case2.verdictRationale.includes('Conflit'), `Case 2: Explicitly explains conflict in French`);
  assert(case2.verdictRationaleDarija.includes('تعارض') || case2.verdictRationaleDarija.includes('WAIT'), `Case 2: Explicitly explains conflict in Darija`);

  // Case 3: Bearish setup with positive news (score >= +40) -> WAIT
  const shortSetup: TradeSetup = {
    ...mockSetup,
    direction: 'SHORT',
    entryPrice: 65000,
    stopLoss: 66000,
    takeProfit1: 63500,
    takeProfit2: 62500,
    takeProfit3: 61000,
  };
  const case3 = combineTechnicalAndNewsVerdict({
    technicalVerdict: 'SHORT',
    technicalScore: 78,
    newsImpactScore: 70, // ETF approval / major listing
    setup: shortSetup,
    symbol: 'BTCUSDT',
    hasStaleData: false,
  });
  assert(case3.combinedVerdict === 'WAIT', `Case 3: Bearish setup + Bullish news -> MUST be WAIT to prevent short squeeze (got ${case3.combinedVerdict})`);

  // Case 4: Neutral or irrelevant news (score = 0) with valid technical setup -> Retains technical verdict
  const case4 = combineTechnicalAndNewsVerdict({
    technicalVerdict: 'LONG',
    technicalScore: 80,
    newsImpactScore: 0,
    setup: mockSetup,
    symbol: 'CHIPUSDT',
    hasStaleData: false,
  });
  assert(case4.combinedVerdict === 'LONG', `Case 4: Neutral news + valid setup retains LONG based on pure technical action`);

  // Case 5: Rumors without reliable confirmation -> Muted impact, does not trigger false conflict
  const case5 = combineTechnicalAndNewsVerdict({
    technicalVerdict: 'LONG',
    technicalScore: 80,
    newsImpactScore: -15, // Muted rumor impact
    setup: mockSetup,
    symbol: 'BTCUSDT',
    hasStaleData: false,
  });
  assert(case5.combinedVerdict === 'LONG', `Case 5: Minor unconfirmed rumor does not derail valid technical setup`);

  // Case 6: Stale market prices (hasStaleData = true) -> Strictly NO_TRADE
  const case6 = combineTechnicalAndNewsVerdict({
    technicalVerdict: 'LONG',
    technicalScore: 95,
    newsImpactScore: 80,
    setup: mockSetup,
    symbol: 'BTCUSDT',
    hasStaleData: true,
  });
  assert(case6.combinedVerdict === 'NO_TRADE', `Case 6: Stale price stream strictly forces NO_TRADE`);
  assert(case6.confidenceScore === 0, `Case 6: Stale data forces 0% confidence`);

  // Case 7: Missing technical structure / No setup -> Strictly NO_TRADE (News alone NEVER creates an entry)
  const case7 = combineTechnicalAndNewsVerdict({
    technicalVerdict: 'NO_TRADE',
    technicalScore: 25,
    newsImpactScore: 90, // Massive breaking positive news
    setup: undefined,
    symbol: 'BTCUSDT',
    hasStaleData: false,
  });
  assert(case7.combinedVerdict === 'NO_TRADE', `Case 7: Super-bullish news alone CANNOT trigger trade without technical setup`);

  // Case 8: Bearish technical setup with negative news -> SHORT
  const case8 = combineTechnicalAndNewsVerdict({
    technicalVerdict: 'SHORT',
    technicalScore: 82,
    newsImpactScore: -45,
    setup: shortSetup,
    symbol: 'BTCUSDT',
    hasStaleData: false,
  });
  assert(case8.combinedVerdict === 'SHORT', `Case 8: Bearish setup + Bearish news -> SHORT with fundamental confluence`);
}

console.log(`\n======================================================`);
console.log(`AUDIT TEST RESULTS: ${passed} passed, ${failed} failed`);
console.log(`======================================================\n`);

if (failed > 0) {
  process.exit(1);
}
