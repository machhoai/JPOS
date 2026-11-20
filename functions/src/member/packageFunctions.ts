import type { DocumentReference } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../config/firebase";
import { POS_COLLECTIONS } from "../config/collections";
import {
  confirmRemotePayment,
  createRemoteOrder,
  queryPaymentStatus,
  readRemoteOrderPayAmount,
  type HKApiResponse,
} from "../services/hkApiService";
import {
  loadRemoteMemberPackage,
  loadRemoteMemberPackages,
} from "../services/memberPackageService";
import { getPosAuthSession } from "../services/posAuthService";
import { isVietnamMemberPackageCategory, loadVietnamSaleSettings, resolveVietnamMemberSalePrice, vietnamBusinessDate } from "../services/vietnamSalePricing";
import { createInvoiceRequestToken } from "../order/invoiceRequestToken";
import { assertOrderCanBeRepriced } from "../order/functions";
import type { MemberPointPackage } from "../types/member";
import type { PosOrder } from "../types/order";
import { MemberRemoteApiError } from "./functions";
import {
  validateMemberPackageCatalogInput,
  validateMemberPackageOrderId,
  validateMemberPackageSaleInput,
  type MemberPackageSaleInput,
} from "./packagePolicy";
import { getLuckyDrawSettingsForWarehouse } from "../luckyDraw/luckyDrawSettingsFunctions";
import { resolveLuckyDrawTicketCount } from "../luckyDraw/luckyDrawSettingsPolicy";

interface OperatorInfo {
  employeeId: string;
  firebaseUid: string;
  name: string;
}

async function assertWarehouseAccess(
  userId: string,
  warehouseId: string,
): Promise<OperatorInfo> {
  const session = await getPosAuthSession(userId);
  if (!session.warehouses.some((warehouse) => warehouse.id === warehouseId)) {
    throw new HttpsError(
      "permission-denied",
      "Bạn không có quyền bán gói tại điểm bán này.",
    );
  }
  return {
    employeeId: session.user.employee_id,
    firebaseUid: userId,
    name: session.user.full_name,
  };
}

function createPackageDraft(
  input: MemberPackageSaleInput,
  selectedPackage: MemberPointPackage,
  operator: OperatorInfo,
  luckyDrawTicketsPerUnit: number,
  pricing: ReturnType<typeof resolveVietnamMemberSalePrice>["pricing"],
): PosOrder {
  const now = new Date().toISOString();
  const unitTaxAmount = pricing ? pricing.gross - pricing.net : selectedPackage.taxRateType === 2
    ? Math.min(selectedPackage.paymentAmountVnd, selectedPackage.taxRate)
    : selectedPackage.taxRate > 0
      ? selectedPackage.paymentAmountVnd -
        selectedPackage.paymentAmountVnd / (1 + selectedPackage.taxRate / 100)
      : 0;
  const effectiveTaxRate = pricing ? pricing.taxRate : selectedPackage.taxRateType === 2 &&
    selectedPackage.paymentAmountVnd > unitTaxAmount
    ? (unitTaxAmount /
      (selectedPackage.paymentAmountVnd - unitTaxAmount)) * 100
    : selectedPackage.taxRate;
  const totalAmount = pricing?.gross ?? selectedPackage.paymentAmountVnd;
  return {
    localOrderId: input.localOrderId,
    hkOrderNumber: null,
    shopId: input.shopId,
    warehouseId: input.warehouseId,
    createdBy: operator.firebaseUid,
    operatorId: operator.employeeId,
    operatorFirebaseUid: operator.firebaseUid,
    operatorName: operator.name,
    orderKind: "MEMBER_PACKAGE",
    uid: input.uid,
    member: input.member,
    status: "DRAFT",
    paymentMethod: "CASH",
    paymentMethodId: "CASH",
    paymentMethodName: "Tiền mặt",
    totalAmount,
    ...(pricing ? { invoiceRequestToken: createInvoiceRequestToken(), invoiceRequestCreatedAt: now, sendSaleToHk: true } : {}),
    items: [{
      goodsId: selectedPackage.goodsId,
      goodsName: selectedPackage.name,
      price: totalAmount,
      quantity: 1,
      unitPriceBeforeTax: Math.round(
        totalAmount - unitTaxAmount,
      ),
      taxRate: Number(effectiveTaxRate.toFixed(4)),
      taxAmount: Math.round(unitTaxAmount),
      ...(pricing ? { vatRateName: pricing.vatRateName, vietnamSettingsVersion: pricing.version, sendSaleToHk: true } : {}),
      luckyDrawTicketsPerUnit,
    }],
    sync: { retryCount: 0, lastError: null, syncedAt: null },
    createdAt: now,
    updatedAt: now,
  };
}

