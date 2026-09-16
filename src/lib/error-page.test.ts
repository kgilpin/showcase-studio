import { describe, expect, it } from "vitest";
import { renderErrorPage } from "./error-page";

describe("renderErrorPage", () => {
  it("shows no details by default", () => {
    const html = renderErrorPage();
    expect(html).toContain("This page didn't load");
    expect(html).not.toContain("<details>");
  });

  it("shows the message, stack and page in a collapsed Details section, escaped", () => {
    const html = renderErrorPage({
      message: `Cannot find module '@/content/showcases' <script>alert("x")</script>`,
      stack: "at load (src/routes/__root.tsx:3) & more",
      path: "/showcase/<b>nova</b>",
    });
    expect(html).toContain("<details>");
    expect(html).not.toContain("<details open");
    expect(html).toContain("<summary>Details</summary>");
    expect(html).toContain(
      "Cannot find module &#39;@/content/showcases&#39; &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
    expect(html).toContain("at load (src/routes/__root.tsx:3) &amp; more");
    expect(html).toContain("GET /showcase/&lt;b&gt;nova&lt;/b&gt;");
    expect(html).not.toContain("<script>alert");
  });
});
