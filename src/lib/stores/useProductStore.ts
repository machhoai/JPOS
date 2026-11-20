// =============================================================================
// Zustand Product Store — In-memory product catalog
// =============================================================================
// Hiện tại dùng mock data vì chưa kết nối HK API.
// Khi API sẵn sàng, chỉ cần thay MOCK_PRODUCTS bằng Firestore fetch.
// =============================================================================

import { create } from "zustand";
import type { Product } from "@/lib/types/product";
import { CATEGORY_IDS, CATEGORY_MAP } from "@/lib/types/product";
import { filterProducts } from "@/lib/utils/productSearch";
import {
  getProducts,
  type StoredProduct,
} from "@/lib/services/productService";
import { buildProductGroupKey } from "@/lib/utils/productGrouping";

export interface ProductVisibilitySettings {
  version: number;
  disabledGroupKeys: string[];
  disabledProductIds: string[];
}

export const getProductGroupKey = (product: Product): string =>
  product.groupKey || buildProductGroupKey(product);

/** Một entry danh mục đã derive từ danh sách sản phẩm. */
export interface CategoryEntry {
  id: number;
  label: string;
}

/** Shape của product store. */
interface ProductState {
  // ── State ──────────────────────────────────────────────────────────────────
  products: Product[];
  /** Danh mục có ít nhất 1 sản phẩm */
  availableCategories: CategoryEntry[];
  /** Lọc theo danh mục (null = tất cả) */
  selectedCategory: number | null;
  searchQuery: string;
  isLoading: boolean;
  lastSyncAt: string | null;
  error: string | null;
  visibilitySettings: ProductVisibilitySettings;

  // ── Actions ────────────────────────────────────────────────────────────────
  /** Tải sản phẩm (hiện dùng mock data) */
  fetchProducts: () => Promise<void>;
  /** Chọn danh mục lọc */
  setSelectedCategory: (category: number | null) => void;
  /** Tìm kiếm */
  setSearchQuery: (query: string) => void;
  /** Xóa bộ lọc */
  clearFilters: () => void;
  applyVisibilitySettings: (settings: ProductVisibilitySettings) => void;
}

/**
 * Derive danh mục có sản phẩm từ danh sách.
 * Giữ thứ tự ổn định theo CATEGORY_MAP.
 */
function deriveCategories(products: Product[]): CategoryEntry[] {
  const available = new Set(products.map((product) => product.category));
  return CATEGORY_IDS
    .filter((category) => available.has(category))
    .map((category) => ({ id: category, label: CATEGORY_MAP[category] }));
}

function toProduct(source: StoredProduct): Product {
  const price = Number(source.price);
  const storedAfterTaxPrice = Number(source.afterTaxPrice);
  const afterTaxPrice = Number.isFinite(storedAfterTaxPrice)
    ? storedAfterTaxPrice
    : price;
  const storedTaxRate = Number(source.taxRate);
  const taxRate = Number.isFinite(storedTaxRate) && storedTaxRate >= 0
    ? storedTaxRate
    : price > 0
      ? Number((((afterTaxPrice - price) / price) * 100).toFixed(4))
      : 0;
  const storedTaxRateType = Number(source.taxRateType);
  const taxRateType = [1, 2].includes(storedTaxRateType)
    ? storedTaxRateType
    : 1;

  return {
    goodsId: String(source.goodsId),
    ...(source.vietnamSettingsVersion !== undefined ? {
      vietnamSettingsVersion: source.vietnamSettingsVersion,
      sendSaleToHk: source.sendSaleToHk,
    } : {}),
    goodsName: String(source.goodsName),
    description: source.description || "",
    price,
    afterTaxPrice,
    underlinePrice: 0,
    category: Number(source.category),
    subCategory: source.subCategory || "",
    typeId: source.typeId || "",
    typeName: source.typeName || source.subCategory || "",
    groupKey: source.groupKey || buildProductGroupKey(source),
    foreColor: source.foreColor || "#FFFFFF",
    backColor: source.backColor || "#F97316",
    principalPoints: Number.isFinite(Number(source.principalPoints))
      ? Math.max(0, Number(source.principalPoints))
      : 0,
    bonusPoints: Number.isFinite(Number(source.bonusPoints))
      ? Math.max(0, Number(source.bonusPoints))
      : 0,
    taxRate,
    taxRateType,
    isOpenSales: source.isOpenSales !== false,
    isEnabled: source.isEnabled !== false &&
      source.isCategoryEnabled !== false &&
      source.syncStatus !== "disabled",
    ticketsPerUnit: Number.isInteger(Number(source.ticketsPerUnit)) && Number(source.ticketsPerUnit) >= 0
      ? Number(source.ticketsPerUnit)
      : 0,
    amount: Number.isFinite(Number(source.amount))
      ? Number(source.amount)
      : 0,
    barCode: source.giftNo,
    giftNo: source.giftNo,
    lastSyncAt: source.lastSyncAt || undefined,
  };
}

