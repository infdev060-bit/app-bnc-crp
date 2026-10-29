import { CryptoNewsItem, NewsIntelligenceSummary, TradeSetup } from '../types/crypto';

/**
 * Keywords for sentiment and impact analysis
 */
const BULLISH_KEYWORDS = [
  'etf', 'approval', 'approved', 'partnership', 'record high', 'all-time high', 'ath', 'breakout',
  'bullish', 'surge', 'rally', 'adoption', 'launch', 'listing', 'adds', 'upgrade', 'mainnet',
  'institutional', 'inflow', 'holding', 'reserves', 'integration', 'collateral', 'staking', 'milestone',
  'jump', 'jumps', 'climbs', 'skyrockets'
];

const BEARISH_KEYWORDS = [
  'hack', 'exploit', 'stolen', 'sec lawsuit', 'lawsuit', 'ban', 'banned', 'investigation',
  'indictment', 'fraud', 'arrest', 'scam', 'drain', 'rugpull', 'delisting', 'outflow',
  'crash', 'plunge', 'bearish', 'liquidated', 'liquidation', 'insolvency', 'bankruptcy', 'vulnerability'
];

const RUMOR_KEYWORDS = [
  'rumor', 'rumours', 'alleged', 'speculation', 'unconfirmed', 'sources claim', 'reportedly', 'may consider', 'could face'
];

/**
 * Calculate transparent News Impact Score (-100 to +100)
 */
export function calculateNewsImpactScore(item: {
  title: string;
  description?: string;
  source: string;
  isOfficial?: boolean;
  publishedAt?: number;
}): { impactScore: number; sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; isConfirmed: boolean; impactLabel: 'FORTEMENT_POSITIF' | 'POSITIF' | 'NEUTRE' | 'NEGATIF' | 'FORTEMENT_NEGATIF' } {
  const text = `${item.title} ${item.description || ''}`.toLowerCase();

  let bullScore = 0;
  let bearScore = 0;

  for (const kw of BULLISH_KEYWORDS) {
    if (text.includes(kw)) bullScore += kw === 'etf' || kw === 'approved' || kw === 'partnership' ? 25 : 15;
  }

  for (const kw of BEARISH_KEYWORDS) {
    if (text.includes(kw)) bearScore += kw === 'hack' || kw === 'exploit' || kw === 'lawsuit' || kw === 'delisting' ? 30 : 18;
  }

  // Check if rumor vs confirmed
  let isRumor = false;
  for (const rk of RUMOR_KEYWORDS) {
    if (text.includes(rk)) {
      isRumor = true;
      break;
    }
  }

  const isConfirmed = item.isOfficial === true || (!isRumor && (item.source.includes('Binance') || item.source.includes('CoinDesk')));

  let rawScore = bullScore - bearScore;

  // Rumors have muted market impact
  if (!isConfirmed) {
    rawScore = Math.round(rawScore * 0.5);
  }

  // Official source boost
  if (item.isOfficial) {
    rawScore = rawScore >= 0 ? Math.min(100, rawScore + 20) : Math.max(-100, rawScore - 20);
  }

  // Freshness decay factor (if published > 48h ago, impact is dampened as market likely priced it in)
  if (item.publishedAt) {
    const ageHours = (Date.now() - item.publishedAt) / (1000 * 60 * 60);
    if (ageHours > 48) {
      rawScore = Math.round(rawScore * 0.4);
    } else if (ageHours > 24) {
      rawScore = Math.round(rawScore * 0.7);
    }
  }

  // Clamp -100 to +100
  const impactScore = Math.max(-100, Math.min(100, rawScore));

  let sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  let impactLabel: 'FORTEMENT_POSITIF' | 'POSITIF' | 'NEUTRE' | 'NEGATIF' | 'FORTEMENT_NEGATIF' = 'NEUTRE';

  if (impactScore >= 50) {
    sentiment = 'BULLISH';
    impactLabel = 'FORTEMENT_POSITIF';
  } else if (impactScore >= 15) {
    sentiment = 'BULLISH';
    impactLabel = 'POSITIF';
  } else if (impactScore <= -50) {
    sentiment = 'BEARISH';
    impactLabel = 'FORTEMENT_NEGATIF';
  } else if (impactScore <= -15) {
    sentiment = 'BEARISH';
    impactLabel = 'NEGATIF';
  } else {
    sentiment = 'NEUTRAL';
    impactLabel = 'NEUTRE';
  }

  return { impactScore, sentiment, isConfirmed, impactLabel };
}

