// Constants, UI atoms, and the step rail. Copy rules (docs/decisions-log.md, 2026-10-09): plain
// words in the lead and the rows, official terms glossed at first use, the mechanism in a
// collapsed "How this works" block. In copy: fee level (code: tier), minimum you receive
// (code: min-out), sponsor service (code: relay), sBTC into the pool (code: net input).
// The contract's own field names stay as deployed: rebate, service-fee, integrator-fee.
import React, { useState, useEffect, useRef } from "react";
import { CONTRACT, TIERS } from "@no314/sbtc-gas-swap";

export const CONTRACT_ID = `${CONTRACT.address}.${CONTRACT.name}`;
// This app is itself an integrator: 1 percent of the sBTC input (100 bips, the contract maximum)
// is paid in sBTC to this principal inside the swap. The quote, the review screen and the
// post-condition summary all derive from these two values.
export const INTEGRATOR = "SP3PCJ68JW050YKQ9106JP11TXWS46163HX7NG6XH";
export const INTEGRATOR_BIPS = 100n;
export const DOCS = "https://github.com/no314/sbtc-gas-swap/blob/main/docs";
// The footer points at where this page is published, not at the SDK source.
export const REPO = "https://github.com/no314/stx-fan/tree/main/zero_to/gas";
export const SBTC_BRIDGE = "https://sbtc.stacks.co";
export const TIER_LIST = ["low", "mid", "high"].map((k) => ({ key: k, ustx: TIERS[k] }));

export const STEPS = [
  { n: 1, short: "Connect", name: "Connect a wallet" },
  { n: 2, short: "Amount", name: "Swap amount" },
  { n: 3, short: "Sign", name: "Sign and swap" },
  { n: 4, short: "Done", name: "Done" },
];
export const FRESH_STATUS = { 1: "active", 2: "locked", 3: "locked", 4: "locked" };

// ---------- UI atoms (shared recipes from the design skill) ----------

export function Btn({ kind = "secondary", lg, children, ...rest }) {
  return <button className={`btn btn-${kind}${lg ? " btn-lg" : ""}`} {...rest}>{children}</button>;
}
export function Field({ label, children }) { return <div className="field"><label>{label}</label>{children}</div>; }
export function Badge({ k, children }) { return <span className={`badge b-${k}`}>{children}</span>; }
export function KV({ label, children, mono = true }) { return <div className="kv"><span>{label}</span><span className={mono ? "v" : ""}>{children}</span></div>; }
export function StatusLine({ kind, children }) { return children ? <div className={`status ${kind}`}>{children}</div> : null; }
export function CheckRow({ k, children }) {
  const icon = k === "ok" ? "ph-check-circle" : k === "bad" ? "ph-x-circle" : "ph-warning-circle";
  const color = k === "ok" ? "var(--green-600)" : k === "bad" ? "var(--red-500)" : "var(--yellow-700)";
  return <div className="check-row"><i className={`ph ${icon}`} style={{ color }}></i><span>{children}</span></div>;
}
// The mechanism behind a step, closed by default: for readers who want it, out of the way of the rest.
export function How({ children }) {
  return <details className="how"><summary>How this works</summary><div className="how-body">{children}</div></details>;
}
export function ExtLink({ href, children }) { return <a href={href} target="_blank" rel="noopener">{children} <i className="ph ph-arrow-square-out" style={{ fontSize: "0.85em" }}></i></a>; }
export function GatedBtn({ account, onConnect, disabled, onClick, children }) {
  if (!account) return <Btn kind="primary" lg onClick={onConnect}>Connect Wallet</Btn>;
  return <Btn kind="primary" lg disabled={disabled} onClick={onClick}>{children}</Btn>;
}
export function PanelFoot({ onBack, children }) {
  return <div className="foot">{onBack ? <Btn kind="tertiary" onClick={onBack}><i className="ph ph-arrow-left"></i>Back</Btn> : null}<span className="spacer"></span>{children}</div>;
}
export function useInterval(fn, ms, active) {
  const ref = useRef(fn); ref.current = fn;
  useEffect(() => { if (!active || ms == null) return; const id = setInterval(() => ref.current(), ms); return () => clearInterval(id); }, [ms, active]);
}
export function useElapsed(active) {
  const [t, setT] = useState(0);
  useEffect(() => { if (!active) { setT(0); return; } const start = Date.now(); const id = setInterval(() => setT(Math.floor((Date.now() - start) / 1000)), 1000); return () => clearInterval(id); }, [active]);
  return t;
}
export function fmtElapsed(s) { const m = Math.floor(s / 60); return m > 0 ? `${m}m ${s % 60}s` : `${s}s`; }
export function walletErrMsg(e) { const c = e && typeof e === "object" && "code" in e ? Number(e.code) : null; return (c === 4001 || c === -31001) ? "You rejected the transaction in the wallet." : null; }

// ---------- step rail ----------
export function Rail({ stepStatus, viewStep, onView, readOnlySteps }) {
  return <div className="rail" role="tablist" aria-label="Steps">
    {STEPS.map((s) => {
      const st = stepStatus[s.n];
      if (s.n === viewStep) {
        return <div key={s.n} className="rail-tab" role="tab" aria-selected="true">
          <span className="num">{s.n}</span><span className="name">{s.name}</span>
          {readOnlySteps && readOnlySteps.includes(s.n) ? <span className="ro">read-only</span> : null}
        </div>;
      }
      const clickable = st === "complete" || st === "active";
      return <button key={s.n} role="tab" aria-selected="false" disabled={!clickable}
        className={`rail-item ${st}${clickable ? " clickable" : ""}`}
        onClick={() => clickable && onView(s.n)}>
        <span className="rail-num">{st === "complete" ? <i className="ph ph-check" style={{ fontSize: 14 }}></i> : null}{s.n}</span>
        <span className="rail-lbl">{s.short}</span>
      </button>;
    })}
  </div>;
}
