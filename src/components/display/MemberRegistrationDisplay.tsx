import { formatDate } from "@/lib/utils/dateFormat";
import { CalendarDays, CheckCircle2, Coins, Mail, Phone, Repeat2, UserRound, WalletCards } from "lucide-react";
import type { CustomerDisplayMemberState } from "@/lib/types/customerDisplay";
import type { CustomerDisplayLanguage } from "@/lib/types/customerDisplayControl";
import { getCustomerDisplayCopy, getCustomerDisplayLocale } from "@/lib/utils/customerDisplayI18n";

interface MemberRegistrationDisplayProps {
    state: CustomerDisplayMemberState;
    language: CustomerDisplayLanguage;
}

export default function MemberRegistrationDisplay({ state, language }: MemberRegistrationDisplayProps) {
    const isSuccess = state.mode === "MEMBER_SUCCESS";
    const balances = state.member.balances ?? null;
    const copy = getCustomerDisplayCopy(language);
    const pointFormatter = new Intl.NumberFormat(getCustomerDisplayLocale(language), {
        maximumFractionDigits: 2,
    });
    const details = [
        { icon: Phone, label: copy.phone, value: state.member.phone || "" },
        { icon: UserRound, label: copy.gender, value: copy.genders[state.member.gender] },
        { icon: CalendarDays, label: copy.birthDate, value: formatDate(state.member.birthDate) || copy.notEntered },
        { icon: Mail, label: copy.email, value: state.member.email || copy.notEntered },
    ];
    const balanceItems = balances ? [
        { label: copy.vndAccount, value: balances.principalVnd, unit: copy.currencyUnit, icon: WalletCards, tone: "bg-blue-50 text-blue-700" },
        { label: copy.bonusPoints, value: balances.bonus, unit: copy.points, icon: Coins, tone: "bg-amber-50 text-amber-700" },
        { label: copy.integralPoints, value: balances.integral, unit: copy.points, icon: Coins, tone: "bg-violet-50 text-violet-700" },
        { label: copy.turns, value: balances.turns ?? 0, unit: copy.turnUnit, icon: Repeat2, tone: "bg-orange-50 text-orange-700" },
    ] : [];

    return (
        <section className={`flex min-h-[320px] flex-col overflow-hidden rounded-[var(--radius-xl)] border bg-white shadow-[var(--shadow-md)] ${isSuccess ? "border-emerald-200" : "border-[var(--color-border)]"}`} aria-live="polite">
            <header className="flex items-center gap-3 border-b border-[var(--color-border)] p-3">
                <span className={`rounded-xl p-2.5 ${isSuccess ? "bg-emerald-50 text-emerald-600" : "bg-[var(--color-accent-subtle)] text-[var(--color-accent)]"}`}>
                    {isSuccess ? <CheckCircle2 className="size-6" /> : <UserRound className="size-6" />}
                </span>
                <div>
                    <h1 className="text-xl font-extrabold text-[var(--color-text-primary)]">{isSuccess ? state.memberAction === "EDIT" ? copy.profileUpdateSuccess : copy.registrationSuccess : copy.memberInformation}</h1>
                    <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">{isSuccess ? state.memberAction === "EDIT" ? copy.profileUpdateThanks : copy.registrationThanks : copy.liveFromCashier}</p>
                </div>
            </header>

            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-3">
                <div className={`rounded-2xl p-2 ${isSuccess ? "bg-emerald-50" : "bg-orange-50"}`}>
                    <p className="text-sm font-medium text-[var(--color-text-muted)]">{copy.fullName}</p>
                    <p className="break-words text-xl font-bold text-[var(--color-text-primary)]">{state.member.fullName || ""}</p>
                    {balances ? (
                        <p className="mt-2 flex items-center gap-2 text-base font-medium text-[var(--color-text-secondary)]">
                            <Phone className="size-4 text-[var(--color-accent)]" />
                            {state.member.phone || copy.notUpdated}
                        </p>
                    ) : state.member.memberCode ? (
                        <p className="mt-2 text-sm font-bold text-emerald-700">{copy.cardCode}: {state.member.memberCode}</p>
                    ) : null}
                </div>

                {balances ? (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                        {balanceItems.map(({ icon: Icon, label, value, unit, tone }) => (
                            <div key={label} className={`flex min-h-0 py-2 items-center gap-3 rounded-2xl px-4 ${tone}`}>
                                <Icon className="size-6 shrink-0" />
                                <div className="min-w-0">
                                    <p className="text-xs font-bold opacity-75">{label}</p>
                                    <p className="mt-1 text-xl font-black">{pointFormatter.format(value)} {unit}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="mt-3 grid gap-2">
                        {details.map(({ icon: Icon, label, value }) => (
                            <div key={label} className="flex min-h-16 items-center gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-4">
                                <Icon className="size-5 shrink-0 text-[var(--color-accent)]" />
                                <div className="min-w-0"><p className="text-xs font-semibold text-[var(--color-text-muted)]">{label}</p><p className="break-words text-base font-extrabold">{value}</p></div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </section>
    );
}