function assertPackageQuote(input: MemberPackageSaleInput, total: number, required: boolean) {
  if ((required || input.quotedPrice !== undefined) && input.quotedPrice !== total) {
    throw new HttpsError("failed-precondition", "Giá gói đã thay đổi hoặc ứng dụng chưa cập nhật. Hãy tải lại danh mục và đối chiếu giá trước khi thu tiền.", {
      action: "MEMBER_PACKAGE_QUOTE_CHANGED",
    });
  }
}

function assertSamePackageOrder(
  order: PosOrder,
  input: MemberPackageSaleInput,
): void {
  if (
    order.orderKind !== "MEMBER_PACKAGE" ||
    order.uid !== input.uid ||
    order.shopId !== input.shopId ||
    order.warehouseId !== input.warehouseId ||
    order.items.length !== 1 ||
    order.items[0].goodsId !== input.goodsId
  ) {
    throw new HttpsError(
      "failed-precondition",
      "Mã đơn đã được dùng cho một giao dịch khác.",
    );
  }
}

export async function listMemberPackagesForUser(userId: string, data: unknown) {
  const input = validateMemberPackageCatalogInput(data);
  await assertWarehouseAccess(userId, input.warehouseId);
  const [remotePackages, settings] = await Promise.all([
    loadRemoteMemberPackages(input.uid),
    loadVietnamSaleSettings(input.warehouseId, undefined, undefined, "member"),
  ]);
  const today = vietnamBusinessDate();
  const packages = remotePackages.flatMap((product) => {
    if (!isVietnamMemberPackageCategory(product.category ?? 1)) return [product];
    const offer = resolveVietnamMemberSalePrice(settings.get(product.goodsId), today);
    if (offer.blocked) return [];
    const price = offer.pricing;
    return [price ? {
      ...product, paymentAmountVnd: price.gross, originalAmountVnd: price.gross, discountAmountVnd: 0,
      priceBeforeTaxVnd: price.net, taxRate: price.taxRate, taxRateType: 1,
    } : product];
  });
  return { packages, fetchedAt: new Date().toISOString() };
}

export async function prepareMemberPackageOrderForUser(
  userId: string,
  data: unknown,
) {
  const input = validateMemberPackageSaleInput(data);
  const [operator, selectedPackage, luckyDrawSettings] = await Promise.all([
    assertWarehouseAccess(userId, input.warehouseId),
    loadRemoteMemberPackage(input.uid, input.goodsId),
    getLuckyDrawSettingsForWarehouse(input.warehouseId),
  ]);

  const docRef = db.collection(POS_COLLECTIONS.orders).doc(input.localOrderId);
  const luckyDrawTicketsPerUnit = resolveLuckyDrawTicketCount(
    luckyDrawSettings,
    selectedPackage.goodsId,
    selectedPackage.category,
  );
  const order = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(docRef);
    if (snapshot.exists) {
      const existing = snapshot.data() as PosOrder;
      if (existing.createdBy !== userId) {
        throw new HttpsError(
          "permission-denied",
          "Bạn không có quyền sử dụng đơn bán gói này.",
        );
      }
      assertSamePackageOrder(existing, input);
      if (existing.status === "DRAFT" && existing.items[0].vietnamSettingsVersion !== undefined) {
        assertPackageQuote(input, existing.totalAmount, true);
      }
      if (!existing.member || existing.items[0].luckyDrawTicketsPerUnit === undefined) {
        const updatedAt = new Date().toISOString();
        const items = existing.items.map((item, index) => index === 0
          ? { ...item, luckyDrawTicketsPerUnit }
          : item);
        transaction.update(docRef, {
          member: input.member,
          items,
          updatedAt,
        });
        return { ...existing, member: input.member, items, updatedAt };
      }
      return existing;
    }
    const setting = isVietnamMemberPackageCategory(selectedPackage.category ?? 1)
      ? (await loadVietnamSaleSettings(input.warehouseId, [input.goodsId], transaction, "member")).get(input.goodsId)
      : undefined;
    const { blocked, pricing } = resolveVietnamMemberSalePrice(setting, vietnamBusinessDate());
    if (blocked) {
      throw new HttpsError("failed-precondition", "Gói cần giá bán dương và gửi sang HK để cấp quyền lợi.");
    }
    const totalAmount = pricing?.gross ?? selectedPackage.paymentAmountVnd;
    if (!Number.isSafeInteger(totalAmount) || totalAmount <= 0) {
      throw new HttpsError("failed-precondition", "Giá gói không hợp lệ để thanh toán.");
    }
    // Legacy catalog prices can be member-specific on HK. Vietnam offers must always match the display quote.
    if (pricing) assertPackageQuote(input, totalAmount, true);
    const draft = createPackageDraft(
      input,
      selectedPackage,
      operator,
      luckyDrawTicketsPerUnit,
      pricing,
    );
    transaction.create(docRef, draft);
    return draft;
  });

  return {
    localOrderId: order.localOrderId,
    status: order.status,
    totalAmount: order.totalAmount,
    selectedPackage: order.items[0].vietnamSettingsVersion === undefined ? selectedPackage : {
      ...selectedPackage,
      paymentAmountVnd: order.totalAmount,
      originalAmountVnd: order.totalAmount,
      discountAmountVnd: 0,
      priceBeforeTaxVnd: order.items[0].unitPriceBeforeTax ?? order.totalAmount,
      taxRate: order.items[0].taxRate ?? 0,
      taxRateType: 1,
    },
  };
}

