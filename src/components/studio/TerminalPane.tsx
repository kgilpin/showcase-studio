import { useEffect, useRef } from "react";
import { studio } from "@/lib/studio";

/* An xterm.js view attached to one showcase's persistent PTY session
 * (the user's own Claude Code running in that showcase's folder). The
 * session lives in the shell: unmounting detaches the view but leaves
 * the session running, and remounting replays its scrollback. xterm is
 * loaded dynamically so the web build never evaluates it. */
export function TerminalPane({
  sessionId,
  onExit,
}: {
  sessionId: string;
  onExit?: (code: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bridge = studio();
    const host = hostRef.current;
    if (!bridge?.terminal || !host) return;
    let disposed = false;
    const cleanups: (() => void)[] = [];

    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      await import("@xterm/xterm/css/xterm.css");
      if (disposed) return;

      const term = new Terminal({
        fontSize: 12,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        cursorBlink: true,
        theme: { background: "#0a0e19" },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host);
      fit.fit();
      cleanups.push(() => term.dispose());

      cleanups.push(
        bridge.terminal.onData(({ id, data }) => {
          if (id === sessionId) term.write(data);
        }),
      );
      if (onExit) {
        cleanups.push(
          bridge.terminal.onExit(({ id, code }) => {
            if (id === sessionId) onExit(code);
          }),
        );
      }
      const inputDisposable = term.onData((data) => bridge.terminal.input({ id: sessionId, data }));
      cleanups.push(() => inputDisposable.dispose());

      const observer = new ResizeObserver(() => {
        fit.fit();
        bridge.terminal.resize({ id: sessionId, cols: term.cols, rows: term.rows });
      });
      observer.observe(host);
      cleanups.push(() => observer.disconnect());

      /* Drag-and-drop, system-terminal style: dropping files types their
       * shell-quoted paths; dropping text types the text. */
      const quote = (p: string) => (/^[\w./-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`);
      const onDragOver = (e: DragEvent) => e.preventDefault();
      const onDrop = (e: DragEvent) => {
        e.preventDefault();
        const files = [...(e.dataTransfer?.files ?? [])];
        const data =
          files.length > 0
            ? files.map((file) => quote(bridge.terminal.pathForFile(file))).join(" ") + " "
            : (e.dataTransfer?.getData("text") ?? "");
        if (data) bridge.terminal.input({ id: sessionId, data });
        term.focus();
      };
      host.addEventListener("dragover", onDragOver);
      host.addEventListener("drop", onDrop);
      cleanups.push(() => {
        host.removeEventListener("dragover", onDragOver);
        host.removeEventListener("drop", onDrop);
      });

      const started = await bridge.terminal.start({
        id: sessionId,
        cols: term.cols,
        rows: term.rows,
      });
      if (started.buffer) term.write(started.buffer);
      if (!started.ok && started.error) term.write(`\r\n${started.error}\r\n`);
      term.focus();
    })();

    /* Detach only — the session keeps running in the shell. */
    return () => {
      disposed = true;
      cleanups.forEach((cleanup) => cleanup());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  return <div ref={hostRef} className="h-full w-full" style={{ background: "#0a0e19" }} />;
}
