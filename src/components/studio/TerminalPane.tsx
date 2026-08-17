import { useEffect, useRef } from "react";
import { studio } from "@/lib/studio";

/* An xterm.js view over the shell's PTY (the user's own Claude Code
 * running in the showcases folder). xterm is loaded dynamically so the
 * web build never evaluates it. */
export function TerminalPane({ onExit }: { onExit?: (code: number) => void }) {
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

      cleanups.push(bridge.terminal.onData((data) => term.write(data)));
      if (onExit) cleanups.push(bridge.terminal.onExit(onExit));
      const inputDisposable = term.onData((data) => bridge.terminal.input(data));
      cleanups.push(() => inputDisposable.dispose());

      const observer = new ResizeObserver(() => {
        fit.fit();
        bridge.terminal.resize({ cols: term.cols, rows: term.rows });
      });
      observer.observe(host);
      cleanups.push(() => observer.disconnect());

      const started = await bridge.terminal.start({ cols: term.cols, rows: term.rows });
      if (!started.ok && started.error) term.write(`\r\n${started.error}\r\n`);
      term.focus();
    })();

    return () => {
      disposed = true;
      cleanups.forEach((cleanup) => cleanup());
      void studio()?.terminal.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={hostRef} className="h-full w-full" style={{ background: "#0a0e19" }} />;
}
