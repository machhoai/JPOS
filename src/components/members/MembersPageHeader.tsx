import { UsersRound } from "lucide-react";
interface Props { warehouseName: string | null; operation: "LOOKUP" | "REGISTER" | "COMPENSATION"; canCompensate: boolean; onOperationChange: (operation: "LOOKUP" | "REGISTER" | "COMPENSATION") => void }
export default function MembersPageHeader({ warehouseName, operation, canCompensate, onOperationChange }: Props) {
 return (
                <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-white px-4 py-3 md:px-6">
                    <div className="flex items-center gap-3">
                        <span className="flex size-11 items-center justify-center rounded-2xl bg-orange-50 text-[var(--color-accent)]">
                            <UsersRound className="size-6" />
                        </span>
                        <div>
                            <h1 className="text-xl font-extrabold">Thành viên</h1>
                            <p className="text-xs text-[var(--color-text-muted)]">
                                Điểm bán: {warehouseName}
                            </p>
                        </div>
                    </div>
                    <div className="flex overflow-x-auto rounded-full bg-[var(--color-surface-hover)] p-1.5">
                        {(["LOOKUP", "REGISTER", ...(canCompensate ? (["COMPENSATION"] as const) : [])] as const).map(
                            (item) => (
                                <button
                                    key={item}
                                    type="button"
                                    onClick={() => onOperationChange(item)}
                                    className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-bold ${operation === item
                                        ? "bg-white text-[var(--color-accent)] shadow-sm"
                                        : "text-[var(--color-text-secondary)]"
                                        }`}
                                >
                                    {item === "LOOKUP"
                                        ? "Tra cứu"
                                        : item === "REGISTER"
                                            ? "Đăng ký mới"
                                            : "Nạp bù"}
                                </button>
                            )
                        )}
                    </div>
                </header>
 );
}
