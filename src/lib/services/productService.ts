// =============================================================================
// Product Service — Callable Cloud Functions for catalog sync
// =============================================================================

import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase/client";
import { withDeviceAuth } from "@/lib/services/deviceEnrollmentService";

/** Result returned by the syncProducts callable function. */
export interface SyncProductsResult {
  success: boolean;
  productCount: number;
  souvenirProductCount: number;
  disabledProductCount: number;
  removedProductCount: number;
  removedSouvenirCount: number;
  syncedAt: string;
}

/** Product record returned by the authenticated backend catalog endpoint. */
export interface StoredProduct {
  vietnamSettingsVersion?: number;
  sendSaleToHk?: boolean;
  goodsId: string;
  goodsName: string;
  description?: string;
  price: number;
  afterTaxPrice?: number;
  taxRate?: number;
  taxRateType?: number;
  category: number;
  subCategory: string;
  typeId?: string;
  groupKey?: string;
  foreColor?: string;
  backColor?: string;
  principalPoints?: number;
  bonusPoints?: number;
  ticketsPerUnit?: number;
  amount?: number;
  giftNo?: string;
  typeName?: string;
  isEnabled?: boolean;
  isOpenSales?: boolean;
  isCategoryEnabled?: boolean;
  syncStatus?: "active" | "disabled";
  lastSyncAt: string;
}

interface GetProductsResult {
  products: StoredProduct[];
  fetchedAt: string;
}

/** Load the product catalog through the backend without exposing Firestore. */
export async function getProducts(): Promise<GetProductsResult> {
  const callable = httpsCallable<
    { action: "getProducts" },
    GetProductsResult
  >(
    functions,
    "getPosAuthSession"
  );

  const result = await callable(
    await withDeviceAuth({ action: "getProducts" as const }),
  );
  return result.data;
}

/**
 * Trigger the HK_API sync through the backend Cloud Function.
 */
export async function syncProducts(): Promise<SyncProductsResult> {
  const callable = httpsCallable<
    { action: "syncProducts" },
    SyncProductsResult
  >(
    functions,
    "getPosAuthSession"
  );

  const result = await callable(
    await withDeviceAuth({ action: "syncProducts" as const }),
  );
  return result.data;
}
