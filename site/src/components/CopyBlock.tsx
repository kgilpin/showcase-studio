import { useRef, useState } from "react";

/* Commands in a block, with a button that copies them. Without clipboard
 * access it selects the text instead, so Cmd/Ctrl+C copies it. */
export function CopyBlock({ text }: { text: string }) {
  const code = useRef<HTMLElement>(null);
  const [label, setLabel] = useState("Copy");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setLabel("Copied");
    } catch {
      if (code.current) getSelection()?.selectAllChildren(code.current);
      setLabel("Selected");
    }
    setTimeout(() => setLabel("Copy"), 2000);
  }

  return (
    <div className="copyable">
      <pre>
        <code ref={code}>{text}</code>
      </pre>
      <button className="copy" type="button" onClick={copy}>
        {label}
      </button>
    </div>
  );
}
