import { CopyBlock } from "./CopyBlock";

/* The two ways to install, side by side: the Claude Code plugin and the
 * desktop app. On the home page and the Download page; heading is the
 * level the cards' titles take on that page. */
export function InstallOptions({ heading: Heading = "h3" }: { heading?: "h2" | "h3" }) {
  return (
    <div className="download-grid">
      <div className="card">
        <p className="pill">Recommended</p>
        <Heading>Use it in Claude Code</Heading>
        <p>In a terminal:</p>
        <CopyBlock
          text={
            "claude plugin marketplace add kgilpin/showcase-studio\nclaude plugin install showcase-studio@showcase-studio"
          }
        />
        <p>
          Then start Claude Code in a folder for your showcases and run{" "}
          <code>/showcase-studio:showcase new</code>. The app installs itself the first time, and it
          all runs on the Claude Code subscription you already have.
        </p>
      </div>

      <p className="or" aria-hidden="true">
        or
      </p>

      <div className="card">
        <Heading>Use the desktop app</Heading>
        <p>
          Open a folder for your showcases, and work with Claude in the app's terminal. On a Mac,
          unzip it and move it to Applications.
        </p>
        {/* /download/latest/* redirects to the newest release (worker.js). */}
        <div className="downloads">
          <a className="button" href="/download/latest/mac">
            Mac <small>Apple Silicon</small>
          </a>
          <a className="button" href="/download/latest/win">
            Windows <small>x64</small>
          </a>
        </div>
        <p className="small">
          SHA-256 checksums: <a href="/download/latest/mac.sha256">Mac</a>,{" "}
          <a href="/download/latest/win.sha256">Windows</a>.
        </p>
      </div>
    </div>
  );
}
