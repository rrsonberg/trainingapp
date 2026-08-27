/**
 * Food lookup — barcode and search.
 *
 * MyFitnessPal's API is closed to new partners, so this does not wrap it. It
 * goes to the same sources MFP itself uses for generic foods (USDA) plus the
 * open branded database (Open Food Facts), and normalises both into one shape.
 *
 * Everything returned is per 100 g / 100 ml in KILOJOULES, matching
 * nutrition_targets and food_items. The conversion happens here, once, at the
 * boundary — no screen should ever see a kcal figure from a provider.
 *
 * Nothing here writes. Callers cache the result into food_items, which is what
 * makes the second scan of the same barcode instant and free.
 */

const KCAL_TO_KJ = 4.184;

/** Open Food Facts asks every client to identify itself. Theirs is a free,
 *  volunteer-run database; an anonymous scraper is how apps get blocked. */
const USER_AGENT = 'TrainingApp/1.0 (support@yourdomain.com)';

/** DEMO_KEY works for development but is rate limited hard and shared with
 *  every other developer using it. Get a free key at api.data.gov. */
const USDA_KEY = process.env.EXPO_PUBLIC_USDA_API_KEY ?? 'DEMO_KEY';

const OFF_BASE = 'https://world.openfoodfacts.org';
const USDA_BASE = 'https://api.nal.usda.gov/fdc/v1';

export type FoodSource = 'usda' | 'off' | 'nutritionix' | 'fatsecret' | 'custom';