/**
 * Common English dictionary words that collide with crypto tickers.
 * For these symbols, naive substring matching will produce false positives.
 * We require explicit token notation (e.g. $CHIP, CHIP/USDT, #CHIP) or project-specific names.
 */
const WORD_COLLISION_TICKERS = new Set([
  'SOL', 'NEAR', 'DOT', 'LINK', 'CHIP', 'GAS', 'ONE', 'APT', 'PEPE', 'KEY', 'TIME', 'SUN', 'HOT', 'FOR', 'MANA', 'ATOM'
]);

/**
 * Project name mappings for unambiguous cryptocurrency entity resolution.
 */
const PROJECT_NAMES_MAP: Record<string, string[]> = {
  BTC: ['bitcoin', 'satoshi', 'btc'],
  ETH: ['ethereum', 'vitalik', 'ether', 'eth'],
  SOL: ['solana'],
  XRP: ['ripple', 'xrp', 'xrpledger'],
  BNB: ['binance coin', 'bnb chain', 'build and build'],
  DOGE: ['dogecoin', 'doge', 'shiba inu'],
  ADA: ['cardano', 'charles hoskinson', 'ada'],
  AVAX: ['avalanche', 'avax'],
  SUI: ['sui network', 'mysten labs', 'sui blockchain'],
  LINK: ['chainlink', 'chain link', 'smartcontract'],
  DOT: ['polkadot', 'gavin wood'],
  NEAR: ['near protocol', 'near foundation'],
  APT: ['aptos', 'aptos labs'],
  PEPE: ['pepe coin', 'pepe memecoin', '$pepe'],
  CHIP: ['chip token', '$chip', '#chip', 'chipusdt', 'chip/usdt'],
  ZEC: ['zcash', 'electric coin company', 'zec', '$zec', '#zec', 'zecusdt', 'zec/usdt'],
};

/**
 * Checks if a news item genuinely matches the target cryptocurrency without false positives.
 */
export function isArticleMatchingCoin(
  title: string,
  description: string,
  baseAsset: string
): boolean {
  const cleanAsset = baseAsset.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleanAsset) return false;
  const fullText = `${title} ${description || ''}`;

  // 1. Explicit ticker match (e.g. "$BTC", "#BTC", "BTCUSDT", "BTC/USDT", "BTC-PERP")
  const explicitTickerPatterns = [
    new RegExp(`(?:\\$|#)${cleanAsset}\\b`, 'i'),
    new RegExp(`\\b${cleanAsset}(?:USDT|USD|BUSD|BTC|EUR|PERP)\\b`, 'i'),
    new RegExp(`\\b${cleanAsset}\\/(?:USDT|USD|BUSD|BTC)\\b`, 'i'),
  ];

  for (const regex of explicitTickerPatterns) {
    if (regex.test(fullText)) return true;
  }

  // 2. Project name resolution
  const projectAliases = PROJECT_NAMES_MAP[cleanAsset];
  if (projectAliases && projectAliases.length > 0) {
    const lower = fullText.toLowerCase();
    for (const alias of projectAliases) {
      if (lower.includes(alias.toLowerCase())) {
        return true;
      }
    }
  }

  // 3. For tickers that DO NOT collide with regular English vocabulary, match whole word
  if (!WORD_COLLISION_TICKERS.has(cleanAsset)) {
    const standaloneRegex = new RegExp(`\\b${cleanAsset}\\b`, 'i');
    if (standaloneRegex.test(fullText)) {
      return true;
    }
  }

  return false;
}

/**
 * Detect duplicate coverage of the exact same event across multiple outlets using Jaccard word similarity
 */
export function isSimilarStory(titleA: string, titleB: string): boolean {
  const stopWords = new Set(['the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'were', 'what', 'here', 'will', 'adds', 'over', 'into', 'about']);
  
  const stem = (w: string) => w.replace(/(ing|edly|edly|ed|es|s)$/, '');

  const wordsA = new Set(
    titleA
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w))
      .map(stem)
  );
  const wordsB = new Set(
    titleB
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w))
      .map(stem)
  );

  if (wordsA.size === 0 || wordsB.size === 0) return false;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }

  const union = new Set([...wordsA, ...wordsB]).size;
  const similarity = intersection / union;
  return similarity >= 0.40; // 40% stemmed token overlap reliably groups cross-outlet duplicate coverage of the same event
}

/**
 * Generate natural Moroccan Darija explanation for an individual news article
 */
