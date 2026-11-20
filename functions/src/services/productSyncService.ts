import * as logger from "firebase-functions/logger";
import type { DocumentReference } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import { POS_COLLECTIONS } from "../config/collections";
import {
  fetchGoodsByCategory,
  fetchMemberPackageDetail,
  fetchProductVisualCatalog,
  fetchSetmealTypes,
  type HKGoodsItem,
  type HKProductVisualItem,
  type HKSetmealType,
} from "./hkApiService";
import {
  fetchMemberPointPackageCatalog,
  fetchSouvenirCatalog,
  type JoyworldGiftCatalogItem,
  type JoyworldMemberPointPackageItem,
} from "./joyworldCatalogService";
import {
  mapGroupedGoods,
  mapSellableSouvenirs,
} from "./productCatalog";
import { buildProductGroupKey } from "./productGrouping";
import {
  isConfirmedRemoteDeletion,
  isProductAvailable,
  resolveProductAvailability,
} from "./productAvailability";
import {
  SOUVENIR_CATEGORY_ID,
  SYNC_CATEGORY_IDS,
  type SyncProduct,
} from "../types/product";
import { coordinateProductSync } from "./productSyncCoordinator";
import {
  hideNewProductsByDefault,
  type ProductSyncActorContext,
} from "./productSyncVisibilityService";
import { findNewProductIds } from "./productSyncVisibilityPolicy";
import { loadVietnamSaleSettings, resolveVietnamSaleProduct, vietnamBusinessDate } from "./vietnamSalePricing";
const BATCH_LIMIT = 500;
const POINT_PACKAGE_CATEGORY_IDS = new Set([1, 2, 6]);

interface ProductVisualMetadata {
  foreColor?: string;
  backColor?: string;
  ticketsPerUnit?: number;
  principalPoints?: number;
  bonusPoints?: number;
  typeId?: string;
  isEnabled?: boolean;
  isOpenSales?: boolean;
  taxRate?: number;
  taxRateType?: number;
  afterTaxPrice?: number;
}

interface ProductManagementCatalog {
  categoryId: number;
  isAuthoritative: boolean;
  metadataByGoodsId: Map<string, ProductVisualMetadata>;
}

type ProductMutation =
  | {
    kind: "set";
    ref: DocumentReference;
    data: Partial<SyncProduct>;
  }
  | {
    kind: "soft-delete";
    ref: DocumentReference;
    data: Partial<SyncProduct>;
  };

function toNonNegativeNumber(...values: unknown[]): number {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return 0;
}

function toOptionalNonNegativeNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}

function toTaxRateType(...values: unknown[]): number | undefined {
  const parsed = toOptionalNonNegativeNumber(...values);
  return parsed !== undefined && [1, 2].includes(parsed) ? parsed : undefined;
}

export interface ProductSyncResult {
  success: true;
  productCount: number;
  souvenirProductCount: number;
  disabledProductCount: number;
  removedProductCount: number;
  removedSouvenirCount: number;
  newProductCount: number;
  newProductIds: string[];
  hiddenWarehouseCount: number;
  syncedAt: string;
}

export interface ProductCatalogResult {
  products: SyncProduct[];
  fetchedAt: string;
}

function extractList<T>(
  data: unknown,
  extraKeys: string[] = [],
): T[] {
  if (!data) return [];
  if (Array.isArray(data)) return data as T[];
  if (typeof data !== "object") return [];

  const record = data as Record<string, unknown>;

  for (const key of ["list", "data", "items", ...extraKeys]) {
    if (Array.isArray(record[key])) return record[key] as T[];
  }

  return [];
}

