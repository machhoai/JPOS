"use client";
import { MonitorCheck, SearchX } from "lucide-react";
import MembersPageHeader from "@/components/members/MembersPageHeader";
import Sidebar from "@/components/layout/Sidebar";
import MemberLookupPanel from "@/components/members/MemberLookupPanel";
import MemberDetailsPanel from "@/components/members/MemberDetailsPanel";
import MemberCompensationConfirmModal from "@/components/members/MemberCompensationConfirmModal";
import MemberCompensationPanel from "@/components/members/MemberCompensationPanel";
import MemberProductCatalog from "@/components/members/MemberProductCatalog";
import MemberRegistrationForm from "@/components/members/MemberRegistrationForm";
import CheckoutModal from "@/components/pos/CheckoutModal";
import StoreSelector from "@/components/pos/StoreSelector";
import { JPOS_PAYMENT_METHODS } from "@/lib/data/paymentMethods";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import type { useMembersPageController } from "@/lib/hooks/useMembersPageController";
interface Props { controller: ReturnType<typeof useMembersPageController> }
export default function MembersPageView({ controller }: Props) {
    const { auth, operation, fetchedAt, setFetchedAt, registrationCardReaderStatus, registrationCardReaderError, pendingRegistrationMember, completedRegistrationMember, mode, query, request, cardReaderStatus, cardReaderError, member, draft, mutation, products, productsLoading, productsError, fetchProducts, cartItems, isPaymentLocked, updateCartQuantity, resetSession, shopId, memberActivity, compensation, canCompensate, memberPackageSale, canEditMember, canReadMemberHistory, canRetryMemberSync, profileEdit, handleLookup, handleCardRead, handleRegistrationCardRead, handleCancelRegistrationCardRead, handleClearRegistrationCard, handleResetRegistrationFlow, handleRegistrationDraftChange, handleCancelCardRead, handleModeChange, handleQueryChange, handleOperationChange, handleAddProduct, handleRegister, handleRegisterAndCheckout } = controller;
if (auth.isLoading || !auth.user || !auth.userDoc) {
        return (
            <div className="flex h-screen items-center justify-center bg-[var(--color-background)]">
                <div className="size-10 animate-spin rounded-full border-4 border-[var(--color-accent)] border-t-transparent" />
            </div>
        );
    }
    if (auth.needsWarehouseSelection) {
        return (
            <StoreSelector
                userName={auth.userDoc.full_name}
                warehouses={auth.availableWarehouses}
                onSelectWarehouse={auth.selectWarehouse}
                onLogout={auth.logout}
            />
        );
    }
    return (
        <div className="flex h-screen bg-[var(--color-background)]">
            <Sidebar onLogout={() => { if (!profileEdit.editing || profileEdit.cancel()) void auth.logout(); }} />
            <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <MembersPageHeader warehouseName={auth.effectiveWarehouseName || auth.effectiveWarehouseId} operation={operation} canCompensate={canCompensate} onOperationChange={handleOperationChange} />
                <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-3 lg:overflow-hidden">
                    <div className="mx-auto grid gap-4 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(340px,440px)_1fr]">
                        <div className="space-y-3 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
                            {operation !== "REGISTER" ? (
                                <MemberLookupPanel
                                    mode={mode}
                                    query={query}
                                    isLookingUp={request.status === "WAITING_API"}
                                    cardReaderStatus={cardReaderStatus}
                                    cardReaderError={cardReaderError}
                                    onModeChange={handleModeChange}
                                    onQueryChange={handleQueryChange}
                                    onReadCard={() => void handleCardRead()}
                                    onCancelCardRead={handleCancelCardRead}
                                    onSubmit={() => void handleLookup()}
                                    phoneSearch={controller.phoneSearch}
                                    phoneSelected={controller.phoneSelected}
                                    onSuggestionSelect={item=>void controller.handleSuggestionSelect(item)}
                                    onSearchRetry={controller.phoneSearch.retry}
                                />
                            ) : (
                                <MemberRegistrationForm
                                    draft={draft}
                                    mutation={mutation}
                                    cardReaderStatus={registrationCardReaderStatus}
                                    cardReaderError={registrationCardReaderError}
                                    onChange={handleRegistrationDraftChange}
                                    onReadCard={() => void handleRegistrationCardRead()}
                                    onCancelCardRead={handleCancelRegistrationCardRead}
                                    onClearCard={handleClearRegistrationCard}
                                    memberCreated={Boolean(pendingRegistrationMember)}
                                    onRegister={() => void handleRegister()}
                                    onStartNew={handleResetRegistrationFlow}
                                />
                            )}
                            {operation !== "REGISTER" ? (
                                <button
                                    type="button"
                                    disabled={controller.renewalBusy}
                                    onClick={() => {
                                        if (profileEdit.editing && !profileEdit.cancel()) return;
                                        resetSession();
                                        setFetchedAt(null);
                                    }}
                                    className="min-h-12 w-full rounded-2xl border border-[var(--color-border)] bg-white px-4 text-sm font-bold text-[var(--color-text-secondary)] active:scale-[0.98]"
                                >
                                    Xóa phiên tra cứu
                                </button>
                            ) : null}
                        </div>
                        {operation === "REGISTER" ? (
                            <MemberProductCatalog
                                products={products}
                                items={cartItems}
                                isLoading={productsLoading}
                                error={productsError}
                                isPaymentLocked={isPaymentLocked}
                                memberReady={Boolean(completedRegistrationMember)}
                                isRegistering={mutation.kind === "REGISTER" && mutation.status === "WAITING_API"}
                                onReload={() => void fetchProducts()}
                                onAdd={handleAddProduct}
                                onUpdateQuantity={updateCartQuantity}
                                onRegisterAndCheckout={() => void handleRegisterAndCheckout()}
                            />
                        ) : operation === "LOOKUP" && member ? (
                            <MemberDetailsPanel
                                key={`${auth.effectiveWarehouseId}:${member.uid}`}
                                profileEdit={profileEdit}
                                canEdit={canEditMember}
                                canHistory={canReadMemberHistory}
                                canRetry={canRetryMemberSync}
                                paymentLocked={isPaymentLocked}
                                canRenew={canCompensate}
                                renewalBusy={controller.renewalBusy}
                                onRenewalBusyChange={controller.setRenewalBusy}
                                onRenewalSucceeded={controller.refreshAfterRenewal}
                                member={member}
                                shopId={shopId}
                                warehouseId={auth.effectiveWarehouseId || ""}
                                fetchedAt={fetchedAt}
                                activity={memberActivity}
                                packageSale={memberPackageSale}
                            />
                        ) : operation === "COMPENSATION" && member ? (
                            <MemberCompensationPanel
                                member={member}
                                fetchedAt={fetchedAt}
                                activity={memberActivity}
                                compensation={compensation}
                            />
                        ) : request.status === "FAILED" ? (
                            <div className="flex min-h-72 flex-col items-center justify-center rounded-3xl border border-red-200 bg-red-50 p-8 text-center">
                                <SearchX className="mb-3 size-10 text-red-500" />
                                <h2 className="text-lg font-extrabold text-red-800">Không thể hiển thị thành viên</h2>
                                <p className="mt-2 text-sm text-red-700">{request.errorMessage}</p>
                                <p className="mt-3 text-xs font-semibold text-red-500">
                                    Mã lỗi: {request.errorCode || "không xác định"}
                                </p>
                            </div>
                        ) : (
                            <div className="flex min-h-72 flex-col items-center justify-center rounded-3xl border border-dashed border-[var(--color-border-subtle)] bg-white p-8 text-center">
                                <MonitorCheck className="mb-3 size-11 text-orange-300" />
                                <h2 className="text-lg font-extrabold">
                                    {operation === "COMPENSATION"
                                        ? "Tra cứu trước khi nạp bù"
                                        : "Tra cứu thành viên"}
                                </h2>
                                <p className="mt-2 max-w-md text-sm text-[var(--color-text-muted)]">
                                    {operation === "COMPENSATION"
                                        ? "Chọn đúng khách hàng trước khi thực hiện điều chỉnh số dư."
                                        : "Nhập số điện thoại hoặc mã thẻ để tải dữ liệu mới nhất từ OpenAPI."}
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </main>
            {operation === "COMPENSATION" && member && compensation.isConfirmOpen ? (
                <MemberCompensationConfirmModal
                    member={member}
                    draft={compensation.draft}
                    warehouseName={
                        auth.effectiveWarehouseName || auth.effectiveWarehouseId || "Điểm bán hiện tại"
                    }
                    busy={
                        compensation.mutation.kind === "COMPENSATION_TOP_UP" &&
                        compensation.mutation.status === "WAITING_API"
                    }
                    onClose={compensation.closeConfirmation}
                    onConfirm={() => void compensation.submit()}
                />
            ) : null}
            {operation === "LOOKUP" && member && memberPackageSale.isCheckoutOpen && memberPackageSale.selectedPackage ? (
                <CheckoutModal
                    title="Thanh toán gói thành viên"
                    subtitle={`${memberPackageSale.selectedPackage.name} · ${formatCurrency(memberPackageSale.selectedPackage.paymentAmountVnd)}`}
                    confirmButtonId={memberPackageSale.paymentMethod === "QR_CODE" ? "member-package-start-qr" : undefined}
                    paymentMethod={memberPackageSale.paymentMethod}
                    paymentMethods={JPOS_PAYMENT_METHODS}
                    payOSPayment={memberPackageSale.payOSPayment}
                    totalAmount={memberPackageSale.selectedPackage.paymentAmountVnd}
                    finalAmount={memberPackageSale.selectedPackage.paymentAmountVnd}
                    itemCount={1}
                    isCheckingOut={
                        memberPackageSale.mutation.kind === "PACKAGE_TOP_UP" &&
                        ["WAITING_PAYMENT", "WAITING_API"].includes(memberPackageSale.mutation.status)
                    }
                    onSetPaymentMethod={memberPackageSale.setPaymentMethod}
                    onClose={memberPackageSale.closeCheckout}
                    onConfirm={memberPackageSale.sellForCash}
                    onStartTransfer={memberPackageSale.startQrPayment}
                />
            ) : null}
        </div>
    );
}