/**
 * Product store — tải tất cả sản phẩm vào RAM để filter không độ trễ.
 */
export const useProductStore = create<ProductState>((set, get) => ({
  // ── Initial State ──────────────────────────────────────────────────────────
  products: [],
  availableCategories: [],
  selectedCategory: null,
  searchQuery: "",
  isLoading: false,
  lastSyncAt: null,
  error: null,
  visibilitySettings: {
    version: 0,
    disabledGroupKeys: [],
    disabledProductIds: [],
  },

  // ── Actions ────────────────────────────────────────────────────────────────

  fetchProducts: async () => {
    if (get().isLoading) return;
    set({ isLoading: true, error: null });

    try {
      const result = await getProducts();
      const products = result.products
        .map(toProduct)
        .filter(
          (product) =>
            Boolean(CATEGORY_MAP[product.category]) &&
            Number.isFinite(product.price) &&
            Number.isFinite(product.afterTaxPrice) &&
            product.isEnabled &&
            product.isOpenSales &&
            (product.category !== 10 || product.afterTaxPrice > 0 || product.vietnamSettingsVersion !== undefined)
        );

      const lastSyncAt =
        products
          .map((product) => product.lastSyncAt)
          .filter((value): value is string => Boolean(value))
          .sort()
          .at(-1) || result.fetchedAt;

      set((state) => {
        const hiddenGroups = new Set(state.visibilitySettings.disabledGroupKeys);
        const hiddenProducts = new Set(state.visibilitySettings.disabledProductIds);
        const categories = deriveCategories(products.filter(
          (product) => !hiddenGroups.has(getProductGroupKey(product)) && !hiddenProducts.has(product.goodsId),
        ));
        return {
        products,
        availableCategories: categories,
        selectedCategory:
          state.selectedCategory !== null &&
          categories.some((category) => category.id === state.selectedCategory)
            ? state.selectedCategory
            : categories[0]?.id ?? null,
        isLoading: false,
        lastSyncAt,
        error: null,
        };
      });
    } catch (error) {
      console.error("[Product Store] Lỗi khi tải sản phẩm:", error);
      set({
        isLoading: false,
        error: "Không thể tải danh sách sản phẩm. Vui lòng thử lại.",
      });
    }
  },

  setSelectedCategory: (category) =>
    set({ selectedCategory: category }),

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  clearFilters: () => set({ selectedCategory: null, searchQuery: "" }),

  applyVisibilitySettings: (visibilitySettings) => set((state) => {
    const hiddenGroups = new Set(visibilitySettings.disabledGroupKeys);
    const hiddenProducts = new Set(visibilitySettings.disabledProductIds);
    const visibleProducts = state.products.filter(
      (product) => !hiddenGroups.has(getProductGroupKey(product)) && !hiddenProducts.has(product.goodsId),
    );
    const categories = deriveCategories(visibleProducts);
    return {
      visibilitySettings,
      availableCategories: categories,
      selectedCategory:
        state.selectedCategory !== null && categories.some(({ id }) => id === state.selectedCategory)
          ? state.selectedCategory
          : categories[0]?.id ?? null,
    };
  }),
}));

// =============================================================================
// Selectors — Derived data computed from store state
// =============================================================================

/**
 * Select sản phẩm đã lọc theo danh mục và tìm kiếm.
 */
export const selectFilteredProducts = (state: ProductState): Product[] => {
  const visibleProducts = selectVisibleProducts(state);
  return filterProducts(
    visibleProducts,
    state.selectedCategory,
    state.searchQuery,
  );
};

export const selectVisibleProducts = (state: ProductState): Product[] => {
  const hiddenGroups = new Set(state.visibilitySettings.disabledGroupKeys);
  const hiddenProducts = new Set(state.visibilitySettings.disabledProductIds);
  return state.products.filter(
    (product) => !hiddenGroups.has(getProductGroupKey(product)) && !hiddenProducts.has(product.goodsId),
  );
};