function mapProductVisualMetadata(items: HKProductVisualItem[]) {
  const metadataByGoodsId = new Map<
    string,
    ProductVisualMetadata
  >();

  for (const item of items) {
    const goodsId = (
      item.SetMealId ||
      item.setMealId ||
      item.GoodsId ||
      item.goodsId ||
      ""
    ).trim();
    if (!goodsId) continue;

    const foreColor = (item.ForeColor || item.foreColor || "").trim();
    const backColor = (item.BackColor || item.backColor || "").trim();
    const rawTicketsPerUnit = Number(item.Amount ?? item.amount);
    const ticketsPerUnit = Number.isInteger(rawTicketsPerUnit) && rawTicketsPerUnit >= 0
      ? rawTicketsPerUnit
      : undefined;
    const typeId = (item.TypeId || item.typeId || "").trim();
    const taxRate = toOptionalNonNegativeNumber(
      item.TaxRate,
      item.taxRate,
      item.SetmealTypeTaxRate,
      item.setmealTypeTaxRate,
    );
    const taxRateType = toTaxRateType(item.TaxRateType, item.taxRateType);
    const afterTaxPrice = toOptionalNonNegativeNumber(
      item.AfterTaxPrice,
      item.afterTaxPrice,
    );

    metadataByGoodsId.set(goodsId, {
      ...(foreColor ? { foreColor } : {}),
      ...(backColor ? { backColor } : {}),
      ...(ticketsPerUnit !== undefined ? { ticketsPerUnit } : {}),
      ...(typeId ? { typeId } : {}),
      ...(taxRate !== undefined ? { taxRate } : {}),
      ...(taxRateType !== undefined ? { taxRateType } : {}),
      ...(afterTaxPrice !== undefined ? { afterTaxPrice } : {}),
      ...(typeof (item.IsEnabled ?? item.isEnabled) === "boolean"
        ? { isEnabled: item.IsEnabled ?? item.isEnabled }
        : {}),
      ...(typeof (item.IsOpenSales ?? item.isOpenSales) === "boolean"
        ? { isOpenSales: item.IsOpenSales ?? item.isOpenSales }
        : {}),
    });
  }

  return metadataByGoodsId;
}

function mapMemberPointPackageManagementMetadata(
  items: JoyworldMemberPointPackageItem[],
): Map<string, ProductVisualMetadata> {
  return mapProductVisualMetadata(items.map((item) => ({
    SetMealId: item.setMealId,
    ForeColor: item.foreColor ?? undefined,
    BackColor: item.backColor ?? undefined,
    TypeId: item.typeId,
    TaxRate: item.taxRate ?? item.setmealTypeTaxRate,
    TaxRateType: item.taxRateType,
    AfterTaxPrice: item.afterTaxPrice,
    IsEnabled: item.isEnabled,
    IsOpenSales: item.isOpenSales,
  })));
}

async function loadProductDetailMetadata(
  items: HKGoodsItem[],
  metadataByGoodsId: Map<string, ProductVisualMetadata>,
): Promise<void> {
  const goodsIds = Array.from(new Set(items.flatMap((item) => {
    const goodsId = (item.GoodsId || item.goodsId || "").trim();
    return goodsId ? [goodsId] : [];
  })));
  const results = await Promise.allSettled(goodsIds.map(async (goodsId) => ({
    goodsId,
    response: await fetchMemberPackageDetail(goodsId),
  })));
  let loadedCount = 0;
  let failedCount = 0;

  for (const result of results) {
    if (result.status === "rejected" || !result.value.response.success) {
      failedCount += 1;
      continue;
    }

    const detail = result.value.response.data;
    const foreColor = detail?.foreColor?.trim() || "";
    const backColor = detail?.backColor?.trim() || "";
    const principalPoints = toNonNegativeNumber(detail?.amount, detail?.Amount);
    const bonusPoints = (detail?.giveConfigs ?? []).reduce((total, config) => {
      const giveAmount = Number(config.giveAmount);
      return Number.isFinite(giveAmount) && giveAmount > 0
        ? total + giveAmount
        : total;
    }, 0);
    const taxRate = toOptionalNonNegativeNumber(
      detail?.taxRate,
      detail?.setmealTypeTaxRate,
    );
    const taxRateType = toTaxRateType(detail?.taxRateType);
    const afterTaxPrice = toOptionalNonNegativeNumber(detail?.afterTaxPrice);
    metadataByGoodsId.set(result.value.goodsId, {
      ...metadataByGoodsId.get(result.value.goodsId),
      ...(foreColor ? { foreColor } : {}),
      ...(backColor ? { backColor } : {}),
      principalPoints,
      bonusPoints,
      ...(taxRate !== undefined ? { taxRate } : {}),
      ...(taxRateType !== undefined ? { taxRateType } : {}),
      ...(afterTaxPrice !== undefined ? { afterTaxPrice } : {}),
      ...(detail?.typeId ? { typeId: detail.typeId } : {}),
      ...(typeof detail?.isEnabled === "boolean"
        ? { isEnabled: detail.isEnabled }
        : {}),
      ...(typeof detail?.isOpenSales === "boolean"
        ? { isOpenSales: detail.isOpenSales }
        : {}),
    });
    loadedCount += 1;
  }

  logger.info("[productSync] Product detail metadata loaded", {
    requestedCount: goodsIds.length,
    loadedCount,
    failedCount,
  });
}

