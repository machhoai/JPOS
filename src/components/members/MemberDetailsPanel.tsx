import MemberProfileEditForm from "@/components/members/MemberProfileEditForm";
import MemberProfileEditHistory, { memberProfileSyncLabels } from "@/components/members/MemberProfileEditHistory";
import type { useMemberProfileEditController } from "@/lib/hooks/useMemberProfileEditController";
import { useState } from "react";
import { Coins, CreditCard, History, TicketCheck, UserRound } from "lucide-react";
import MemberCardList from "@/components/members/MemberCardList";
import MemberPackageCatalog from "@/components/members/MemberPackageCatalog";
import MemberPassTicketList from "@/components/members/MemberPassTicketList";
import MemberProfileCard from "@/components/members/MemberProfileCard";
import MemberRenewalPanel from "@/components/members/MemberRenewalPanel";
import MemberStoredValueHistoryView from "@/components/members/MemberStoredValueHistory";
import type { useMemberActivityController } from "@/lib/hooks/useMemberActivityController";
import type { useMemberPackageSaleController } from "@/lib/hooks/useMemberPackageSaleController";
import type { MemberProfile } from "@/lib/types/member";

type MemberDetailTab = "EDIT_HISTORY" | "HISTORY" | "PROFILE" | "TOP_UP" | "TICKETS" | "CARDS" | "RENEWAL";
type MemberActivityController = ReturnType<typeof useMemberActivityController>;
type MemberPackageSaleController = ReturnType<typeof useMemberPackageSaleController>;

const tabs = [
    { id: "PROFILE", label: "Hồ sơ", icon: UserRound },
    { id: "TOP_UP", label: "Nạp thẻ", icon: Coins },
    { id: "RENEWAL", label: "Gia hạn", icon: History },
    { id: "EDIT_HISTORY", label: "Lịch sử chỉnh sửa", icon: History },
    { id: "HISTORY", label: "Biến động", icon: History },
    { id: "TICKETS", label: "Vé / gói", icon: TicketCheck },
    { id: "CARDS", label: "Thẻ", icon: CreditCard },
] as const;

interface MemberDetailsPanelProps {
    profileEdit: ReturnType<typeof useMemberProfileEditController>;
    canEdit: boolean;
    canHistory: boolean;
    canRetry: boolean;
    paymentLocked: boolean;
    canRenew: boolean;
    renewalBusy: boolean;
    onRenewalBusyChange: (busy: boolean) => void;
    onRenewalSucceeded: () => Promise<void>;
    member: MemberProfile;
    shopId: number;
    warehouseId: string;
    fetchedAt: string | null;
    activity: MemberActivityController;
    packageSale: MemberPackageSaleController;
}