/** The shape food_items stores. Insert this straight into the catalogue. */
export type FoodResult = {
  source: FoodSource;
  sourceRef: string | null;
  barcode: string | null;
  name: string;
  brand: string | null;
  basis: 'per_100g' | 'per_100ml';
  energyKj: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sugarG: number | null;
  sodiumMg: number | null;
  servingLabel: string | null;
  servingG: number | null;
  /** USDA data is government-curated; Open Food Facts is crowd-sourced. The
   *  coach reviewing a macro breakdown deserves to know which one this is. */
  verified: boolean;
};

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** A timeout, because a hanging fetch in a barcode scanner reads as a crash. */
async function getJson(url: string, ms = 8000): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Lookup failed (${res.status})`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Open Food Facts — branded products and barcodes.
// ---------------------------------------------------------------------------

function fromOff(product: any): FoodResult | null {
  const n = product?.nutriments ?? {};
  if (!product?.product_name) return null;

  // OFF sometimes gives kJ directly and sometimes only kcal. Prefer the kJ.
  const kj =
    num(n['energy-kj_100g']) ??
    (num(n['energy-kcal_100g']) != null ? num(n['energy-kcal_100g'])! * KCAL_TO_KJ : null);
  if (kj == null) return null; // A food with no energy value is not usable.

  const servingG = num(product.serving_quantity);

  return {
    source: 'off',
    sourceRef: product.code ?? null,
    barcode: product.code ?? null,
    name: String(product.product_name).trim(),
    brand: product.brands ? String(product.brands).split(',')[0].trim() : null,
    basis: 'per_100g',
    energyKj: Math.round(kj * 100) / 100,
    proteinG: num(n.proteins_100g),
    carbsG: num(n.carbohydrates_100g),
    fatG: num(n.fat_100g),
    fiberG: num(n.fiber_100g),
    sugarG: num(n.sugars_100g),
    sodiumMg: num(n.sodium_100g) != null ? num(n.sodium_100g)! * 1000 : null,
    servingLabel: product.serving_size ?? null,
    servingG: servingG && servingG > 0 ? servingG : null,
    verified: false,
  };
}

/** Barcode lookup. Returns null when the product is not in the database —
 *  which is common enough that the UI must handle it gracefully, not error. */
export async function lookupBarcode(barcode: string): Promise<FoodResult | null> {
  const clean = barcode.replace(/\D/g, '');
  if (clean.length < 8) return null;

  const data = await getJson(`${OFF_BASE}/api/v2/product/${clean}.json`);
  if (data?.status !== 1 || !data?.product) return null;
  return fromOff(data.product);
}

async function searchOff(query: string, limit: number): Promise<FoodResult[]> {
  const url =
    `${OFF_BASE}/cgi/search.pl?search_terms=${encodeURIComponent(query)}` +
    `&search_simple=1&action=process&json=1&page_size=${limit}`;
  const data = await getJson(url);
  return (data?.products ?? []).map(fromOff).filter(Boolean) as FoodResult[];
}

// ---------------------------------------------------------------------------
// USDA FoodData Central — generic foods, and the accuracy advantage.
//
// This is the same public-domain source MFP uses for generic entries, but
// unmediated by their user-submitted layer. Leaning on it is what lets us
// claim tighter macros honestly.
// ---------------------------------------------------------------------------

const USDA_NUTRIENTS: Record<number, keyof FoodResult> = {
  1008: 'energyKj', // kcal — converted below
  1003: 'proteinG',
  1005: 'carbsG',
  1004: 'fatG',
  1079: 'fiberG',
  2000: 'sugarG',
  1093: 'sodiumMg',
};

function fromUsda(food: any): FoodResult | null {
  if (!food?.description) return null;

  const out: Partial<FoodResult> = {};
  let kcal: number | null = null;

  for (const n of food.foodNutrients ?? []) {
    const id = n.nutrientId ?? n.nutrient?.id;
    const value = num(n.value ?? n.amount);
    if (id == null || value == null) continue;
    if (id === 1008) { kcal = value; continue; }
    const key = USDA_NUTRIENTS[id];
    if (key) (out as any)[key] = value;
  }

  if (kcal == null) return null;

  return {
    source: 'usda',
    sourceRef: String(food.fdcId),
    barcode: food.gtinUpc ?? null,
    name: String(food.description).trim(),
    brand: food.brandOwner ?? food.brandName ?? null,
    basis: 'per_100g', // USDA abridged results are per 100 g.
    energyKj: Math.round(kcal * KCAL_TO_KJ * 100) / 100,
    proteinG: (out.proteinG as number) ?? null,
    carbsG: (out.carbsG as number) ?? null,
    fatG: (out.fatG as number) ?? null,
    fiberG: (out.fiberG as number) ?? null,
    sugarG: (out.sugarG as number) ?? null,
    sodiumMg: (out.sodiumMg as number) ?? null,
    servingLabel: food.servingSizeUnit
      ? `${food.servingSize ?? ''}${food.servingSizeUnit}`.trim()
      : null,
    servingG: num(food.servingSize),
    verified: true,
  };
}

async function searchUsda(query: string, limit: number): Promise<FoodResult[]> {
  const url =
    `${USDA_BASE}/foods/search?api_key=${USDA_KEY}` +
    `&query=${encodeURIComponent(query)}&pageSize=${limit}` +
    `&dataType=Foundation,SR%20Legacy,Branded`;
  const data = await getJson(url);
  return (data?.foods ?? []).map(fromUsda).filter(Boolean) as FoodResult[];
}

// ---------------------------------------------------------------------------
// Search.
// ---------------------------------------------------------------------------

/**
 * Both sources in parallel, USDA first in the list because its numbers are
 * better. One provider failing must not take the search down — a coach's
 * client standing in a kitchen does not care which API is having a bad day.
 */
export async function searchFoods(query: string, limit = 20): Promise<FoodResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const half = Math.max(5, Math.floor(limit / 2));
  const [usda, off] = await Promise.allSettled([
    searchUsda(q, half),
    searchOff(q, half),
  ]);

  const results: FoodResult[] = [];
  if (usda.status === 'fulfilled') results.push(...usda.value);
  if (off.status === 'fulfilled') results.push(...off.value);

  if (results.length === 0) {
    // Both failed — say so, rather than showing an empty state that reads as
    // "this food does not exist".
    if (usda.status === 'rejected' && off.status === 'rejected') {
      throw new Error('Could not reach the food database. Check your connection.');
    }
  }

  // Same product from both sources: keep the USDA one.
  const seen = new Set<string>();
  return results.filter((r) => {
    const key = `${r.name.toLowerCase()}|${(r.brand ?? '').toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Portion arithmetic.
// ---------------------------------------------------------------------------

export type LoggedMacros = {
  energyKj: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
};

/**
 * Scale a per-100 result to the amount actually eaten.
 *
 * 'serving' only works when the food carries a serving weight; without one the
 * caller must ask for grams instead of silently guessing at 100 g, which is
 * how a 30 g bar gets logged as three times what it was.
 */
export function scaleMacros(
  food: FoodResult,
  quantity: number,
  unit: 'g' | 'ml' | 'serving',
): LoggedMacros {
  let grams: number;
  if (unit === 'serving') {
    if (!food.servingG) throw new Error('This food has no serving size — enter grams.');
    grams = quantity * food.servingG;
  } else {
    grams = quantity;
  }

  const f = grams / 100;
  const at = (v: number | null) => (v == null ? null : Math.round(v * f * 10) / 10);

  return {
    energyKj: Math.round(food.energyKj * f * 10) / 10,
    proteinG: at(food.proteinG),
    carbsG: at(food.carbsG),
    fatG: at(food.fatG),
    fiberG: at(food.fiberG),
  };
}

/** Display helper. Storage is kJ; most clients think in kcal. */
export function kjToKcal(kj: number): number {
  return Math.round(kj / KCAL_TO_KJ);
}
