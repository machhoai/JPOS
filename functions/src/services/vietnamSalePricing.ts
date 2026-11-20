import { db } from "../config/firebase";
import { POS_COLLECTIONS } from "../config/collections";

const VAT_RATES = ["0%", "5%", "8%", "10%", "KCT", "KKKNT"] as const;
export type VietnamVatRateName = (typeof VAT_RATES)[number];

export interface VietnamProductSettings {
  version: number;
  selling_price_vnd: number | null;
  vat_rate: VietnamVatRateName | null;
  effective_date: string | null;
  send_sale_to_hk: boolean;
  import_from_hk: boolean;
  local_product?: Record<string, unknown>;
}

interface VietnamSaleOffer {
  product: Record<string, unknown> | undefined;
  blocked: boolean;
  sendSaleToHk?: boolean;
  vietnamSettingsVersion?: number;
  vatRateName?: VietnamVatRateName;
}

export async function loadVietnamSaleSettings(
  warehouseId: string,
  goodsIds?: string[],
  transaction?: FirebaseFirestore.Transaction,
) {
  const ref = db.collection(POS_COLLECTIONS.vietnamProductSettings).doc(warehouseId);
  const store = await (transaction ? transaction.get(ref) : ref.get());
  if (store.get("enabled") !== true) return new Map<string, VietnamProductSettings>();
  const products = ref.collection("products");
  const refs = goodsIds?.map((goodsId) => products.doc(goodsId));
  const docs = refs
    ? await (transaction ? transaction.getAll(...refs) : db.getAll(...refs))
    : (await products.get()).docs;
  return new Map(docs.flatMap((doc) => doc.exists
    ? [[doc.id, doc.data() as VietnamProductSettings] as const]
    : []));
}

export function vietnamBusinessDate(now = new Date()): string {
  return new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Both the register catalog and checkout resolve the same store-specific offer. */
export function resolveVietnamSaleProduct(
  upstream: Record<string, unknown> | undefined,
  settings: VietnamProductSettings | undefined,
  businessDate: string,
): VietnamSaleOffer {
  const frozen = settings?.local_product;
  const catalogProduct = settings?.import_from_hk === false && frozen
    ? frozen
    : upstream ?? (settings?.send_sale_to_hk === false ? frozen : undefined);
  const category = Number((settings?.send_sale_to_hk === false && frozen ? frozen : catalogProduct)?.category);
  // Member packages and stored value still use the existing HK entitlement flow.
  if (!settings || ![4, 10].includes(category)) {
    return { product: upstream, blocked: false };
  }
  const sendSaleToHk = settings.send_sale_to_hk !== false;
  const gross = settings.selling_price_vnd;
  const vatRateName = settings.vat_rate;
  const pricing = gross !== null && Number.isSafeInteger(gross) && gross >= 0 &&
    vatRateName && VAT_RATES.includes(vatRateName) &&
    settings.effective_date && settings.effective_date <= businessDate
    ? { gross, vatRateName }
    : null;
  if (!catalogProduct || (!sendSaleToHk && !pricing)) {
    return { product: catalogProduct, blocked: true };
  }
  const taxRate = pricing && pricing.vatRateName.endsWith("%")
    ? Number.parseInt(pricing.vatRateName, 10)
    : 0;
  const localAvailability = sendSaleToHk ? {} : {
    is_deleted: false,
    isEnabled: true,
    isOpenSales: true,
    isCategoryEnabled: true,
    syncStatus: "active",
  };
  return {
    blocked: false,
    product: { ...catalogProduct, category, ...localAvailability, ...(pricing ? {
      price: Math.round(pricing.gross / (1 + taxRate / 100)),
      afterTaxPrice: pricing.gross,
      taxRate,
      taxRateType: 1,
    } : {}) },
    sendSaleToHk,
    vietnamSettingsVersion: settings.version,
    vatRateName: pricing?.vatRateName,
  };
}
