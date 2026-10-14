"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useShallow } from "zustand/react/shallow";
import { describeReceiptPrintError, printReceiptSilently } from "@/features/receipt/components/ReceiptPrintButton";
import { useReceiptSettingsStore } from "@/features/receipt/store/useReceiptSettingsStore";
import { printLuckyDrawTicketsSilently } from "@/features/lucky-draw/components/LuckyDrawPrintButton";
import { useLuckyDrawSettingsSync } from "@/features/lucky-draw/hooks/useLuckyDrawSettingsSync";
import { useLuckyDrawSettingsStore } from "@/features/lucky-draw/store/useLuckyDrawSettingsStore";
import { useAuth } from "@/lib/contexts/AuthContext";
import { useCustomerDisplayWindow } from "@/lib/hooks/useCustomerDisplayWindow";
import { useBarcodeScanner } from "@/lib/hooks/useBarcodeScanner";
import { useMemberProfileEditController } from "@/lib/hooks/useMemberProfileEditController";
import { useMemberPhoneSuggestions } from "@/lib/hooks/useMemberPhoneSuggestions";
import { resumeMemberRegistration } from "@/lib/services/memberPhoneSearchService";
import type { MemberPhoneSuggestion } from "@/lib/types/memberPhoneSearch";
import { useMemberCustomerDisplayPublisher } from "@/lib/hooks/useMemberCustomerDisplayPublisher";
import { useMemberActivityController } from "@/lib/hooks/useMemberActivityController";
import { useMemberCompensationController } from "@/lib/hooks/useMemberCompensationController";
import { useMemberPackageCustomerDisplayPublisher } from "@/lib/hooks/useMemberPackageCustomerDisplayPublisher";
import { useMemberPackageSaleController } from "@/lib/hooks/useMemberPackageSaleController";
import { fetchOrderForReceipt } from "@/lib/services/orderService";
import { logCheckoutTelemetry } from "@/lib/services/checkoutTelemetryService";
import { lookupMember, registerMember, toMemberServiceError, validateMemberRegistrationDraft } from "@/lib/services/memberService";
import { confirmMemberCardIssue, getMemberCardIssueInfo, prepareMemberCardForIssue, type PreparedMemberCard } from "@/lib/services/memberCardIssueService";
import { cancelMemberCardRead, readMemberCard, toCardReaderServiceError } from "@/lib/services/cardReaderService";
import { useMemberStore } from "@/lib/stores/useMemberStore";
import { useCartStore } from "@/lib/stores/useCartStore";
import { selectVisibleProducts, useProductStore } from "@/lib/stores/useProductStore";
import { useProductVisibilitySync } from "@/lib/hooks/useProductVisibilitySync";
import type { CardReaderStatus, MemberCardLookupKind, MemberLookupMode, MemberProfile, MemberRegistrationDraft } from "@/lib/types/member";
import type { Product } from "@/lib/types/product";
import { findProductByBarcode } from "@/lib/utils/productBarcode";
import { showError, showPromise, showSuccess, showWarning } from "@/lib/utils/toast";
type MemberOperation = "LOOKUP" | "REGISTER" | "COMPENSATION";
interface LookupOverride {
    mode: MemberLookupMode;
    query: string;
    cardLookupKind?: MemberCardLookupKind;
    selectedUid?: string;
}
function retryLookup(): void {
    const form = document.getElementById("member-lookup-form");
    if (form instanceof HTMLFormElement) form.requestSubmit();
}
function retryRegistration(): void {
    const button = document.getElementById("member-register-button");
    if (button instanceof HTMLButtonElement) button.click();
}
export function useMembersPageController() {

    useCustomerDisplayWindow();
    const router = useRouter();
    const auth = useAuth();
    useLuckyDrawSettingsSync(auth.effectiveWarehouseId);
    useProductVisibilitySync(auth.effectiveWarehouseId);
    const [operation, setOperation] = useState<MemberOperation>("LOOKUP");
    const [renewalBusy, setRenewalBusy] = useState(false);
    const [fetchedAt, setFetchedAt] = useState<string | null>(null);
    const [registrationCardReaderStatus, setRegistrationCardReaderStatus] = useState<CardReaderStatus>("IDLE");
    const [registrationCardReaderError, setRegistrationCardReaderError] = useState<string | null>(null);
    const [registrationCard, setRegistrationCard] = useState<PreparedMemberCard | null>(null);
    const [pendingRegistrationMember, setPendingRegistrationMember] = useState<MemberProfile | null>(null);
    const [completedRegistrationMember, setCompletedRegistrationMember] = useState<MemberProfile | null>(null);
    const cardReadAttemptRef = useRef(0);
    const [selectedPhone, setSelectedPhone] = useState<MemberPhoneSuggestion | null>(null);
    const hasStartedInitialCardReadRef = useRef(false);

    const mode = useMemberStore((state) => state.lookupMode);
    const query = useMemberStore((state) => state.lookupQuery);
    const request = useMemberStore((state) => state.lookupRequest);
    const cardReaderStatus = useMemberStore((state) => state.cardReaderStatus);
    const cardReaderError = useMemberStore((state) => state.cardReaderError);
    const lastCardLookupKind = useMemberStore((state) => state.lastCardLookupKind);
    const member = useMemberStore((state) => state.currentMember);
    const draft = useMemberStore((state) => state.registrationDraft);
    const mutation = useMemberStore((state) => state.mutation);
    const products = useProductStore(useShallow(selectVisibleProducts));
    const productsLoading = useProductStore((state) => state.isLoading);
    const productsError = useProductStore((state) => state.error);
    const fetchProducts = useProductStore((state) => state.fetchProducts);
    const cartItems = useCartStore((state) => state.items);
    const cartPaymentLocked = useCartStore((state) => state.isPaymentLocked);
    const isPaymentLocked = cartPaymentLocked || renewalBusy;
    const addCartItem = useCartStore((state) => state.addItem);
    const updateCartQuantity = useCartStore((state) => state.updateQuantity);
    const setCartMember = useCartStore((state) => state.setMember);
    const requestCheckoutModal = useCartStore((state) => state.requestCheckoutModal);
    const setCheckoutContext = useCartStore((state) => state.setCheckoutContext);
    const hydrateCheckoutJournal = useCartStore((state) => state.hydrateCheckoutJournal);
    const receiptSettings = useReceiptSettingsStore((state) => state.settings);
    const luckyDrawSettings = useLuckyDrawSettingsStore((state) => state.settings);

    const setMode = useMemberStore((state) => state.setLookupMode);
    const setQuery = useMemberStore((state) => state.setLookupQuery);
    const startCardRead = useMemberStore((state) => state.startCardRead);
    const completeCardRead = useMemberStore((state) => state.completeCardRead);
    const failCardRead = useMemberStore((state) => state.failCardRead);
    const startLookup = useMemberStore((state) => state.startLookup);
    const completeLookup = useMemberStore((state) => state.completeLookup);
    const failLookup = useMemberStore((state) => state.failLookup);
    const updateDraft = useMemberStore((state) => state.updateRegistrationDraft);
    const startNewRegistration = useMemberStore((state) => state.startNewRegistration);
    const startMutation = useMemberStore((state) => state.startMutation);
    const failMutation = useMemberStore((state) => state.failMutation);
    const resetSession = useMemberStore((state) => state.resetMemberSession);

    const shopId = Number(process.env.NEXT_PUBLIC_SHOP_ID) || 1;

    const refreshAfterCompensation = useCallback(async () => {
        if (!auth.effectiveWarehouseId) return;
        try {
            const result = await lookupMember({
                shopId,
                warehouseId: auth.effectiveWarehouseId,
                mode,
                query,
                cardLookupKind: mode === "CARD" && cardReaderStatus === "SUCCEEDED"
                    ? lastCardLookupKind ?? "MEMBER_CODE"
                    : undefined,
            });
            completeLookup(result.member);
            setFetchedAt(result.fetchedAt);
        } catch (error: unknown) {
            const parsed = toMemberServiceError(error);
            showWarning("Đã nạp bù nhưng chưa tải lại được số dư", parsed.message);
        }
    }, [auth.effectiveWarehouseId, cardReaderStatus, completeLookup, lastCardLookupKind, mode, query, shopId]);

    const memberActivity = useMemberActivityController({
        member: operation === "LOOKUP" || operation === "COMPENSATION" ? member : null,
        shopId,
        warehouseId: auth.effectiveWarehouseId,
    });

    const compensation = useMemberCompensationController({
        member: operation === "COMPENSATION" ? member : null,
        shopId,
        warehouseId: auth.effectiveWarehouseId,
        onSucceeded: refreshAfterCompensation,
    });

    const canCompensate = auth.hasPermission("pos.members.compensate", auth.effectiveWarehouseId || undefined);
    const refreshAfterRenewal = useCallback(async () => {
        if (!member || !auth.effectiveWarehouseId) return;
        const result = await lookupMember({ shopId, warehouseId: auth.effectiveWarehouseId,
            ...(member.phone ? { mode: "PHONE" as const, query: member.phone, selectedUid: member.uid } : { mode: "CARD" as const, query: member.memberCode ?? query }),
        });
        if (result.member.uid !== member.uid) throw new Error("Kết quả tải lại không khớp thành viên vừa gia hạn.");
        completeLookup(result.member); setFetchedAt(result.fetchedAt);
    }, [member, auth.effectiveWarehouseId, shopId, query, completeLookup]);
    const handleMemberPackageAutoPrint = useCallback(async (localOrderId: string) => {
        console.info("[Biên lai thành viên] Bắt đầu in tự động", { localOrderId });
        let order: Awaited<ReturnType<typeof fetchOrderForReceipt>>;
        try {
            order = await fetchOrderForReceipt(localOrderId);
            logCheckoutTelemetry("order_loaded", {
                localOrderId,
                orderKind: order.orderKind ?? "MEMBER_PACKAGE",
                warehouseId: order.warehouseId,
                details: { status: order.status },
            });
        } catch (error: unknown) {
            console.error("[Biên lai thành viên] Không thể tải đơn để in tự động:", error);
            showError(
                "Nạp thẻ thành công nhưng chưa tải được biên lai",
                "Dịch vụ đơn hàng chưa sẵn sàng. Vui lòng in lại từ lịch sử đơn hàng.",
            );
            return;
        }

        try {
            await printReceiptSilently(order, receiptSettings);
            await printLuckyDrawTicketsSilently(order, luckyDrawSettings);
        } catch (error: unknown) {
            console.error("[Biên lai thành viên] In tự động thất bại:", error);
            showError(
                "Nạp thẻ thành công nhưng chưa in được biên lai",
                describeReceiptPrintError(
                    error,
                    "Không thể gửi biên lai tới máy in mặc định của Windows.",
                ),
            );
        }
    }, [luckyDrawSettings, receiptSettings]);

    const memberPackageSale = useMemberPackageSaleController({
        shopId,
        warehouseId: operation === "LOOKUP" ? auth.effectiveWarehouseId : null,
        products,
        productsLoading,
        productsError,
        reloadProducts: fetchProducts,
        onSaleCompleted: handleMemberPackageAutoPrint,
    });
    const canEditMember = auth.hasPermission("pos.members.edit", auth.effectiveWarehouseId || undefined);
    const canReadMemberHistory = auth.hasPermission("pos.members.history", auth.effectiveWarehouseId || undefined);
    const canRetryMemberSync = auth.hasPermission("pos.members.retry_sync", auth.effectiveWarehouseId || undefined);
    const profileEdit = useMemberProfileEditController(member, shopId, auth.effectiveWarehouseId, operation === "LOOKUP" && (canEditMember || canReadMemberHistory), canReadMemberHistory);
    const isMemberPackageDisplayEnabled = !profileEdit.editing && !profileEdit.saved && operation === "LOOKUP" &&
        Boolean(member && memberPackageSale.selectedPackage);

    useMemberCustomerDisplayPublisher({
        enabled: operation === "REGISTER" ||
            (operation === "LOOKUP" && Boolean(member) && !isMemberPackageDisplayEnabled),
        suppressWhenDisabled: isMemberPackageDisplayEnabled,
        editDraft: profileEdit.draft,
        editSaved: profileEdit.saved,
        showLookupBalances: operation === "LOOKUP",
        draft,
        mutationStatus: mutation.status,
        member: operation === "LOOKUP"
            ? member
            : completedRegistrationMember ?? pendingRegistrationMember,
    });
    useMemberPackageCustomerDisplayPublisher({
        enabled: isMemberPackageDisplayEnabled,
        selectedPackage: memberPackageSale.selectedPackage,
        mutation: memberPackageSale.mutation,
        paymentMethod: memberPackageSale.paymentMethod,
        payment: memberPackageSale.payOSPayment,
    });

    useEffect(() => {
        if (!auth.isLoading && (!auth.user || !auth.userDoc)) router.replace("/login");
    }, [auth.isLoading, auth.user, auth.userDoc, router]);

    useEffect(() => {
        if (
            (operation === "REGISTER" || operation === "LOOKUP") &&
            auth.user &&
            auth.userDoc &&
            products.length === 0 &&
            !productsLoading &&
            !productsError
        ) {
            void fetchProducts();
        }
    }, [auth.user, auth.userDoc, fetchProducts, operation, products.length, productsError, productsLoading]);

    useEffect(() => {
        if (!auth.effectiveWarehouseId) return;
        setCheckoutContext(shopId, auth.effectiveWarehouseId);
        void hydrateCheckoutJournal();
    }, [auth.effectiveWarehouseId, hydrateCheckoutJournal, setCheckoutContext, shopId]);

    useEffect(() => () => {
        cardReadAttemptRef.current += 1;
        void cancelMemberCardRead();
    }, []);

    const handleLookup = useCallback(async (override?: LookupOverride) => {
        if (renewalBusy) return;
        if (profileEdit.editing && !profileEdit.cancel()) return;
        const lookupMode = override?.mode ?? mode;
        const lookupQuery = override?.query ?? query;
        const selectedUid = override?.selectedUid ?? (selectedPhone?.phone === lookupQuery ? selectedPhone.uid : undefined);
        if (lookupMode === "PHONE" && !selectedUid) {
            showWarning("Chọn số điện thoại", "Hãy chọn thành viên từ danh sách gợi ý trước khi tra cứu.");
            return;
        }
        const cardLookupKind = override?.cardLookupKind ?? (
            lookupMode === "CARD" && cardReaderStatus === "SUCCEEDED"
                ? lastCardLookupKind ?? "MEMBER_CODE"
                : "MEMBER_CODE"
        );
        if (!auth.effectiveWarehouseId) {
            showError("Chưa chọn điểm bán", "Vui lòng chọn điểm bán trước khi tra cứu.");
            return;
        }
        startLookup();
        try {
            const result = await showPromise(
                lookupMember({
                    shopId,
                    warehouseId: auth.effectiveWarehouseId,
                    mode: lookupMode,
                    query: lookupQuery,
                    selectedUid,
                    cardLookupKind: lookupMode === "CARD" ? cardLookupKind : undefined,
                }),
                {
                    loading: "Đang tra cứu OpenAPI...",
                    success: "Đã tìm thấy thành viên",
                    error: "Tra cứu không thành công",
                    successDescription: "Thông tin và số dư mới nhất đã được tải.",
                    errorDescription: "Lý do chi tiết được hiển thị trên màn hình.",
                    onRetry: retryLookup,
                }
            );
            completeLookup(result.member);
            setFetchedAt(result.fetchedAt);
        } catch (error: unknown) {
            const memberError = toMemberServiceError(error);
            console.error("[Thành viên] Tra cứu thất bại:", memberError);
            failLookup(memberError.message, memberError.code);
            setFetchedAt(null);
        }
    }, [auth.effectiveWarehouseId, cardReaderStatus, completeLookup, failLookup, lastCardLookupKind, mode, query, shopId, startLookup, profileEdit, selectedPhone, renewalBusy]);

    const phoneSearch = useMemberPhoneSuggestions(query, shopId, auth.effectiveWarehouseId || "", auth.user?.uid || "", operation !== "REGISTER" && mode === "PHONE" && request.status !== "WAITING_API" && selectedPhone?.phone !== query,
        `${completedRegistrationMember?.uid ?? ""}:${member?.profileRevision ?? ""}`);
    const handleSuggestionSelect = useCallback(async function selectSuggestion(item: MemberPhoneSuggestion) {
        if (renewalBusy) return;
        if (profileEdit.editing && !profileEdit.cancel()) return;
        setQuery(item.phone);
        if (item.state === "READY") {
            setSelectedPhone(item);
            await handleLookup({ mode: "PHONE", query: item.phone, selectedUid: item.uid });
            return;
        }
        setSelectedPhone(null);
        startLookup();
        try {
            const restored = await showPromise(resumeMemberRegistration({registrationId:item.uid,shopId,warehouseId:auth.effectiveWarehouseId || ""}), {
                loading:"Đang phục hồi đăng ký...",success:"Đã lưu hồ sơ thành viên",error:"Chưa thể phục hồi đăng ký",
                successDescription:"Hồ sơ đã được lưu vào dữ liệu POS.",errorDescription:(error:unknown)=>toMemberServiceError(error).message,
                onRetry:()=>{ void selectSuggestion(item); },
            });
            const ready: MemberPhoneSuggestion = {uid:restored.member.uid,phone:restored.member.phone,fullName:restored.member.fullName,state:"READY"};
            setSelectedPhone(ready);
            setQuery(ready.phone);
            phoneSearch.retry();
            await handleLookup({mode:"PHONE",query:ready.phone,selectedUid:ready.uid});
        } catch (error) { const converted=toMemberServiceError(error); console.error("[Đăng ký] Phục hồi thất bại:",converted); failLookup(converted.message,converted.code); }
    },[auth.effectiveWarehouseId,handleLookup,shopId,setQuery,startLookup,failLookup,profileEdit,phoneSearch,renewalBusy]);

    const handleCardRead = useCallback(async () => {
        if (renewalBusy) return;
        const attemptId = cardReadAttemptRef.current + 1;
        cardReadAttemptRef.current = attemptId;
        startCardRead();

        try {
            const result = await readMemberCard();
            if (cardReadAttemptRef.current !== attemptId) return;
            const cardNumber = result.memberCode ?? result.serialNumber;
            if (!cardNumber) {
                throw new Error("Đầu đọc không trả mã thành viên hoặc serial thẻ.");
            }
            const cardLookupKind: MemberCardLookupKind = result.memberCode
                ? "MEMBER_CODE"
                : "SERIAL_NUMBER";
            completeCardRead(cardNumber, cardLookupKind);
            await handleLookup({
                mode: "CARD",
                query: cardNumber,
                cardLookupKind,
            });
        } catch (error: unknown) {
            if (cardReadAttemptRef.current !== attemptId) return;
            const readerError = toCardReaderServiceError(error);
            if (readerError.code === "READ_CANCELLED") return;
            failCardRead(readerError.message);
        }
    }, [completeCardRead, failCardRead, handleLookup, startCardRead, renewalBusy]);

    useEffect(() => {
        if (
            hasStartedInitialCardReadRef.current ||
            auth.isLoading ||
            !auth.user ||
            !auth.userDoc ||
            !auth.effectiveWarehouseId ||
            operation !== "LOOKUP"
        ) {
            return;
        }

        const timeoutId = window.setTimeout(() => {
            hasStartedInitialCardReadRef.current = true;
            setFetchedAt(null);
            setMode("CARD");
            void handleCardRead();
        }, 0);

        return () => window.clearTimeout(timeoutId);
    }, [auth.effectiveWarehouseId, auth.isLoading, auth.user, auth.userDoc, handleCardRead, operation, setMode]);

    const handleRegistrationCardRead = useCallback(async () => {
        if (!auth.effectiveWarehouseId) {
            showError("Chưa chọn điểm bán", "Vui lòng chọn điểm bán trước khi đọc thẻ.");
            return;
        }
        setCompletedRegistrationMember(null);
        setCartMember(null);
        const attemptId = cardReadAttemptRef.current + 1;
        cardReadAttemptRef.current = attemptId;
        setRegistrationCardReaderStatus("READING");
        setRegistrationCardReaderError(null);
        setRegistrationCard(null);
        updateDraft({ memberCode: "" });

        try {
            const result = await prepareMemberCardForIssue({
                shopId,
                warehouseId: auth.effectiveWarehouseId,
            });
            if (cardReadAttemptRef.current !== attemptId) return;
            updateDraft({ memberCode: result.memberCode });
            setRegistrationCard(result);
            setRegistrationCardReaderStatus("SUCCEEDED");
        } catch (error: unknown) {
            if (cardReadAttemptRef.current !== attemptId) return;
            const readerError = toCardReaderServiceError(error);
            if (readerError.code === "READ_CANCELLED") return;
            setRegistrationCardReaderStatus("FAILED");
            setRegistrationCardReaderError(readerError.message);
        }
    }, [auth.effectiveWarehouseId, setCartMember, shopId, updateDraft]);

    const handleCancelRegistrationCardRead = useCallback(() => {
        cardReadAttemptRef.current += 1;
        void cancelMemberCardRead().catch((error: unknown) => {
            console.warn("[Đầu đọc thẻ] Không thể gửi lệnh hủy:", error);
        });
        setRegistrationCard(null);
        updateDraft({ memberCode: "" });
        setRegistrationCardReaderStatus("FAILED");
        setRegistrationCardReaderError("Đã hủy chờ đọc thẻ. Vui lòng đọc lại thẻ để có thể đăng ký.");
    }, [updateDraft]);

    const handleClearRegistrationCard = useCallback(() => {
        cardReadAttemptRef.current += 1;
        setRegistrationCard(null);
        updateDraft({ memberCode: "" });
        setRegistrationCardReaderStatus("IDLE");
        setRegistrationCardReaderError(null);
    }, [updateDraft]);

    const handleResetRegistrationFlow = useCallback(() => {
        const retainedMember = pendingRegistrationMember;
        cardReadAttemptRef.current += 1;
        if (registrationCardReaderStatus === "READING") {
            void cancelMemberCardRead().catch((error: unknown) => {
                console.warn("[Đầu đọc thẻ] Không thể gửi lệnh hủy khi rời phiên đăng ký:", error);
            });
        }
        startNewRegistration();
        setPendingRegistrationMember(null);
        setCompletedRegistrationMember(null);
        setRegistrationCard(null);
        setRegistrationCardReaderStatus("IDLE");
        setRegistrationCardReaderError(null);
        setCartMember(null);
        setFetchedAt(null);

        if (retainedMember) {
            showWarning(
                "Đã rời phiên đăng ký",
                "Thông tin trên màn hình đã được xóa. Thành viên đã tạo trên Joyworld vẫn được giữ và có thể tra cứu lại.",
            );
        }
    }, [pendingRegistrationMember, registrationCardReaderStatus, setCartMember, startNewRegistration]);

    const handleRegistrationDraftChange = useCallback((values: Partial<MemberRegistrationDraft>) => {
        if (completedRegistrationMember) {
            setCompletedRegistrationMember(null);
            setCartMember(null);
        }
        updateDraft(values);
    }, [completedRegistrationMember, setCartMember, updateDraft]);

    const handleCancelCardRead = useCallback(() => {
        cardReadAttemptRef.current += 1;
        void cancelMemberCardRead().catch((error: unknown) => {
            console.warn("[Đầu đọc thẻ] Không thể gửi lệnh hủy:", error);
        });
        failCardRead("Đã hủy chờ đọc thẻ. Bạn có thể đọc lại hoặc nhập mã thẻ thủ công.");
    }, [failCardRead]);

    const handleModeChange = useCallback((nextMode: MemberLookupMode) => {
        if (renewalBusy) return;
        if (profileEdit.editing && !profileEdit.cancel()) return;
        if (nextMode === mode) return;
        setSelectedPhone(null);
        if (cardReaderStatus === "READING") {
            cardReadAttemptRef.current += 1;
            void cancelMemberCardRead();
        }
        setFetchedAt(null);
        setMode(nextMode);
        if (nextMode === "CARD") void handleCardRead();
    }, [cardReaderStatus, handleCardRead, mode, setMode, profileEdit, renewalBusy]);

    const handleQueryChange = useCallback((nextQuery: string) => {
        if (renewalBusy) return;
        setSelectedPhone(null);
        if (cardReaderStatus === "READING") {
            cardReadAttemptRef.current += 1;
            void cancelMemberCardRead();
        }
        setQuery(nextQuery);
    }, [cardReaderStatus, setQuery, renewalBusy]);

    const handleOperationChange = useCallback((nextOperation: MemberOperation) => {
        if (renewalBusy) return;
        if (profileEdit.editing && !profileEdit.cancel()) return;
        if (nextOperation === "REGISTER") {
            if (isPaymentLocked) {
                showWarning(
                    "Giỏ hàng đang được khóa",
                    "Hãy hoàn tất hoặc hủy thanh toán hiện tại trước khi tạo thành viên mới.",
                );
                return;
            }
            setCompletedRegistrationMember(null);
            setCartMember(null);
        }
        if (cardReaderStatus === "READING" || registrationCardReaderStatus === "READING") {
            cardReadAttemptRef.current += 1;
            void cancelMemberCardRead();
        }
        setOperation(nextOperation);
    }, [cardReaderStatus, isPaymentLocked, registrationCardReaderStatus, setCartMember, profileEdit, renewalBusy]);

    const handleAddProduct = useCallback((product: Product): boolean => {
        if (isPaymentLocked) {
            showWarning("Giỏ hàng đang được khóa", "Hãy hoàn tất hoặc hủy thanh toán hiện tại trước khi sửa đơn.");
            return false;
        }
        addCartItem({
            goodsId: product.goodsId,
            goodsName: product.goodsName,
            price: product.afterTaxPrice > 0 ? product.afterTaxPrice : product.price,
            quantity: 1,
        });
        return true;
    }, [addCartItem, isPaymentLocked]);

    const handleBarcodeScan = useCallback((barcode: string) => {
        const product = findProductByBarcode(products, barcode);
        if (!product) {
            showWarning(
                "Không tìm thấy mã vạch",
                `Không có sản phẩm nào mang mã ${barcode} trong danh mục hiện tại.`,
            );
            return;
        }

        if (handleAddProduct(product)) {
            showSuccess("Đã quét sản phẩm", `${product.goodsName} đã được thêm vào giỏ hàng đăng ký.`);
        }
    }, [handleAddProduct, products]);

    useBarcodeScanner({
        enabled: operation === "REGISTER" &&
            !auth.isLoading &&
            Boolean(auth.user && auth.userDoc) &&
            !auth.needsWarehouseSelection,
        onScan: handleBarcodeScan,
    });

    const handleRegister = useCallback(async (): Promise<boolean> => {
        const warehouseId = auth.effectiveWarehouseId;
        if (!warehouseId) {
            showError("Chưa chọn điểm bán", "Vui lòng chọn điểm bán trước khi đăng ký.");
            return false;
        }

        if (
            registrationCardReaderStatus !== "SUCCEEDED" ||
            !registrationCard ||
            registrationCard.memberCode !== draft.memberCode.trim()
        ) {
            showError(
                pendingRegistrationMember ? "Cần đọc lại thẻ" : "Chưa đọc thẻ",
                pendingRegistrationMember
                    ? "Thành viên đã được tạo. Vui lòng đọc thẻ vật lý để hoàn tất bước gắn thẻ."
                    : "Vui lòng đọc và xác thực thẻ vật lý bằng đầu đọc trước khi đăng ký.",
            );
            return false;
        }

        let normalizedDraft: MemberRegistrationDraft;
        try {
            normalizedDraft = validateMemberRegistrationDraft(draft);
            updateDraft(normalizedDraft);
        } catch (error: unknown) {
            const memberError = toMemberServiceError(error);
            showError("Thông tin chưa hợp lệ", memberError.message);
            return false;
        }

        startMutation("REGISTER");
        let registeredMember = pendingRegistrationMember;
        let createdAt = fetchedAt;
        try {
            const result = await showPromise(
                (async () => {
                    if (!registeredMember) {
                        const registration = await registerMember({
                            ...normalizedDraft,
                            memberCode: "",
                            shopId,
                            warehouseId,
                        });
                        registeredMember = registration.member;
                        createdAt = registration.createdAt;
                        setPendingRegistrationMember(registration.member);
                        completeLookup(registration.member);
                    }

                    let completedMember = registeredMember;
                    if (registrationCard) {
                        const issueInfo = await getMemberCardIssueInfo({
                            shopId,
                            warehouseId,
                            uid: registeredMember.uid,
                            lookupQuery: registeredMember.phone || registeredMember.uid,
                        });
                        await confirmMemberCardIssue({
                            shopId,
                            warehouseId,
                            uid: registeredMember.uid,
                            lookupQuery: registeredMember.phone || registeredMember.uid,
                            memberAcctId: issueInfo.memberAcctId,
                            memberCode: registrationCard.memberCode,
                            memberIcCard: registrationCard.memberIcCard,
                            dynamicSerialNo: registrationCard.dynamicSerialNo,
                        });
                        completedMember = {
                            ...registeredMember,
                            memberCode: registrationCard.memberCode,
                        };
                    }

                    return { member: completedMember, createdAt };
                })(),
                {
                    loading: pendingRegistrationMember
                        ? "Đang thử gắn lại thẻ trên Joyworld..."
                        : registrationCard
                            ? "Đang tạo thành viên và gắn thẻ..."
                            : "Đang chờ OpenAPI đăng ký...",
                    success: registrationCard
                        ? "Đăng ký và gắn thẻ thành công"
                        : "Đăng ký thành viên thành công",
                    error: "Đăng ký không thành công",
                    successDescription: registrationCard
                        ? "Joyworld đã xác nhận thẻ và POS đã lưu mã thẻ."
                        : "OpenAPI đã xác nhận và POS đã lưu hồ sơ.",
                    errorDescription: (error: unknown) => toMemberServiceError(error).message,
                    onRetry: retryRegistration,
                }
            );
            setPendingRegistrationMember(null);
            setCompletedRegistrationMember(result.member);
            setCartMember({
                uid: result.member.uid,
                memberCode: result.member.memberCode,
                fullName: result.member.fullName,
                phone: result.member.phone,
                levelName: result.member.levelName,
            });
            setRegistrationCard(null);
            setRegistrationCardReaderStatus("IDLE");
            setRegistrationCardReaderError(null);
            startNewRegistration();
            setFetchedAt(result.createdAt ?? new Date().toISOString());
            return true;
        } catch (error: unknown) {
            const memberError = toMemberServiceError(error);
            console.error("[Thành viên] Đăng ký thất bại:", memberError);
            failMutation(
                registeredMember
                    ? `Thành viên đã được tạo nhưng thẻ chưa được gắn: ${memberError.message}`
                    : memberError.message,
                memberError.code,
            );
            return false;
        }
    }, [auth.effectiveWarehouseId, completeLookup, draft, failMutation, fetchedAt, pendingRegistrationMember, registrationCard, registrationCardReaderStatus, setCartMember, shopId, startMutation, startNewRegistration, updateDraft]);

    const handleRegisterAndCheckout = useCallback(async () => {
        if (!completedRegistrationMember) {
            const registered = await handleRegister();
            if (!registered) return;
        }

        requestCheckoutModal();
        router.push("/");
    }, [completedRegistrationMember, handleRegister, requestCheckoutModal, router]);

    
    return { auth, operation, fetchedAt, setFetchedAt, registrationCardReaderStatus, registrationCardReaderError, pendingRegistrationMember, completedRegistrationMember, mode, query, request, cardReaderStatus, cardReaderError, member, draft, mutation, products, productsLoading, productsError, fetchProducts, cartItems, isPaymentLocked, updateCartQuantity, resetSession, shopId, memberActivity, compensation, canCompensate, memberPackageSale, canEditMember, canReadMemberHistory, canRetryMemberSync, profileEdit, handleLookup, handleCardRead, handleRegistrationCardRead, handleCancelRegistrationCardRead, handleClearRegistrationCard, handleResetRegistrationFlow, handleRegistrationDraftChange, handleCancelCardRead, handleModeChange, handleQueryChange, handleOperationChange, handleAddProduct, handleRegister, handleRegisterAndCheckout, phoneSearch, handleSuggestionSelect, phoneSelected: selectedPhone?.phone === query, renewalBusy, setRenewalBusy, refreshAfterRenewal };
}
