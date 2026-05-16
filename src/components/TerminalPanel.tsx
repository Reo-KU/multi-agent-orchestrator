import type { ReactElement } from "react";

// TODO: Pane2 and Pane3 will connect xterm.js to PTY output events.
export default function TerminalPanel(): ReactElement {
  return <section className="h-40 border-t border-slate-800 p-4">Terminal Outputs</section>;
}
