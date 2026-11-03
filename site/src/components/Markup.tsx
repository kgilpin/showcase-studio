import { Fragment, type ReactNode } from "react";

import { href, parseMarkup, type Tag } from "../markup";

/* Text from content/*.yaml, with its inline tags rendered (src/markup.ts
 * lists them). Anything else in angle brackets is shown as written,
 * unless render draws it: the Window component's <dir>, <note>, <sha> and
 * <pin>. */
export function Markup({
  text,
  render,
}: {
  text: string;
  /* Renders the tags this component doesn't; null leaves one as written. */
  render?: (tag: Tag) => ReactNode | null;
}) {
  return (
    <>
      {parseMarkup(text).map((part, i) => {
        if (typeof part === "string") return <Fragment key={i}>{part}</Fragment>;
        const custom = render?.(part);
        if (custom !== undefined && custom !== null) return <Fragment key={i}>{custom}</Fragment>;
        switch (part.tag) {
          case "strong":
            return <strong key={i}>{part.body}</strong>;
          case "code":
            return <code key={i}>{part.body}</code>;
          case "small":
            return <small key={i}>{part.body}</small>;
          case "mark":
            return <mark key={i}>{part.body}</mark>;
          case "a":
            return (
              <a key={i} href={href(part)}>
                {part.body}
              </a>
            );
          default:
            return <Fragment key={i}>{`<${part.tag}>${part.body}</${part.tag}>`}</Fragment>;
        }
      })}
    </>
  );
}
