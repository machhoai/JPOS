import type { DocumentReference, Transaction } from "firebase-admin/firestore";

import { ORDER_SUBCOLLECTIONS } from "../config/collections";
import type { PosOrder } from "../types/order";

type SnapshotOrder = Pick<PosOrder,
  | "localOrderId" | "warehouseId" | "shopId" | "createdAt" | "paidAt"
  | "paymentMethodId" | "paymentMethodName" | "totalAmount" | "discountAmount"
  | "vouchers" | "items"
> & { paymentMethod: string };

export function buildInvoicePaymentSnapshot(order: SnapshotOrder) {
  return {
    schemaVersion: 1,
    localOrderId: order.localOrderId,
    warehouseId: order.warehouseId,
    shopId: order.shopId ?? null,
    createdAt: order.createdAt ?? order.paidAt ?? null,
    paidAt: order.paidAt ?? null,
    paymentMethod: order.paymentMethod ?? null,
    paymentMethodId: order.paymentMethodId ?? null,
    paymentMethodName: order.paymentMethodName ?? null,
    totalAmount: order.totalAmount,
    discountAmount: order.discountAmount ?? null,
    vouchers: (order.vouchers ?? []).map((voucher) => ({
      rewardType: voucher.rewardType,
      discountAmount: voucher.discountAmount,
      product: { goodsId: voucher.product?.goodsId ?? null },
    })),
    items: (order.items ?? []).map((item) => ({
      goodsId: item.goodsId,
      goodsName: item.goodsName,
      quantity: item.quantity,
      price: item.price,
      unitPriceBeforeTax: item.unitPriceBeforeTax ?? null,
      vatRateName: item.vatRateName ?? null,
      taxRate: item.taxRate ?? null,
      taxAmount: item.taxAmount ?? null,
    })),
  };
}

/** Called only when the payment transaction first marks an order as paid. */
export function createInvoicePaymentSnapshot(
  transaction: Transaction,
  orderRef: DocumentReference,
  paidOrder: SnapshotOrder,
) {
  transaction.create(
    orderRef.collection(ORDER_SUBCOLLECTIONS.invoiceSnapshots).doc("payment"),
    buildInvoicePaymentSnapshot(paidOrder),
  );
}