interface SetmealTypeOption {
  typeId: string;
  typeName: string;
  isEnabled: boolean;
}

function normalizeSetmealTypes(items: HKSetmealType[]): SetmealTypeOption[] {
  return items.flatMap((item) => {
    const typeId = (
      item.key ||
      item.Key ||
      item.typeId ||
      item.TypeId ||
      ""
    ).trim();
    const typeName = (
      item.value ||
      item.Value ||
      item.typeName ||
      item.TypeName ||
      ""
    ).trim();

    return typeId && typeName ? [{
      typeId,
      typeName,
      isEnabled: (item.IsEnabled ?? item.isEnabled) !== false,
    }] : [];
  });
}

function getSouvenirId(item: JoyworldGiftCatalogItem): string {
  return (item.goodsId || item.id || "").trim();
}

async function commitProductMutations(
  mutations: ProductMutation[],
): Promise<void> {
  for (let index = 0; index < mutations.length; index += BATCH_LIMIT) {
    const batch = db.batch();
    const chunk = mutations.slice(index, index + BATCH_LIMIT);

    for (const mutation of chunk) {
      batch.set(mutation.ref, mutation.data, { merge: true });
    }

    await batch.commit();
  }
}

export async function loadPosProductCatalog(warehouseId: string): Promise<ProductCatalogResult> {
  const [snapshot, settings] = await Promise.all([
    db.collection(POS_COLLECTIONS.products).get(),
    loadVietnamSaleSettings(warehouseId),
  ]);
  const products: SyncProduct[] = [];
  const upstream = new Map(snapshot.docs.map((doc) => [doc.id, doc.data()]));
  const today = vietnamBusinessDate();

  for (const goodsId of new Set([...upstream.keys(), ...settings.keys()])) {
    const offer = resolveVietnamSaleProduct(upstream.get(goodsId), settings.get(goodsId), today);
    if (offer.blocked || !offer.product) continue;
    const data = offer.product as Partial<SyncProduct>;
    const price = Number(data.price);
    const storedAfterTaxPrice = Number(data.afterTaxPrice);
    const afterTaxPrice = Number.isFinite(storedAfterTaxPrice) && (storedAfterTaxPrice > 0 || price === 0)
      ? storedAfterTaxPrice
      : price;
    const category = Number(data.category);
    const storedTaxRate = Number(data.taxRate);
    const taxRate = Number.isFinite(storedTaxRate) && storedTaxRate >= 0
      ? storedTaxRate
      : price > 0
        ? Number((((afterTaxPrice - price) / price) * 100).toFixed(4))
        : 0;
    const storedTaxRateType = Number(data.taxRateType);
    const taxRateType = [1, 2].includes(storedTaxRateType)
      ? storedTaxRateType
      : 1;

    if (
      data.is_deleted === true ||
      !data.goodsName ||
      !Number.isFinite(price) ||
      !Number.isFinite(afterTaxPrice) ||
      !Number.isFinite(category) ||
      !isProductAvailable(data) ||
      (category === SOUVENIR_CATEGORY_ID && afterTaxPrice <= 0 && !offer.vatRateName)
    ) {
      continue;
    }

    products.push({
      goodsId,
      ...(offer.vietnamSettingsVersion !== undefined ? {
        vietnamSettingsVersion: offer.vietnamSettingsVersion,
        sendSaleToHk: offer.sendSaleToHk !== false,
      } : {}),
      goodsName: String(data.goodsName),
      description: data.description ? String(data.description) : "",
      price,
      afterTaxPrice,
      taxRate,
      taxRateType,
      category,
      subCategory: data.subCategory ? String(data.subCategory) : "",
      ...(data.typeId ? { typeId: String(data.typeId) } : {}),
      ...(data.foreColor ? { foreColor: String(data.foreColor) } : {}),
      ...(data.backColor ? { backColor: String(data.backColor) } : {}),
      ...(Number.isFinite(Number(data.principalPoints)) && Number(data.principalPoints) >= 0
        ? { principalPoints: Number(data.principalPoints) }
        : {}),
      ...(Number.isFinite(Number(data.bonusPoints)) && Number(data.bonusPoints) >= 0
        ? { bonusPoints: Number(data.bonusPoints) }
        : {}),
      ...(Number.isInteger(Number(data.ticketsPerUnit)) && Number(data.ticketsPerUnit) >= 0
        ? { ticketsPerUnit: Number(data.ticketsPerUnit) }
        : {}),
      ...(Number.isFinite(Number(data.amount))
        ? { amount: Number(data.amount) }
        : {}),
      ...(data.giftNo ? { giftNo: String(data.giftNo) } : {}),
      ...(data.typeName ? { typeName: String(data.typeName) } : {}),
      groupKey: data.groupKey || buildProductGroupKey(data),
      isEnabled: data.isEnabled !== false,
      isOpenSales: data.isOpenSales !== false,
      isCategoryEnabled: data.isCategoryEnabled !== false,
      syncStatus: data.syncStatus || "active",
      disabledReason: data.disabledReason || null,
      lastSyncAt: data.lastSyncAt ? String(data.lastSyncAt) : "",
    });
  }

  return {
    products,
    fetchedAt: new Date().toISOString(),
  };
}

