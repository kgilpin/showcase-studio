import type { ReactNode } from "react";

/* A window with a title bar and preformatted text: a folder tree, a
 * terminal. */
export function Window({
  title,
  label,
  children,
}: {
  title: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="chat tree" role="img" aria-label={label}>
      <WindowBar title={title} />
      <pre>
        <code>{children}</code>
      </pre>
    </div>
  );
}

export function WindowBar({ title }: { title: string }) {
  return (
    <div className="chat-bar" aria-hidden="true">
      <i />
      <i />
      <i />
      {title}
    </div>
  );
}

/* Spans for the window's text: a folder name, a soft note, a commit hash. */
export const Dir = ({ children }: { children: ReactNode }) => (
  <span className="dir">{children}</span>
);
export const Note = ({ children }: { children: ReactNode }) => (
  <span className="note">{children}</span>
);
export const Sha = ({ children }: { children: ReactNode }) => (
  <span className="sha">{children}</span>
);
