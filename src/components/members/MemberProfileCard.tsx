import { formatDate, formatDateTime } from "@/lib/utils/dateFormat";
import { CalendarDays, CreditCard, Mail, Phone, Star, UserRound } from "lucide-react";
import type { MemberGender, MemberProfile } from "@/lib/types/member";

const pointFormatter = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });

function genderLabel(gender: MemberGender): string {
    return { MALE: "Nam", FEMALE: "Nữ", OTHER: "Khác", UNKNOWN: "Chưa cập nhật" }[gender];
}

function balanceValue(value: number, unit: string): string {
    return `${pointFormatter.format(value)} ${unit}`;
}

interface MemberProfileCardProps {
    member: MemberProfile;
    fetchedAt: string | null;
}

export default function MemberProfileCard({ member, fetchedAt }: MemberProfileCardProps) {
    const initial = member.fullName.trim().charAt(0).toUpperCase() || "T";
    const details = [
        { icon: Phone, label: "Điện thoại", value: member.phone || "Chưa cập nhật" },
        { icon: CreditCard, label: "Mã thẻ", value: member.memberCode || "Chưa cấp thẻ" },
        { icon: CalendarDays, label: "Ngày sinh", value: formatDate(member.birthDate) || "Chưa cập nhật" },
        { icon: UserRound, label: "Giới tính", value: genderLabel(member.gender) },
        { icon: Mail, label: "Email", value: member.email || "Chưa cập nhật" },
    ];
    const balances = [
        { label: "Tài khoản VND", value: member.balances.principalVnd, unit: "đ", tone: "text-blue-700 bg-blue-50" },
        { label: "Tiền thưởng", value: member.balances.bonus, unit: "đ", tone: "text-amber-700 bg-amber-50" },
        { label: "Tổng khả dụng", value: member.balances.totalAvailable, unit: "đ", tone: "text-emerald-700 bg-emerald-50" },
        { label: "Lượt", value: member.balances.turns, unit: "lượt", tone: "text-orange-700 bg-orange-50" },
        { label: "Điểm", value: member.balances.points, unit: "điểm", tone: "text-sky-700 bg-sky-50" },
        { label: "Điểm tích lũy", value: member.balances.integral, unit: "điểm", tone: "text-violet-700 bg-violet-50" },
    ];

    return (
        <section className="overflow-hidden rounded-3xl border border-[var(--color-border)] bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-4 border-b border-[var(--color-border)] bg-gradient-to-r from-orange-50 to-white p-5">
                <div className="flex size-16 items-center justify-center rounded-2xl bg-[var(--color-accent)] text-2xl font-black text-white shadow-[var(--shadow-glow)]">
                    {initial}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-2xl font-extrabold text-[var(--color-text-primary)]">{member.fullName}</h2>
                        {member.levelName && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">
                                <Star className="size-3.5" /> {member.levelName}
                            </span>
                        )}
                    </div>
                    <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                        UID: {member.uid}{member.mid ? ` · MID: ${member.mid}` : ""}
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3 p-4 xl:grid-cols-3">
                {balances.map((balance) => (
                    <div key={balance.label} className={`rounded-2xl p-4 ${balance.tone}`}>
                        <p className="text-xs font-bold uppercase tracking-wide opacity-75">{balance.label}</p>
                        <p className="mt-2 text-xl font-black">{balanceValue(balance.value, balance.unit)}</p>
                    </div>
                ))}
            </div>

            <div className="grid gap-2 border-t border-[var(--color-border)] p-4 md:grid-cols-2">
                {details.map(({ icon: Icon, label, value }) => (
                    <div key={label} className="flex min-h-14 items-center gap-3 rounded-2xl bg-[var(--color-surface-alt)] px-4">
                        <Icon className="size-5 shrink-0 text-[var(--color-accent)]" />
                        <div className="min-w-0">
                            <p className="text-xs font-semibold text-[var(--color-text-muted)]">{label}</p>
                            <p className="truncate text-sm font-bold text-[var(--color-text-primary)]">{value}</p>
                        </div>
                    </div>
                ))}
            </div>
            {fetchedAt && (
                <p className="border-t border-[var(--color-border)] px-5 py-3 text-right text-xs text-[var(--color-text-muted)]">
                    Dữ liệu OpenAPI lúc {formatDateTime(fetchedAt, { second: "2-digit" })}
                </p>
            )}
        </section>
    );
}
