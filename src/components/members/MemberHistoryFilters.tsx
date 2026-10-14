import DateInput from "@/components/ui/DateInput";
import { useState } from "react";
import {
  IoCalendarOutline,
  IoEllipsisHorizontal,
  IoGameControllerOutline,
  IoGiftOutline,
  IoLayersOutline,
  IoRepeatOutline,
} from "react-icons/io5";
import { memberHistoryCategories } from "@/components/members/memberHistoryPresentation";
import type {
  MemberStoredValueCategory,
  MemberStoredValueCategoryFilter,
} from "@/lib/types/member";

const primaryCategories = [
  { value: 1, label: "Tiền", icon: IoGameControllerOutline },
  { value: 2, label: "Điểm thưởng", icon: IoGiftOutline },
  { value: 6, label: "Lượt", icon: IoRepeatOutline },
] as const;
const otherCategories: MemberStoredValueCategory[] = [4, 5, 7];
const rangePresets = [7, 30, 90] as const;

function toDateValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getPresetDates(days: number): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days + 1);
  return { startDate: toDateValue(start), endDate: toDateValue(end) };
}

interface MemberHistoryFiltersProps {
  category: MemberStoredValueCategoryFilter;
  startDate: string;
  endDate: string;
  disabled: boolean;
  onCategoryChange: (category: MemberStoredValueCategoryFilter) => void;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
}

const MemberHistoryFilters: React.FC<MemberHistoryFiltersProps> = ({
  category,
  startDate,
  endDate,
  disabled,
  onCategoryChange,
  onStartDateChange,
  onEndDateChange,
}) => {
  const [customDatesVisible, setCustomDatesVisible] = useState(false);
  const activePreset = rangePresets.find((days) => {
    const preset = getPresetDates(days);
    return startDate === preset.startDate && endDate === preset.endDate;
  });
  const showCustomDates = customDatesVisible || activePreset === undefined;
  const otherCategory = typeof category === "number" && otherCategories.includes(category)
    ? category
    : "";

  const selectPreset = (days: number): void => {
    const preset = getPresetDates(days);
    setCustomDatesVisible(false);
    onStartDateChange(preset.startDate);
    onEndDateChange(preset.endDate);
  };

  return (
    <div className="space-y-4 border-b border-[var(--color-border)] bg-[var(--color-surface-alt)] p-4">
      <div>
        <p className="mb-2 text-xs font-bold text-[var(--color-text-secondary)]">Loại số dư</p>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Loại số dư">
          {primaryCategories.map(({ value, label, icon: Icon }) => {
            const active = category === value;
            return (
              <button key={value} type="button" role="tab" aria-selected={active} disabled={disabled} onClick={() => onCategoryChange(value)} className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-3.5 text-sm font-extrabold transition-colors disabled:opacity-50 ${active ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white shadow-sm" : "border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] hover:border-orange-300"}`}>
                <Icon className="size-5" /> {label}
              </button>
            );
          })}

          <div className={`relative rounded-xl border bg-white ${otherCategory ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "border-[var(--color-border)] text-[var(--color-text-secondary)]"}`}>
            <IoEllipsisHorizontal className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2" />
            <select aria-label="Các loại số dư khác" value={otherCategory} disabled={disabled} onChange={(event) => onCategoryChange(Number(event.target.value) as MemberStoredValueCategory)} className="min-h-11 appearance-none rounded-xl bg-transparent pl-10 pr-8 text-sm font-extrabold outline-none disabled:opacity-50">
              <option value="" disabled>Khác</option>
              {otherCategories.map((value) => <option key={value} value={value}>{memberHistoryCategories[value].label}</option>)}
            </select>
          </div>

          <button type="button" role="tab" aria-selected={category === "ALL"} disabled={disabled} onClick={() => onCategoryChange("ALL")} className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-3.5 text-sm font-extrabold transition-colors disabled:opacity-50 ${category === "ALL" ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white shadow-sm" : "border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] hover:border-orange-300"}`}>
            <IoLayersOutline className="size-5" /> Tất cả
          </button>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-bold text-[var(--color-text-secondary)]">Khoảng thời gian</p>
        <div className="flex flex-wrap gap-2">
          {rangePresets.map((days) => <button key={days} type="button" disabled={disabled} onClick={() => selectPreset(days)} className={`min-h-10 rounded-xl px-3 text-sm font-bold disabled:opacity-50 ${!customDatesVisible && activePreset === days ? "bg-[var(--color-text-primary)] text-white" : "border border-[var(--color-border)] bg-white text-[var(--color-text-secondary)]"}`}>{days} ngày</button>)}
          <button type="button" disabled={disabled} onClick={() => setCustomDatesVisible(true)} className={`inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-bold disabled:opacity-50 ${showCustomDates ? "bg-[var(--color-text-primary)] text-white" : "border border-[var(--color-border)] bg-white text-[var(--color-text-secondary)]"}`}>
            <IoCalendarOutline className="size-4" /> Tùy chọn
          </button>
        </div>
      </div>

      {showCustomDates ? <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-bold text-[var(--color-text-secondary)]">Từ ngày
          <DateInput type="date" value={startDate} max={endDate} onValueChange={onStartDateChange} disabled={disabled} className="mt-1.5 min-h-11 w-full rounded-xl border border-[var(--color-border)] bg-white px-3 text-sm font-semibold" />
        </label>
        <label className="text-xs font-bold text-[var(--color-text-secondary)]">Đến ngày
          <DateInput type="date" value={endDate} min={startDate} onValueChange={onEndDateChange} disabled={disabled} className="mt-1.5 min-h-11 w-full rounded-xl border border-[var(--color-border)] bg-white px-3 text-sm font-semibold" />
        </label>
      </div> : null}
    </div>
  );
};

export default MemberHistoryFilters;