async function synchronizePosProductsCore(
  context: ProductSyncActorContext,
): Promise<ProductSyncResult> {
  logger.info("[productSync] Starting product synchronization", {
    userId: context.actorId,
    requestId: context.requestId,
    source: context.source,
  });

  const now = new Date().toISOString();
  const existingSnapshot = await db
    .collection(POS_COLLECTIONS.products)
    .get();
  const allProducts: SyncProduct[] = [];
  const synchronizedCategoryIds = new Set<number>();

  const [ticketManagementResponse, memberPointPackageResult] = await Promise.all([
    fetchProductVisualCatalog(),
    fetchMemberPointPackageCatalog()
      .then((items) => ({ items, error: null as unknown }))
      .catch((error: unknown) => ({
        items: [] as JoyworldMemberPointPackageItem[],
        error,
      })),
  ]);
  const memberPointPackageItems = memberPointPackageResult.items;
  if (memberPointPackageResult.error) {
    logger.warn("[productSync] Member point package catalog request failed", {
      categoryId: 1,
      error: memberPointPackageResult.error instanceof Error
        ? memberPointPackageResult.error.message
        : String(memberPointPackageResult.error),
    });
  }
  const ticketManagementItems = ticketManagementResponse.success
    ? extractList<HKProductVisualItem>(ticketManagementResponse.data)
    : [];
  if (!ticketManagementResponse.success) {
    logger.warn("[productSync] Ticket management catalog request failed", {
      categoryId: 4,
      code: ticketManagementResponse.code,
      message: ticketManagementResponse.msg,
    });
  }

  const managementCatalogs: ProductManagementCatalog[] = [
    {
      categoryId: 1,
      isAuthoritative: !memberPointPackageResult.error &&
        memberPointPackageItems.length > 0,
      metadataByGoodsId: mapMemberPointPackageManagementMetadata(
        memberPointPackageItems,
      ),
    },
    {
      categoryId: 4,
      isAuthoritative: ticketManagementResponse.success &&
        ticketManagementItems.length > 0,
      metadataByGoodsId: mapProductVisualMetadata(ticketManagementItems),
    },
  ];
  for (const catalog of managementCatalogs) {
    logger.info("[productSync] Product management metadata loaded", {
      categoryId: catalog.categoryId,
      metadataCount: catalog.metadataByGoodsId.size,
      isAuthoritative: catalog.isAuthoritative,
    });
  }
  const managementCatalogByCategory = new Map(
    managementCatalogs.map((catalog) => [catalog.categoryId, catalog]),
  );
  const visualColorsByGoodsId = new Map<string, ProductVisualMetadata>();
  for (const catalog of managementCatalogs) {
    for (const [goodsId, metadata] of catalog.metadataByGoodsId) {
      visualColorsByGoodsId.set(goodsId, {
        ...visualColorsByGoodsId.get(goodsId),
        ...metadata,
      });
    }
  }

  const typeResponse = await fetchSetmealTypes();
  if (!typeResponse.success) {
    throw new Error(
      `setmeal_type_select failed: [${typeResponse.code}] ${typeResponse.msg}`,
    );
  }

  const setmealTypes = normalizeSetmealTypes(
    extractList<HKSetmealType>(typeResponse.data),
  );
  if (setmealTypes.length === 0) {
    throw new Error("setmeal_type_select returned no product classifications");
  }
  const activeTypeIds = new Set(
    setmealTypes
      .filter((setmealType) => setmealType.isEnabled)
      .map((setmealType) => setmealType.typeId),
  );

  for (const categoryId of SYNC_CATEGORY_IDS) {
    const response = await fetchGoodsByCategory(categoryId);

    if (!response.success) {
      logger.warn("[productSync] Category request failed", {
        categoryId,
        code: response.code,
        message: response.msg,
      });
      continue;
    }

    const ungroupedItems = extractList<HKGoodsItem>(
      response.data,
      ["goodsItems"],
    );
    if (POINT_PACKAGE_CATEGORY_IDS.has(categoryId)) {
      await loadProductDetailMetadata(
        ungroupedItems,
        visualColorsByGoodsId,
      );
    }
    const productsById = new Map<string, SyncProduct>();

    for (const setmealType of setmealTypes) {
      const groupedResponse = await fetchGoodsByCategory(
        categoryId,
        setmealType.typeId,
      );

      if (!groupedResponse.success) {
        throw new Error(
          `setmeal_getsellgoods failed for category ${categoryId}, ` +
          `type ${setmealType.typeId}: ` +
          `[${groupedResponse.code}] ${groupedResponse.msg}`,
        );
      }

      const groupedItems = extractList<HKGoodsItem>(
        groupedResponse.data,
        ["goodsItems"],
      );
      const groupedProducts = mapGroupedGoods(
        groupedItems,
        categoryId,
        setmealType.typeName,
        now,
        visualColorsByGoodsId,
        setmealType.typeId,
        setmealType.isEnabled,
      );

      for (const product of groupedProducts) {
        productsById.set(product.goodsId, product);
      }
    }

    // Keep unclassified API products visible instead of dropping them.
    for (const product of mapGroupedGoods(
      ungroupedItems,
      categoryId,
      "Khác",
      now,
      visualColorsByGoodsId,
    )) {
      if (!productsById.has(product.goodsId)) {
        productsById.set(product.goodsId, product);
      }
    }

    allProducts.push(...productsById.values());
    synchronizedCategoryIds.add(categoryId);

    logger.info("[productSync] Category grouped", {
      categoryId,
      productCount: productsById.size,
      typeCount: setmealTypes.length,
    });
  }

  const rawSouvenirs = await fetchSouvenirCatalog();
  const sellableSouvenirs = mapSellableSouvenirs(rawSouvenirs, now);
  allProducts.push(...sellableSouvenirs);

  const newProductIds = findNewProductIds(
    existingSnapshot.docs.map((document) => ({
      id: document.id,
      isDeleted: document.data().is_deleted === true,
    })),
    allProducts.map((product) => product.goodsId),
  );
  const hiddenWarehouseCount = await hideNewProductsByDefault(
    newProductIds,
    context,
  );

  for (let index = 0; index < allProducts.length; index += BATCH_LIMIT) {
    const batch = db.batch();
    const chunk = allProducts.slice(index, index + BATCH_LIMIT);

    for (const product of chunk) {
      batch.set(
        db.collection(POS_COLLECTIONS.products).doc(product.goodsId),
        { ...product, is_deleted: false },
        { merge: true },
      );
    }

    await batch.commit();
  }

  const activePackageIds = new Set(
    allProducts
      .filter((product) => product.category !== SOUVENIR_CATEGORY_ID)
      .map((product) => product.goodsId),
  );
  const sellableSouvenirIds = new Set(
    sellableSouvenirs.map((product) => product.goodsId),
  );
  const souvenirById = new Map(
    rawSouvenirs.flatMap((item) => {
      const goodsId = getSouvenirId(item);
      return goodsId ? [[goodsId, item] as const] : [];
    }),
  );
  const stalePackageDocs = existingSnapshot.docs.filter((doc) => {
    const category = Number(doc.data().category);
    return synchronizedCategoryIds.has(category) &&
      !activePackageIds.has(doc.id);
  });
  const mutations: ProductMutation[] = [];
  let disabledProductCount = allProducts.filter(
    (product) => product.syncStatus === "disabled",
  ).length;
  let removedProductCount = 0;

  const detailCandidates: typeof stalePackageDocs = [];

  for (const doc of stalePackageDocs) {
    const category = Number(doc.data().category);
    const managementCatalog = managementCatalogByCategory.get(category);
    const visualMetadata = managementCatalog?.metadataByGoodsId.get(doc.id);

    if (visualMetadata) {
      const isCategoryEnabled = !visualMetadata.typeId ||
        activeTypeIds.has(visualMetadata.typeId);
      mutations.push({
        kind: "set",
        ref: doc.ref,
        data: {
          ...(visualMetadata.typeId ? { typeId: visualMetadata.typeId } : {}),
          ...resolveProductAvailability({
            isEnabled: visualMetadata.isEnabled,
            isOpenSales: visualMetadata.isOpenSales,
            isCategoryEnabled,
            isSellable: false,
          }),
          lastSyncAt: now,
        },
      });
      disabledProductCount += 1;
      continue;
    }

    // Each non-empty successful management catalog contains disabled products
    // too. This applies the same deletion rule to member point packages and
    // tickets while an empty/failed response remains non-destructive.
    if (isConfirmedRemoteDeletion({
      category,
      managementCatalogIsAuthoritative: managementCatalog?.isAuthoritative,
      managementCatalogContainsProduct: false,
    })) {
      mutations.push({
        kind: "soft-delete",
        ref: doc.ref,
        data: {
          ...resolveProductAvailability({ isSellable: false }),
          is_deleted: true,
          lastSyncAt: now,
        },
      });
      removedProductCount += 1;
      continue;
    }

    detailCandidates.push(doc);
  }

  const detailResults = await Promise.all(
    detailCandidates.map(async (doc) => {
      try {
        return {
          doc,
          response: await fetchMemberPackageDetail(doc.id),
        };
      } catch (error: unknown) {
        return { doc, error };
      }
    }),
  );

  for (const result of detailResults) {
    const { doc } = result;
    if ("response" in result && result.response) {
      const { response } = result;

      if (response.success && response.data) {
        const detail = response.data;
        const typeId = detail.typeId?.trim() || "";
        mutations.push({
          kind: "set",
          ref: doc.ref,
          data: {
            ...(typeId ? { typeId } : {}),
            ...resolveProductAvailability({
              isEnabled: detail.isEnabled ?? undefined,
              isOpenSales: detail.isOpenSales ?? undefined,
              isCategoryEnabled: !typeId || activeTypeIds.has(typeId),
              isSellable: false,
            }),
            lastSyncAt: now,
          },
        });
        disabledProductCount += 1;
        continue;
      }

      // OpenAPI documents 404 as the explicit response for a deleted package.
      // Other failures are treated as transient and only hide the stale item.
      if (isConfirmedRemoteDeletion({
        category: Number(doc.data().category),
        detailResponseCode: response.code,
        detailResponseMessage: `${response.msg} ${response.desc || ""}`,
      })) {
        mutations.push({
          kind: "soft-delete",
          ref: doc.ref,
          data: {
            ...resolveProductAvailability({ isSellable: false }),
            is_deleted: true,
            lastSyncAt: now,
          },
        });
        removedProductCount += 1;
        continue;
      }

      logger.warn("[productSync] Stale product detail could not be verified", {
        goodsId: doc.id,
        code: response.code,
        message: response.msg,
      });
      mutations.push({
        kind: "set",
        ref: doc.ref,
        data: {
          ...resolveProductAvailability({ isSellable: false }),
          lastSyncAt: now,
        },
      });
      disabledProductCount += 1;
      continue;
    }

    logger.warn("[productSync] Stale product detail request failed", {
      goodsId: doc.id,
      error: "error" in result ? result.error : undefined,
    });
    mutations.push({
      kind: "set",
      ref: doc.ref,
      data: {
        ...resolveProductAvailability({ isSellable: false }),
        lastSyncAt: now,
      },
    });
    disabledProductCount += 1;
  }

  let removedSouvenirCount = 0;
  if (rawSouvenirs.length > 0) {
    const existingSouvenirs = existingSnapshot.docs.filter(
      (doc) => Number(doc.data().category) === SOUVENIR_CATEGORY_ID,
    );

    for (const doc of existingSouvenirs) {
      if (sellableSouvenirIds.has(doc.id)) continue;

      const remoteSouvenir = souvenirById.get(doc.id);
      if (!remoteSouvenir) {
        mutations.push({
          kind: "soft-delete",
          ref: doc.ref,
          data: {
            ...resolveProductAvailability({ isSellable: false }),
            is_deleted: true,
            lastSyncAt: now,
          },
        });
        removedSouvenirCount += 1;
        continue;
      }

      mutations.push({
        kind: "set",
        ref: doc.ref,
        data: {
          ...resolveProductAvailability({
            isEnabled: remoteSouvenir.isEnabled,
            isOpenSales: remoteSouvenir.isOpenSales,
            isSellable: false,
          }),
          lastSyncAt: now,
        },
      });
      disabledProductCount += 1;
    }
  } else {
    logger.warn(
      "[productSync] Souvenir API returned an empty list; stale cleanup skipped",
    );
  }

  await commitProductMutations(mutations);

  logger.info("[productSync] Product synchronization completed", {
    productCount: allProducts.length,
    souvenirProductCount: sellableSouvenirs.length,
    disabledProductCount,
    removedProductCount,
    removedSouvenirCount,
    newProductCount: newProductIds.length,
    hiddenWarehouseCount,
  });

  return {
    success: true,
    productCount: allProducts.length,
    souvenirProductCount: sellableSouvenirs.length,
    disabledProductCount,
    removedProductCount,
    removedSouvenirCount,
    newProductCount: newProductIds.length,
    newProductIds,
    hiddenWarehouseCount,
    syncedAt: now,
  };
}

export async function synchronizePosProducts(
  context: ProductSyncActorContext,
): Promise<ProductSyncResult> {
  return coordinateProductSync(
    context,
    () => synchronizePosProductsCore(context),
  );
}