function isPaid(response: HKApiResponse): boolean {
  return response.success && Number(response.data?.payStatus) === 2;
}

async function callRemote<T>(
  action: string,
  request: () => Promise<HKApiResponse<T>>,
): Promise<HKApiResponse<T>> {
  try {
    return await request();
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : "Không rõ nguyên nhân";
    throw new MemberRemoteApiError(
      action,
      null,
      `Không thể kết nối OpenAPI: ${reason}`,
    );
  }
}

async function markSyncFailed(
  docRef: DocumentReference,
  order: PosOrder,
  reason: string,
  hkOrderNumber: string | null,
): Promise<void> {
  const updatedAt = new Date().toISOString();
  await docRef.update({
    status: "SYNC_FAILED",
    syncStatus: "SYNC_FAILED",
    hkOrderNumber,
    updatedAt,
    sync: {
      retryCount: (order.sync?.retryCount || 0) + 1,
      lastError: reason,
      syncedAt: null,
    },
  });
}

async function finalizeMemberPackageOrder(
  userId: string,
  localOrderId: string,
) {
  const docRef = db.collection(POS_COLLECTIONS.orders).doc(localOrderId);
  const [session, snapshot] = await Promise.all([
    getPosAuthSession(userId),
    docRef.get(),
  ]);
  if (!snapshot.exists) {
    throw new HttpsError("not-found", "Không tìm thấy đơn bán gói thành viên.");
  }
  const order = snapshot.data() as PosOrder;
  const canAccess = order.createdBy === userId || session.warehouses.some(
    (warehouse) => warehouse.id === order.warehouseId,
  );
  if (!canAccess) {
    throw new HttpsError("permission-denied", "Bạn không có quyền xử lý đơn này.");
  }
  if (order.orderKind !== "MEMBER_PACKAGE" || !order.uid) {
    throw new HttpsError("failed-precondition", "Đây không phải đơn gói thành viên.");
  }
  if (order.status === "SYNC_SUCCESS") {
    return {
      localOrderId,
      remoteOrderNumber: order.hkOrderNumber,
      status: order.status,
      completedAt: order.sync.syncedAt,
    };
  }
  if (order.status === "DRAFT" || order.status === "CANCELLED" || order.syncStatus === "CANCELLED") {
    throw new HttpsError(
      "failed-precondition",
      "Đơn chưa được xác nhận thanh toán tại POS.",
    );
  }
  if (order.status === "SYNCING") {
    throw new HttpsError(
      "aborted",
      "OpenAPI đang xử lý đơn. Vui lòng chờ và kiểm tra lại.",
    );
  }

  await db.runTransaction(async (transaction) => {
    const current = (await transaction.get(docRef)).data() as PosOrder | undefined;
    if (!current || current.status !== order.status ||
        current.cancellationOperationId || current.syncStatus === "CANCELLED") {
      throw new HttpsError("aborted", "Đơn vừa thay đổi. Vui lòng tải lại.");
    }
    transaction.update(docRef, {
      status: "SYNCING",
      syncStatus: "SYNCING",
      version: (current.version ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    });
  });
  let hkOrderNumber = order.hkOrderNumber;
  let remoteActualPayment = readRemoteOrderPayAmount(order.remoteActualPayment);
  let currentAction = "order_create";
  try {
    if (!hkOrderNumber) {
      const createResponse = await callRemote(
        "order_create",
        () => createRemoteOrder({
          uid: order.uid!,
          goodsItems: order.items.map((item) => ({
            goodsId: item.goodsId,
            quantity: String(item.quantity),
          })),
        }),
      );
      hkOrderNumber = typeof createResponse.data?.orderNumber === "string"
        ? createResponse.data.orderNumber
        : null;
      if (!createResponse.success || !hkOrderNumber) {
        throw new MemberRemoteApiError(
          "order_create",
          createResponse.code,
          createResponse.msg || "OpenAPI không thể tạo đơn bán gói.",
        );
      }
      remoteActualPayment = readRemoteOrderPayAmount(createResponse.data?.actualPayment);
      await docRef.update({
        hkOrderNumber,
        remoteActualPayment,
        updatedAt: new Date().toISOString(),
      });
    }

    currentAction = "order_pay_query";
    let statusResponse = await callRemote(
      "order_pay_query",
      () => queryPaymentStatus({ orderNumber: hkOrderNumber! }),
    );
    if (!isPaid(statusResponse)) {
      const payStatus = statusResponse.data?.payStatus;
      if (!statusResponse.success || ![0, 3, "0", "3"].includes(payStatus as number | string)) {
        throw new MemberRemoteApiError("order_pay_query", statusResponse.code,
          "HK chưa xác nhận đơn có thể thanh toán. Hãy kiểm tra hoặc thử lại đơn hiện tại.");
      }
      currentAction = "order_pay";
      const payResponse = await callRemote(
        "order_pay",
        () => confirmRemotePayment({
          orderNumber: hkOrderNumber!,
          payAmount: remoteActualPayment,
        }),
      );
      currentAction = "order_pay_query";
      statusResponse = await callRemote(
        "order_pay_query",
        () => queryPaymentStatus({ orderNumber: hkOrderNumber! }),
      );
      if (!payResponse.success && !isPaid(statusResponse)) {
        throw new MemberRemoteApiError(
          "order_pay",
          payResponse.code,
          payResponse.msg || "OpenAPI không thể thanh toán đơn bán gói.",
        );
      }
    }
    if (!isPaid(statusResponse)) {
      throw new MemberRemoteApiError(
        "order_pay_query",
        statusResponse.code,
        statusResponse.data?.payStatusDesc?.toString() ||
          statusResponse.msg ||
          "OpenAPI chưa xác nhận đơn đã thanh toán.",
      );
    }

    const completedAt = new Date().toISOString();
    await docRef.update({
      status: "SYNC_SUCCESS",
      syncStatus: "SYNC_SUCCESS",
      hkOrderNumber,
      updatedAt: completedAt,
      sync: {
        retryCount: order.sync?.retryCount || 0,
        lastError: null,
        syncedAt: completedAt,
      },
    });
    return {
      localOrderId,
      remoteOrderNumber: hkOrderNumber,
      status: "SYNC_SUCCESS" as const,
      completedAt,
    };
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : "OpenAPI xử lý thất bại.";
    await markSyncFailed(docRef, order, reason, hkOrderNumber);
    if (error instanceof MemberRemoteApiError) throw error;
    throw new MemberRemoteApiError(currentAction, null, reason);
  }
}

export async function sellMemberPackageForCashForUser(
  userId: string,
  data: unknown,
) {
  const input = validateMemberPackageSaleInput(data);
  await prepareMemberPackageOrderForUser(userId, input);
  const docRef = db.collection(POS_COLLECTIONS.orders).doc(input.localOrderId);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(docRef);
    const order = snapshot.data() as PosOrder;
    if (order.status !== "DRAFT") return;
    assertOrderCanBeRepriced(order);
    const paidAt = new Date().toISOString();
    transaction.update(docRef, {
      status: "LOCAL_PAID",
      paymentMethod: "CASH",
      paymentMethodId: "CASH",
      paymentMethodName: "Tiền mặt",
      paidAt,
      updatedAt: paidAt,
    });
  });
  return finalizeMemberPackageOrder(userId, input.localOrderId);
}

export async function finalizeMemberPackageSaleForUser(
  userId: string,
  data: unknown,
) {
  return finalizeMemberPackageOrder(
    userId,
    validateMemberPackageOrderId(data),
  );
}