export function generateDarijaExplanation(
  title: string,
  description: string,
  source: string,
  coin: string,
  impactScore: number,
  isConfirmed: boolean,
  isCoinSpecific: boolean = true
): {
  whatHappened: string;
  whyImportant: string;
  sentimentVerdict: string;
  priceImpact: string;
  isConfirmedVsRumor: string;
  risksToWatch: string;
} {
  const text = `${title} ${description}`.toLowerCase();
  const baseAsset = coin.replace('USDT', '').toUpperCase();

  // If the news does not actually mention this altcoin, truthfully clarify that it is general macro news
  if (!isCoinSpecific) {
    return {
      whatHappened: `هاد الخبر كيتعلق بالسوق العام ديال الكريبتو (Macro Crypto / Bitcoin) وما كيذكرش بالاسم عملة ${baseAsset}. العنوان الأصلي: "${title}".`,
      whyImportant: `الخبر ما كيهضرش على ${baseAsset} مباشرة، ولكن كيعطي فكرة للمتداول على السيولة العامة وتوجه السوق (Market Sentiment).`,
      sentimentVerdict: `الخبر عندو طابع عام على الماكرو. التأثير المباشر على ${baseAsset} غير مؤكد وخاص الاعتماد الأساسي على الشارت التقني.`,
      priceImpact: `تأثير غير مباشر عبر تحركات البيتكوين والسيولة العامة، ما كاينش محفز أو خطر خاص بـ ${baseAsset} في هاد الخبر.`,
      isConfirmedVsRumor: isConfirmed
        ? `الخبر العام مؤكد وموثوق من (${source})، ولكن ما كيتعلقش مباشرة بـ ${baseAsset}.`
        : `خبر عام أو تكهنات في السوق ما فيهاش تأكيد رسمي.`,
      risksToWatch: `رد البال: ما تاخدش خبر عام على البيتكوين أو السوق كإشارة شراء أو بيع لعملة ${baseAsset} بلا ما تشوف الشارت ومستويات الدعم ديالها.`,
    };
  }

  // 1. شنو وقع؟ (Coin-specific)
  let whatHappened = `المصدر ${source} نشر خبر كيتعلق مباشرة بتحركات وتطورات عملة ${baseAsset}. العنوان الأصلي: "${title}".`;
  if (text.includes('etf') || text.includes('approval') || text.includes('sec')) {
    whatHappened = `كاين جديد قانوني ومؤسساتي كيتعلق بصناديق الاستثمار (ETFs) أو قرارات هيئة البورصة بخصوص ${baseAsset}.`;
  } else if (text.includes('binance') && (text.includes('adds') || text.includes('listing') || text.includes('launch'))) {
    whatHappened = `بينانس (Binance) علنات رسمياً على إدراج أو إضافة خدمات تداول جديدة وعقود جديدة كتشمل ${baseAsset}.`;
  } else if (text.includes('hack') || text.includes('exploit') || text.includes('vulnerability')) {
    whatHappened = `تم الإبلاغ على ثغرة أمنية أو اختراق محتمل (Exploit/Security Incident) كيأثر على الشبكة أو المنصات المرتبطة بـ ${baseAsset}.`;
  } else if (text.includes('upgrade') || text.includes('mainnet') || text.includes('hard fork')) {
    whatHappened = `فريق تطوير ${baseAsset} كيقوم بتحديث تقني رئيسي على البلوكشين (Network Upgrade / Mainnet) لتحسين الأداء.`;
  } else if (text.includes('partnership') || text.includes('collaboration')) {
    whatHappened = `شراكة استراتيجية جديدة تم الإعلان عليها لدعم البنية التحتية والاعتماد المؤسساتي لعملة ${baseAsset}.`;
  }

  // 2. علاش هاد الخبر مهم؟
  let whyImportant = `هاد الخبر كيعطي رؤية للمتداولين حول رغبة المستثمرين والسيولة المتدفقة على ${baseAsset}.`;
  if (impactScore > 30) {
    whyImportant = `هاد الخبر كيجلب سيولة جديدة وثقة كبيرة عند الحيتان والمؤسسات، الشي اللي كيدعم الطلب على ${baseAsset}.`;
  } else if (impactScore < -30) {
    whyImportant = `هاد النوع ديال الأخبار كيخلق الخوف (FUD) والذعر في السوق، وممكن يدفع بعض المستثمرين لتصريف وبيع محافظهم.`;
  }

  // 3. واش الخبر إيجابي، سلبي، ولا محايد؟
  let sentimentVerdict = 'الخبر محايد (Neutral) وما كيحملش تأثير أحادي قوي، خاص مراقبة تفاعل حجم التداول.';
  if (impactScore >= 50) {
    sentimentVerdict = 'الخبر إيجابي بزاف (Fortement Haussier / Bullish) وكيعطي دافع قوي للصعود.';
  } else if (impactScore >= 15) {
    sentimentVerdict = 'الخبر إيجابي (Haussier / Bullish) ومعنويات المتداولين متفائلة نسبياً.';
  } else if (impactScore <= -50) {
    sentimentVerdict = 'الخبر سلبي بزاف (Fortement Baissier / Bearish) وخاص الحذر الشديد من هبوط مفاجئ.';
  } else if (impactScore <= -15) {
    sentimentVerdict = 'الخبر سلبي (Baissier / Bearish) وكيميل للضغط على السعر نحو الأسفل.';
  }

  // 4. واش ممكن يأثر على السعر على المدى القصير أو المتوسط؟
  let priceImpact = 'تأثير محدود على المدى القصير، السعر غادي يتبع بالأساس حركة الشموع والتحليل التقني SMC.';
  if (Math.abs(impactScore) >= 50) {
    priceImpact = 'ممكن يدير حركة سريعة وتقلبات قوية (Volatilité Élevée) في الساعات القادمة، مع إمكانية استمرار الأثر على المدى المتوسط.';
  } else if (Math.abs(impactScore) >= 20) {
    priceImpact = 'يقدر يحرك السعر بشكل تدريجي ويختبر مناطق الدعم أو المقاومة القريبة.';
  }

  // 5. واش الخبر مؤكد ولا غير إشاعة؟
  let isConfirmedVsRumor = isConfirmed
    ? `الخبر مؤكد رسمياً وموثوق من مصدر معروف (${source}).`
    : `الخبر ما زال غير مؤكد بشكل قطعي (يقدر يكون غير إشاعة أو تكهنات في السوق)، ما تاخدش بيه كحقيقة تامة.`;

  // 6. شنو المخاطر اللي خاص المتداول ينتبه ليها؟
  let risksToWatch = 'رد فعل السوق يقدر يكون محسوب مسبقاً (Priced in). ما تدخلش في صفقات عشوائية بلا Stop Loss واضح.';
  if (impactScore < -20) {
    risksToWatch = 'خطر استمرار الضغط البيعي وكسر مناطق الدعم. رد البال من الشموع الهابطة القوية ووقف الخسارة إجباري.';
  } else if (impactScore > 20) {
    risksToWatch = 'خطر الدخول المتأخر من بعد ما يكون السعر طلع بزاف (FOMO)، ومصيدة المشترين (Bull Trap) قبل التصحيح.';
  }

  return {
    whatHappened,
    whyImportant,
    sentimentVerdict,
    priceImpact,
    isConfirmedVsRumor,
    risksToWatch,
  };
}