const MemberDetailsPanel: React.FC<MemberDetailsPanelProps> = ({ member, shopId, warehouseId, fetchedAt, activity, packageSale, profileEdit, canEdit, canHistory, canRetry, paymentLocked, canRenew, renewalBusy, onRenewalBusyChange, onRenewalSucceeded }) => {
    const [tab, setTab] = useState<MemberDetailTab>("PROFILE");

    return <div className="min-w-0 space-y-3 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:space-y-0 lg:gap-3">
        <nav aria-label="Chi tiết thành viên" className="shrink-0 overflow-x-auto rounded-full border border-[var(--color-border)] bg-white p-1.5 shadow-sm">
            <div className="flex min-w-max gap-1" role="tablist">{tabs.filter(item => (item.id !== "EDIT_HISTORY" || canHistory) && (item.id !== "RENEWAL" || canRenew)).map(({ id, label, icon: Icon }) => <button key={id} type="button" role="tab" aria-selected={tab === id} disabled={renewalBusy || profileEdit.saving || profileEdit.uncertain || (id === "RENEWAL" && paymentLocked)} onClick={() => { if (profileEdit.editing || profileEdit.saved) { if (!profileEdit.cancel()) return; } profileEdit.setHistoryVisible(id === "PROFILE" || id === "EDIT_HISTORY"); setTab(id); }} className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-bold transition-colors ${tab === id ? "bg-[var(--color-accent)] text-white shadow-[var(--shadow-glow)]" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"}`}><Icon className="size-4" />{label}</button>)}</div>
        </nav>

        <div className="min-w-0 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
            {tab === "RENEWAL" && canRenew ? <MemberRenewalPanel member={member} shopId={shopId} warehouseId={warehouseId} onBusyChange={onRenewalBusyChange} onSucceeded={onRenewalSucceeded} /> : null}
            {tab === "PROFILE" ? <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white p-3">
                    <p className="text-sm font-semibold">{memberProfileSyncLabels[member.syncStatus ?? "SYNCED"]}{(member.profileRevision ?? 0) > (member.remoteConfirmedRevision ?? 0) ? " · Thông tin POS mới hơn HK" : ""}</p>
                    {canEdit && !profileEdit.editing && <button type="button" disabled={paymentLocked} onClick={() => profileEdit.start()} className="rounded-xl bg-[var(--color-accent)] px-4 py-3 text-sm font-bold text-white disabled:opacity-50">Chỉnh sửa thông tin</button>}
                </div>
                {profileEdit.editing && profileEdit.draft ? <MemberProfileEditForm draft={profileEdit.draft} saving={profileEdit.saving} uncertain={profileEdit.uncertain} canSave={Boolean(profileEdit.canSave)} error={profileEdit.error ?? profileEdit.validationError} onChange={profileEdit.change} onSave={() => void profileEdit.save()} onCancel={profileEdit.cancel} onReload={() => void profileEdit.reloadEditor()} /> : <MemberProfileCard member={member} fetchedAt={fetchedAt} />}
            </div> : null}
            {tab === "EDIT_HISTORY" && canHistory ? <MemberProfileEditHistory changes={profileEdit.changes} loading={profileEdit.loadingHistory} error={profileEdit.historyError} hasMore={profileEdit.nextCursor !== null} canRetry={canRetry} onReload={() => void profileEdit.loadHistory()} onMore={() => void profileEdit.loadHistory(true)} onRetry={id => void profileEdit.retry(id)} onResolve={id => { profileEdit.start(id); setTab("PROFILE"); }} /> : null}
            {tab === "TOP_UP" ? <div className="space-y-3">
                <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-orange-700">Nạp thẻ cho thành viên</p>
                    <p className="mt-1 font-extrabold text-[var(--color-text-primary)]">{member.fullName || "Khách thành viên"}</p>
                    <p className="text-sm font-semibold text-[var(--color-text-secondary)]">{member.phone || member.memberCode || "Chưa có số điện thoại"}</p>
                </div>
                <MemberPackageCatalog packages={packageSale.packages} request={packageSale.packagesRequest} selectedPackage={packageSale.selectedPackage} mutation={packageSale.mutation} canRetryRemote={packageSale.canRetryRemote} onSelect={packageSale.selectPackage} onReload={() => void packageSale.loadPackages()} onBuy={packageSale.openCheckout} onRetryRemote={packageSale.retryRemoteSale} />
            </div> : null}
            {tab === "HISTORY" ? <MemberStoredValueHistoryView status={activity.history.status} history={activity.history.data} error={activity.history.error} category={activity.storedCategory} startDate={activity.startDate} endDate={activity.endDate} onCategoryChange={activity.setStoredCategory} onStartDateChange={activity.setStartDate} onEndDateChange={activity.setEndDate} onReload={(page) => void activity.loadHistory(page)} /> : null}
            {tab === "TICKETS" ? <MemberPassTicketList status={activity.tickets.status} tickets={activity.tickets.data} error={activity.tickets.error} onReload={() => void activity.loadTickets()} /> : null}
            {tab === "CARDS" ? <MemberCardList status={activity.cards.status} cards={activity.cards.data} error={activity.cards.error} member={member} shopId={shopId} warehouseId={warehouseId} onReload={() => void activity.loadCards()} /> : null}
        </div>
    </div>;
};

export default MemberDetailsPanel;
