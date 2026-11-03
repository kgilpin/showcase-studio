import type { ReactNode } from "react";

import type { WindowArt } from "../content";
import { Markup } from "./Markup";

/* A window with a title bar and preformatted text: a folder tree, a
 * terminal. The text comes from content/*.yaml with <dir> round a folder
 * name, <note> round a soft aside, <sha> round a commit hash, and
 * <pin>n</pin> where the Features page numbers an item (pin draws it). */
export function Window({ art, pin }: { art: WindowArt; pin?: (n: number) => ReactNode }) {
  return (
    <div className="chat tree" role="img" aria-label={art.label}>
      <WindowBar title={art.title} />
      <pre>
        <code>
          <Markup
            text={art.text}
            render={(tag) => {
              switch (tag.tag) {
                case "dir":
                case "note":
                case "sha":
                  return <span className={tag.tag}>{tag.body}</span>;
                case "pin":
                  return pin ? pin(Number(tag.body)) : "";
                default:
                  return null;
              }
            }}
          />
        </code>
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
