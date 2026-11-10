const MAWDOO3_ORIGIN = "https://mawdoo3.com";
const LISTING_PAGES = [
  `${MAWDOO3_ORIGIN}/خاص:أجدد_الصفحات`,
  `${MAWDOO3_ORIGIN}/خاص:الصفحات_الأكثر_مشاهدة`,
];
const CACHE_TTL_MS = 15 * 60_000;
const MAX_LISTING_BYTES = 2 * 1024 * 1024;

let cachedArticles = null;
let cacheExpiresAt = 0;
let pendingFetch = null;

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_match, digits) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([\da-f]+);/gi, (_match, hex) => String.fromCodePoint(parseInt(hex, 16)));
}

function titleFromPath(pathname) {
  const segment = String(pathname || "").split("/").filter(Boolean).at(-1) || "";
  try {
    return decodeHtmlEntities(decodeURIComponent(segment).replace(/_/g, " "))
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return "";
  }
}

function normalizeArabic(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLocaleLowerCase("ar")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseMawdoo3Listing(html, baseUrl = MAWDOO3_ORIGIN) {
  const articles = new Map();
  const anchorPattern = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/a>/giu;

  for (const match of String(html || "").matchAll(anchorPattern)) {
    const rawHref = decodeHtmlEntities(match[1] || match[2] || "").trim();
    if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("javascript:")) continue;

    let url;
    try {
      url = new URL(rawHref, baseUrl);
    } catch {
      continue;
    }

    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.hostname.toLowerCase() !== "mawdoo3.com" ||
      url.username ||
      url.password ||
      url.port
    ) continue;

    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length !== 1) continue;
    const title = titleFromPath(url.pathname);
    if (
      title.length < 4 ||
      title.length > 180 ||
      /^(خاص|تصنيف|special|category):/iu.test(title) ||
      /^(index\.php|api\.php)$/iu.test(title)
    ) continue;

    url.protocol = "https:";
    url.search = "";
    url.hash = "";
    const canonicalUrl = url.href;
    if (!articles.has(canonicalUrl)) articles.set(canonicalUrl, { title, url: canonicalUrl });
    if (articles.size >= 1_000) break;
  }

  return [...articles.values()];
}

export function matchesMawdoo3Topic(title, topic) {
  const normalizedTitle = normalizeArabic(title);
  const normalizedTopic = normalizeArabic(topic);
  if (!normalizedTitle || normalizedTopic.length < 2) return false;

  const story = /(?:قصه|قصص|حكايه|حكايات|روايه|روايات)/u;
  const love = /(?:حب|عاطفيه|رومانسيه|غرام)/u;
  const jokes = /(?:نكت|نكات|طرائف|فكاهه|مزاح|مضحك|مضحكه)/u;

  if (/(?:نكت|نكات|طرائف|فكاهه|مزاح)/u.test(normalizedTopic)) return jokes.test(normalizedTitle);
  if (normalizedTopic.includes("حب") && story.test(normalizedTopic)) {
    return story.test(normalizedTitle) && love.test(normalizedTitle);
  }
  if (story.test(normalizedTopic)) return story.test(normalizedTitle);
  return normalizedTitle.includes(normalizedTopic);
}

async function fetchListingPage(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; GroupBot/1.0)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`تعذّر جلب قائمة موضوع (${response.status})`);
  const contentLength = Number(response.headers?.get?.("content-length") || 0);
  if (contentLength > MAX_LISTING_BYTES) throw new Error("حجم قائمة موضوع أكبر من الحد المسموح");
  const html = await response.text();
  if (Buffer.byteLength(html, "utf8") > MAX_LISTING_BYTES) {
    throw new Error("حجم قائمة موضوع أكبر من الحد المسموح");
  }
  return parseMawdoo3Listing(html, url);
}

export async function getMawdoo3Articles({ fetchImpl = globalThis.fetch, forceRefresh = false } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("الجلب من موضوع غير متاح في بيئة التشغيل");
  if (!forceRefresh && cachedArticles && cacheExpiresAt > Date.now()) return cachedArticles.map((article) => ({ ...article }));
  if (pendingFetch) return (await pendingFetch).map((article) => ({ ...article }));

  pendingFetch = (async () => {
    const results = await Promise.allSettled(LISTING_PAGES.map((url) => fetchListingPage(url, fetchImpl)));
    const articles = new Map();
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      for (const article of result.value) {
        if (!articles.has(article.url)) articles.set(article.url, article);
      }
    }
    if (!articles.size) {
      const failures = results.filter((result) => result.status === "rejected");
      const detail = failures[0]?.reason?.message;
      throw new Error(detail || "لم يعرض موقع موضوع أي عناوين عامة قابلة للاستخدام حالياً");
    }
    cachedArticles = [...articles.values()];
    cacheExpiresAt = Date.now() + CACHE_TTL_MS;
    return cachedArticles;
  })();

  try {
    return (await pendingFetch).map((article) => ({ ...article }));
  } finally {
    pendingFetch = null;
  }
}

export async function findNextMawdoo3Article(topic, {
  seenUrls = [],
  fetchImpl = globalThis.fetch,
  forceRefresh = false,
} = {}) {
  const normalizedTopic = String(topic || "").trim();
  if (normalizedTopic.length < 2 || normalizedTopic.length > 60) {
    throw new Error("اكتب موضوعاً من حرفين إلى 60 حرفاً");
  }

  const seen = new Set((Array.isArray(seenUrls) ? seenUrls : []).map((url) => String(url)));
  const candidates = (await getMawdoo3Articles({ fetchImpl, forceRefresh }))
    .filter((article) => matchesMawdoo3Topic(article.title, normalizedTopic));
  const article = candidates.find((candidate) => !seen.has(candidate.url));
  if (!article) {
    throw new Error(
      candidates.length
        ? `لا يوجد عنوان جديد غير مكرر لموضوع «${normalizedTopic}» حالياً`
        : `لم يعثر موقع موضوع على عنوان مناسب لموضوع «${normalizedTopic}» في القوائم العامة الحالية`
    );
  }
  return { ...article };
}

export function clearMawdoo3Cache() {
  cachedArticles = null;
  cacheExpiresAt = 0;
  pendingFetch = null;
}
