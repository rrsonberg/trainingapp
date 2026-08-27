/**
 * Food lookup — search and barcode.
 *
 * Two sources, both free, each doing the job it is actually good at:
 *
 *   USDA            generic whole foods, government-curated, most accurate
 *   Open Food Facts branded packaged goods and barcodes, crowd-sourced
 *
 * MyFitnessPal's own API is closed to new partners, so none of this wraps it.
 *
 * Chain-restaurant menus are deliberately NOT here. The only source at that
 * scale is commercial and priced past what this app is worth to run; anyone
 * eating out builds the item once under My foods from the chain's published
 * numbers and it is permanent from then on.
 *
 * Everything returned is per 100 g in KILOJOULES, matching nutrition_targets
 * and food_items. Conversion happens here, once, at the boundary — no screen
 * should ever see a kcal figure straight from a provider.
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

export type FoodSource = 'usda' | 'off' | 'custom';

/**
 * Portion units.
 *
 * Weight leads because that is how anybody serious about tracking measures:
 * food goes on the scale first, and the number they read off it is what they
 * want to type. Everything converts to grams for the arithmetic.
 */
export type PortionUnit = 'g' | 'oz' | 'lb' | 'ml' | 'floz' | 'serving';

const GRAMS_PER: Record<string, number> = {
  g: 1,
  oz: 28.349523125,
  lb: 453.59237,
  ml: 1,           // Treated 1:1 with grams. Fine for water-like foods,
  floz: 29.5735,   // approximate for oils and syrups.
};

export const UNIT_LABEL: Record<PortionUnit, string> = {
  g: 'g', oz: 'oz', lb: 'lb', ml: 'ml', floz: 'fl oz', serving: 'serving',
};

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
  /** USDA data is government-curated; the others are not. A coach reviewing
   *  a macro breakdown deserves to know which one this is. */
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
// ---------------------------------------------------------------------------

const USDA_NUTRIENTS: Record<number, keyof FoodResult> = {
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
    basis: 'per_100g',
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
 * Both sources in parallel, USDA first because its numbers are better. One
 * provider failing must not take the search down — a client standing in a
 * kitchen does not care which API is having a bad day.
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

  if (results.length === 0 && usda.status === 'rejected' && off.status === 'rejected') {
    // Both failed — say so, rather than an empty state that reads as
    // "this food does not exist".
    throw new Error('Could not reach the food database. Check your connection.');
  }

  const seen = new Set<string>();
  return results.filter((r) => {
    const key = `${r.name.toLowerCase()}|${(r.brand ?? '').toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Custom foods.
// ---------------------------------------------------------------------------

/**
 * Build a food from macros the client typed off a label, a recipe, or a
 * restaurant's published nutrition page.
 *
 * They enter it per serving, because that is how a label reads and how a
 * person thinks. Storage normalises to per 100 g so a custom food scales by
 * weight exactly like every other food — log 1.5 servings or 140 g and the
 * arithmetic is the same.
 */
export function buildCustomFood(input: {
  name: string;
  brand?: string | null;
  servingLabel?: string | null;
  servingG: number;
  kcal: number;
  proteinG?: number | null;
  carbsG?: number | null;
  fatG?: number | null;
  fiberG?: number | null;
}): FoodResult {
  if (!input.name.trim()) throw new Error('Give it a name.');
  if (!(input.servingG > 0)) throw new Error('Serving weight must be more than zero.');
  if (!(input.kcal > 0)) throw new Error('Calories must be more than zero.');

  const per100 = (v: number | null | undefined) =>
    v == null ? null : Math.round((v / input.servingG) * 100 * 10) / 10;

  return {
    source: 'custom',
    sourceRef: `${input.name.trim().toLowerCase()}|${Date.now()}`,
    barcode: null,
    name: input.name.trim(),
    brand: input.brand?.trim() || null,
    basis: 'per_100g',
    energyKj: Math.round((input.kcal / input.servingG) * 100 * KCAL_TO_KJ * 100) / 100,
    proteinG: per100(input.proteinG),
    carbsG: per100(input.carbsG),
    fatG: per100(input.fatG),
    fiberG: per100(input.fiberG),
    sugarG: null,
    sodiumMg: null,
    servingLabel: input.servingLabel?.trim() || '1 serving',
    servingG: input.servingG,
    verified: false,
  };
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
 * Convert any portion to grams.
 *
 * 'serving' only works when the food carries a serving weight; without one the
 * caller must ask for a weight instead of silently guessing at 100 g, which is
 * how a 30 g bar gets logged as three times what it was.
 */
export function toGrams(food: FoodResult, quantity: number, unit: PortionUnit): number {
  if (unit === 'serving') {
    if (!food.servingG) {
      throw new Error('This food has no serving size — weigh it and enter g or oz.');
    }
    return quantity * food.servingG;
  }
  const factor = GRAMS_PER[unit];
  if (!factor) throw new Error(`Unknown unit: ${unit}`);
  return quantity * factor;
}

/** Scale a per-100 result to the amount actually eaten. */
export function scaleMacros(
  food: FoodResult,
  quantity: number,
  unit: PortionUnit,
): LoggedMacros {
  const grams = toGrams(food, quantity, unit);
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
