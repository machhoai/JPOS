"use client";

import { useEffect, useId, useRef, useState, type InputHTMLAttributes } from "react";
import { CalendarDays } from "lucide-react";
import { formatDateInputValue, parseDateInputValue } from "@/lib/utils/dateFormat";

interface DateInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange" | "min" | "max"> {
    type?: "date" | "datetime-local";
    value: string;
    min?: string;
    max?: string;
    onValueChange: (value: string) => void;
}

/** Fixed display format with an ISO value and the browser's calendar picker. */
const DateInput: React.FC<DateInputProps> = ({ type = "date", value, min, max, onValueChange, className, disabled, id, ...props }) => {
    const generatedId = useId();
    const picker = useRef<HTMLInputElement>(null);
    const input = useRef<HTMLInputElement>(null);
    const [previousValue, setPreviousValue] = useState(value);
    const [draft, setDraft] = useState(() => formatDateInputValue(value));
    const [focused, setFocused] = useState(false);
    if (previousValue !== value) {
        setPreviousValue(value);
        if (!focused) setDraft(formatDateInputValue(value));
    }
    const withTime = type === "datetime-local";
    const pattern = withTime ? "dd/mm/yyyy hh:mm" : "dd/mm/yyyy";
    const parsedDraft = draft === "" ? "" : parseDateInputValue(draft, withTime);
    const invalidDraft = parsedDraft === null || Boolean(parsedDraft && ((min && parsedDraft < min) || (max && parsedDraft > max)));
    const validationMessage = invalidDraft ? `Vui lòng nhập ngày hợp lệ theo ${pattern}${min || max ? " trong khoảng cho phép" : ""}.` : "";
    useEffect(() => { input.current?.setCustomValidity(validationMessage); }, [validationMessage]);
    return <span className="relative grid w-full min-w-0 flex-1">
        <input {...props} id={id ?? generatedId} ref={input} type="text" disabled={disabled}
            value={draft} placeholder={pattern} maxLength={withTime ? 16 : 10} aria-invalid={invalidDraft || props["aria-invalid"]}
            className={className} style={{ ...props.style, paddingRight: "2.75rem" }}
            onFocus={event => { setFocused(true); props.onFocus?.(event); }}
            onBlur={event => {
                setFocused(false);
                if (event.target.validity.valid) setDraft(formatDateInputValue(value));
                props.onBlur?.(event);
            }}
            onChange={event => {
                const text = event.target.value;
                setDraft(text);
                const parsed = text === "" ? "" : parseDateInputValue(text, withTime);
                const valid = parsed !== null && (!parsed || ((!min || parsed >= min) && (!max || parsed <= max)));
                event.target.setCustomValidity(valid ? "" : `Vui lòng nhập ngày hợp lệ theo ${pattern}${min || max ? " trong khoảng cho phép" : ""}.`);
                // Invalid drafts must not leave a stale date available to report actions.
                const nextValue = valid ? parsed! : "";
                onValueChange(nextValue);
            }} />
        <button type="button" disabled={disabled} aria-label={withTime ? "Chọn ngày và giờ" : "Chọn ngày"}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-[var(--color-text-muted)] disabled:opacity-50"
            onClick={() => {
                try { picker.current?.showPicker(); }
                catch { input.current?.focus(); }
            }}><CalendarDays className="size-4" /></button>
        <input ref={picker} type={type} value={value} min={min} max={max} disabled={disabled}
            tabIndex={-1} aria-hidden="true" className="pointer-events-none absolute bottom-0 left-0 h-px w-px opacity-0"
            onChange={event => {
                const nextValue = event.target.value;
                setDraft(formatDateInputValue(nextValue));
                setPreviousValue(nextValue);
                input.current?.setCustomValidity("");
                onValueChange(nextValue);
            }} />
    </span>;
};

export default DateInput;