/**
 * Combine Technical Analysis (SMC/MTF) with News Intelligence to yield final trade verdict
 */
export function combineTechnicalAndNewsVerdict(params: {
  technicalVerdict: 'LONG' | 'SHORT' | 'NO_TRADE';
  technicalScore: number;
  newsImpactScore: number;
  setup?: TradeSetup;
  symbol: string;
  hasStaleData?: boolean;
}): {
  combinedVerdict: 'LONG' | 'SHORT' | 'WAIT' | 'NO_TRADE';
  verdictRationale: string;
  verdictRationaleDarija: string;
  confidenceScore: number;
} {
  const { technicalVerdict, technicalScore, newsImpactScore, setup, symbol, hasStaleData } = params;
  const baseAsset = symbol.replace('USDT', '');

  // Strict safety guards
  if (hasStaleData) {
    return {
      combinedVerdict: 'NO_TRADE',
      verdictRationale: 'Données de marché obsolètes ou déconnectées. Prise de position strictement interdite pour protéger le capital.',
      verdictRationaleDarija: 'البيانات ديال السوق قديمة أو مقطوعة. ممنوع الدخول في أي صفقة حتى يرجع الاتصال المباشر باش تحمي راس مالك.',
      confidenceScore: 0,
    };
  }

  // Check if setup data timestamp is expired (> 90 seconds)
  const isSetupExpired = setup && setup.dataTimestamp && (Date.now() - setup.dataTimestamp > 90000);
  if (isSetupExpired) {
    return {
      combinedVerdict: 'NO_TRADE',
      verdictRationale: 'Configuration de trading expirée (horodatage > 90s). Recalcul impératif sur les cotations fraîches.',
      verdictRationaleDarija: 'فرصة التداول انتهت صلاحيتها (فاتت 90 ثانية). خاص إعادة الحساب على الأسعار الحية الحالية.',
      confidenceScore: 0,
    };
  }

  if (technicalVerdict === 'NO_TRADE' || !setup) {
    return {
      combinedVerdict: 'NO_TRADE',
      verdictRationale: 'Conditions techniques SMC insuffisantes (absence de configuration nette ou ratio R/R défavorable). Préservation du capital.',
      verdictRationaleDarija: `الشروط التقنية (SMC) ما كاملينش على ${baseAsset}. السوق ما كيعطيش فرصة واضحة بنسبة عائد/مخاطرة زوينة، من الأفضل البقاء خارج السوق.`,
      confidenceScore: Math.min(technicalScore, 40),
    };
  }

  // Conflict detection: Technical LONG vs Very Bearish News
  if (technicalVerdict === 'LONG' && newsImpactScore <= -40) {
    return {
      combinedVerdict: 'WAIT',
      verdictRationale: `Conflit majeur : le setup technique SMC est HAUSSIER mais l'impact des actualités récentes est fortement NÉGATIF (${newsImpactScore}/100). Risque élevé de piège haussier. Attendre l'absorption des flux vendeurs.`,
      verdictRationaleDarija: `كاين تعارض واضح: التحليل التقني كيقول صعود (LONG)، ولكن الأخبار سلبية بزاف (${newsImpactScore}/100). كاين خطر ديال مصيدة المشترين، من الأحسن تريّث وتسنّى حتى يهدأ السوق (WAIT).`,
      confidenceScore: 35,
    };
  }

  // Conflict detection: Technical SHORT vs Very Bullish News
  if (technicalVerdict === 'SHORT' && newsImpactScore >= 40) {
    return {
      combinedVerdict: 'WAIT',
      verdictRationale: `Conflit majeur : le setup technique SMC est BAISSIER mais l'impact des actualités récentes est fortement POSITIF (+${newsImpactScore}/100). Risque élevé de short squeeze. Attendre l'épuisement du momentum acheteur.`,
      verdictRationaleDarija: `كاين تعارض: التحليل التقني كيقول هبوط (SHORT)، ولكن كاينين أخبار إيجابية قوية (+${newsImpactScore}/100) تقدر تدير تصفية للشورت (Short Squeeze). انتظر وماتزربش (WAIT).`,
      confidenceScore: 35,
    };
  }

  // Alignment: Technical LONG + Neutral/Positive News
  if (technicalVerdict === 'LONG') {
    const confidence = Math.min(95, Math.round(technicalScore * 0.7 + (newsImpactScore >= 0 ? newsImpactScore * 0.3 : 0)));
    return {
      combinedVerdict: 'LONG',
      verdictRationale: `Confluence validée : structure technique SMC haussière confirmée, alignement MTF et actualités favorables ou neutres (${newsImpactScore >= 0 ? '+' : ''}${newsImpactScore}/100). Trade validé avec gestion du risque stricte.`,
      verdictRationaleDarija: `فرصة شراء مواتية (LONG): الشارت كيعطي إشارة صعودية نقية (SMC) والأخبار متماشية أو محايدة (${newsImpactScore >= 0 ? '+' : ''}${newsImpactScore}/100). توكل على الله مع احترام الـ Stop Loss بدقة.`,
      confidenceScore: confidence,
    };
  }

  // Alignment: Technical SHORT + Neutral/Negative News
  if (technicalVerdict === 'SHORT') {
    const confidence = Math.min(95, Math.round(technicalScore * 0.7 + (newsImpactScore <= 0 ? Math.abs(newsImpactScore) * 0.3 : 0)));
    return {
      combinedVerdict: 'SHORT',
      verdictRationale: `Confluence validée : structure technique SMC baissière confirmée, alignement MTF et actualités baissières ou neutres (${newsImpactScore}/100). Trade validé avec gestion du risque stricte.`,
      verdictRationaleDarija: `فرصة بيع مواتية (SHORT): الهيكل التقني هابط ومؤكد، والأخبار كتضغط سلبياً أو محايدة (${newsImpactScore}/100). الدخول مبرر مع حماية الصفقة بـ Stop Loss صارم.`,
      confidenceScore: confidence,
    };
  }

  return {
    combinedVerdict: 'NO_TRADE',
    verdictRationale: 'Conditions de marché incertaines. Préservation du capital.',
    verdictRationaleDarija: 'السوق غير مستقر حالياً، التريث وحماية المحفظة هو القرار الحكيم.',
    confidenceScore: 30,
  };
}
