import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/** Click-to-edit text that keeps the exact styling of the element it
 *  replaces (the tag and classes are the caller's). Commit on blur or
 *  Enter, cancel on Escape; the caller only hears about real changes.
 *  Edits are local until commit — the model (and the file behind it)
 *  update once, so live reload never fights the caret. */
export function EditableText({
  value,
  onCommit,
  as = "span",
  className,
  label,
  placeholder,
}: {
  value: string;
  onCommit: (value: string) => void;
  as?: "h2" | "p" | "span";
  className?: string | undefined;
  label: string;
  /** Ghost text (via CSS :empty) when there is no value yet. */
  placeholder?: string | undefined;
}) {
  const Tag = as as "span";
  const ref = useRef<HTMLSpanElement>(null);
  const cancelled = useRef(false);
  /* React rendered {value} as a text node once, but contentEditable
   * typing (select-all, delete) and the Escape handler can replace that
   * node — React then updates a detached node and the screen keeps the
   * old text. Sync the DOM whenever it disagrees with the value, except
   * mid-edit: undo/redo and outside edits stay visible. */
  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && el.textContent !== value) el.textContent = value;
  });
  return (
    <Tag
      ref={ref}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      role="textbox"
      aria-label={label}
      title={label}
      data-placeholder={placeholder}
      className={cn(
        "-mx-1 cursor-text rounded-md px-1 transition-colors hover:bg-foreground/10",
        "focus:bg-transparent focus:outline-1 focus:outline-dashed focus:outline-foreground/40",
        placeholder != null &&
          "empty:before:opacity-40 empty:before:content-[attr(data-placeholder)]",
        className,
      )}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          ref.current?.blur();
        } else if (event.key === "Escape") {
          cancelled.current = true;
          if (ref.current) ref.current.textContent = value;
          ref.current?.blur();
        }
      }}
      onBlur={() => {
        if (cancelled.current) {
          cancelled.current = false;
          return;
        }
        const text = (ref.current?.textContent ?? "").replace(/\s+/g, " ").trim();
        if (text !== value) onCommit(text);
        else if (ref.current && ref.current.textContent !== value) ref.current.textContent = value;
      }}
    >
      {value}
    </Tag>
  );
}
