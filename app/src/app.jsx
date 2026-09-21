// App shell: header with the contract principal and the no-seed-phrase statement, wallet
// connect, the URL contract, in-memory flow state (zero persistence), and the step rail.
// Mainnet only: there is no network switch, so the mainnet accent stays.
import React, { useState, useEffect, useMemo, useRef } from "react";
import { STEPS, FRESH_STATUS, CONTRACT_ID, REPO, Btn, StatusLine, Rail } from "./core.jsx";
import { Step1, Step2, Step3, Step4, StepInfo } from "./steps.jsx";
import { makeClients, API_DEFAULT } from "./clients.js";
import { readSnapshot, verify, discoverRelays } from "./chain.js";
import { FIXTURES } from "./fixtures.js";
import { shortPrincipal, normTxid } from "./amounts.js";

// Read-node override from ?api= (reads and explorer-independent; never what the wallet signs).
function apiFromUrl() {
  const raw = new URLSearchParams(location.search).get("api");
  if (!raw) return null;
  const v = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s]+$/.test(v)) return null;
  return v === API_DEFAULT ? null : v;
}
// The URL is the whole state: chain, then the txid once a relay broadcast one, then the read
// API at its current value (default or overridden, always visible), then the fixture flag.
function writeUrl(txid, api, fixture) {
  const p = new URLSearchParams();
  p.set("chain", "mainnet");
  if (txid) p.set("txid", txid);
  p.set("api", api || API_DEFAULT);
  if (fixture) p.set("fixture", fixture);
  history.replaceState(null, "", location.pathname + "?" + p.toString());
}

// Site footer on every step: repo and disclaimer links left, Reset right. Zero persistence
// means Reset only clears the URL state and reloads to step 1.
function SiteFoot() {
  const [pop, setPop] = useState(false);
  useEffect(() => { if (!pop) return; const close = () => setPop(false); document.addEventListener("click", close); return () => document.removeEventListener("click", close); }, [pop]);
  function reset() { history.replaceState(null, "", location.pathname); location.reload(); }
  return <div className="site-foot">
    <a href={REPO} target="_blank" rel="noopener">Github Repository</a>
    <a href="./disclaimer.html" className="disclaimer-link">Disclaimer</a>
    <a href="https://stx.fan/signer" target="_blank" rel="noopener">Check out other sidekicks</a>
    <span className="spacer"></span>
    <span className="reset-wrap" onClick={(e) => e.stopPropagation()}>
      {pop ? <span className="reset-pop">
        <span>Confirm that you want to reset this swap and start over. Nothing is stored; the URL is cleared.</span>
        <span className="row"><button className="btn btn-secondary" onClick={() => setPop(false)}>Cancel</button><button className="btn btn-primary" onClick={reset}>Reset</button></span>
      </span> : null}
      <button className="reset-btn" onClick={() => setPop((o) => !o)}>Reset</button>
    </span>
  </div>;
}

const FRESH_SWAP = { amountText: "", unit: "sats", tier: "low", tierTouched: false, slippageText: "", slippageTouched: false };

export function App() {
  const url = useMemo(() => new URLSearchParams(location.search), []);
  const fixture = useMemo(() => { const f = url.get("fixture"); return f && FIXTURES[f] ? f : null; }, [url]);
  const api = useMemo(() => apiFromUrl(), []);
  const clients = useMemo(() => makeClients(api, fixture), [api, fixture]);
  const urlTxid = useMemo(() => { const t = normTxid(url.get("txid")); return /^[0-9a-f]{64}$/.test(t) ? t : null; }, [url]);

  const [account, setAccount] = useState(null);
  const [walletName, setWalletName] = useState(null);
  const [bnsName, setBnsName] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [connErr, setConnErr] = useState(null);
  const [catalog, setCatalog] = useState(() => window.SGLib.walletCatalog());
  const [walletPick, setWalletPick] = useState(null);

  const [stepStatus, setStepStatus] = useState(() => urlTxid ? { 1: "complete", 2: "complete", 3: "complete", 4: "active" } : FRESH_STATUS);
  const [viewStep, setViewStep] = useState(urlTxid ? 4 : 1);
  const [swap, setSwap] = useState(() => ({ ...FRESH_SWAP, ...(fixture ? { amountText: FIXTURES[fixture].inputs.amount, unit: FIXTURES[fixture].inputs.unit } : {}) }));
  const [committed, setCommitted] = useState(null);
  const [result, setResult] = useState(urlTxid ? { txid: urlTxid, relay: null, sponsor: null, fee: null, tier: null } : null);

  const [verification, setVerification] = useState(null);
  const [relays, setRelays] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [snapshotError, setSnapshotError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const accountRef = useRef(account); accountRef.current = account;

  useEffect(() => { writeUrl(result ? result.txid : null, api, fixture); }, [result && result.txid]);
  useEffect(() => { const close = () => setMenuOpen(false); document.addEventListener("click", close); return () => document.removeEventListener("click", close); }, []);
  // Installed wallets can appear after load (extension injection is asynchronous); re-detect
  // cheaply while the connect step is showing.
  useEffect(() => { if (viewStep !== 1 || account) return; const id = setInterval(() => setCatalog(window.SGLib.walletCatalog()), 1000); return () => clearInterval(id); }, [viewStep, account]);

  // Contract verification and relay discovery happen once per page load (and again on Refresh).
  // Concurrent refreshes (page load, then a wallet connecting a moment later) resolve in any
  // order; only the newest one may write, or a balance-less snapshot overwrites a fresh one.
  const refreshSeq = useRef(0);
  async function refreshAll() {
    const seq = ++refreshSeq.current;
    setRefreshing(true);
    const [v, r, s] = await Promise.all([
      verify(clients),
      discoverRelays(clients),
      readSnapshot(clients, accountRef.current).then((x) => ({ ok: true, x }), (e) => ({ ok: false, e: (e && e.message) || String(e) })),
    ]);
    if (seq !== refreshSeq.current) return;
    setVerification(v); setRelays(r);
    if (s.ok) { setSnapshot(s.x); setSnapshotError(null); } else { setSnapshot(null); setSnapshotError(s.e); }
    setRefreshing(false);
  }
  useEffect(() => { refreshAll(); }, [clients]);
  // A fresh balance belongs to the connected account: re-read when it changes.
  useEffect(() => { if (account && !urlTxid) refreshAll(); }, [account]);

  async function resolveName(addr) {
    setBnsName(null);
    if (!addr || fixture) return;
    const nm = await window.SGLib.resolveBnsName(addr, clients.chain.baseUrl).catch(() => null);
    if (nm) setBnsName(nm);
  }
  function doConnect() {
    setConnErr(null);
    const detected = window.SGLib.detectWallets().filter((w) => w.supported);
    if (detected.length === 1 && detected[0].tier === "verified") { connectWith(detected[0]); return; }
    setWalletPick(window.SGLib.walletCatalog());
  }
  async function connectWith(w) {
    setWalletPick(null); setConnErr(null);
    try {
      window.SGLib.setSelectedProviderId(w.id);
      const res = await window.SGLib.connect({ network: "mainnet", forceWalletSelect: false });
      const e = (res?.addresses || []).find((a) => /^S/.test(a.address || ""));
      if (!e) { setConnErr("The wallet returned no STX address."); return; }
      const addr = e.address.toUpperCase();
      if (!/^S[PM]/.test(addr)) { setConnErr(`Connected ${addr} is not a mainnet address. Switch the wallet to mainnet and reconnect.`); return; }
      setAccount(addr); setWalletName(w.name || null); resolveName(addr);
      if (!result) {
        setStepStatus((s) => ({ ...s, 1: "complete", 2: s[2] === "locked" ? "active" : s[2] }));
        setViewStep(2);
      }
    } catch (e) { setConnErr("Connection failed or was cancelled."); }
  }
  async function doDisconnect() { setMenuOpen(false); try { await window.SGLib.disconnect(); } catch (e) {} setAccount(null); setWalletName(null); setBnsName(null); }

  function onContinueAmount(c) {
    setCommitted(c);
    setStepStatus((s) => ({ ...s, 2: "complete", 3: "active" }));
    setViewStep(3);
  }
  function onSponsored(r) {
    setResult({ ...r, tier: committed.tier });
    setStepStatus({ 1: "complete", 2: "complete", 3: "complete", 4: "active" });
    setViewStep(4);
  }
  // Retry returns to the amount step with the slippage preset (2 or 5 percent); Swap Again
  // returns with the defaults. The old txid leaves the URL.
  function onRetry(slippageBips) {
    setResult(null); setCommitted(null);
    setSwap((s) => ({ ...s, slippageTouched: slippageBips != null, slippageText: slippageBips === 200n ? "2" : slippageBips === 500n ? "5" : s.slippageText }));
    setStepStatus({ 1: account ? "complete" : "active", 2: account ? "active" : "locked", 3: "locked", 4: "locked" });
    setViewStep(account ? 2 : 1);
    refreshAll();
  }

  const back = viewStep > 1 ? () => setViewStep(viewStep - 1) : null;
  const readOnlySteps = result ? [2, 3] : [];
  const stepEl = {
    1: <Step1 account={account} walletName={walletName} catalog={catalog} onConnectWith={connectWith} onDisconnect={doDisconnect} connErr={connErr}
      onContinue={() => { setStepStatus((s) => ({ ...s, 2: s[2] === "locked" ? "active" : s[2] })); setViewStep(2); }} reloadedFromUrl={!!urlTxid && !account} />,
    2: <Step2 account={account} onConnect={doConnect} verification={verification} relays={relays} snapshot={snapshot} snapshotError={snapshotError}
      refreshing={refreshing} onRefresh={refreshAll} swap={swap} setSwap={setSwap} onContinue={onContinueAmount} onBack={back}
      readOnly={readOnlySteps.includes(2)} committed={committed} />,
    3: committed ? <Step3 clients={clients} account={account} onConnect={doConnect} committed={committed} relays={relays} onSponsored={onSponsored} onBack={back}
      readOnly={readOnlySteps.includes(3)} result={result} />
      : <div className="body-wrap"><div className="body"><p className="step-sub">{result ? "This page was opened from a transaction id; the signing details are not kept after a reload." : "Enter a swap amount first."}</p></div><div className="foot"><Btn kind="tertiary" onClick={back}><i className="ph ph-arrow-left"></i>Back</Btn><span className="spacer"></span></div></div>,
    4: <Step4 clients={clients} txid={result ? result.txid : null} result={result} onRetry={onRetry} onBack={back} />,
  }[viewStep];

  return <div>
    <header className="hdr"><div className="wrap">
      <div className="titles"><h1>sBTC to Stacks gas</h1><span className="netpill">Mainnet</span></div>
      <div className="right">
        <span className="no-secrets" title={CONTRACT_ID}><i className="ph ph-shield-check"></i>Never asks for a seed phrase<span className="sep"></span>contract <span className="mono hdr-contract">{shortPrincipal(CONTRACT_ID)}</span></span>
        <div className="wallet-menu" onClick={(e) => e.stopPropagation()}>
          {account
            ? <Btn kind="secondary" onClick={() => setMenuOpen((o) => !o)}>{bnsName || shortPrincipal(account)} <i className="ph ph-caret-down"></i></Btn>
            : <Btn kind="primary" onClick={doConnect}>Connect Wallet</Btn>}
          {menuOpen ? <div className="menu"><button onClick={doDisconnect}>Disconnect</button></div> : null}
        </div>
      </div>
    </div></header>
    <main className="wrap">
      {clients.fixture ? <StatusLine kind="info">Fixture mode <span className="mono">{clients.fixtureName}</span>: every read and relay call is answered from recorded data; nothing reaches the network.</StatusLine> : null}
      <Rail stepStatus={stepStatus} viewStep={viewStep} onView={setViewStep} readOnlySteps={readOnlySteps} />
      <section className="panel" style={viewStep === 1 ? { borderTopLeftRadius: 0 } : null} key={viewStep}>{stepEl}</section>
      <StepInfo step={viewStep} />
      <SiteFoot />
    </main>
    {walletPick ? <div className="overlay"><div className="modal">
      <h3>Connect a wallet</h3>
      <div className="pick">
        {walletPick.map((w) => {
          const badge = w.tier === "verified" ? <span className="badge b-ok">verified</span> : w.tier === "untested" ? <span className="badge b-warn">offered untested</span> : <span className="badge b-bad">not supported</span>;
          if (w.installed && w.supported) return <button key={w.key} onClick={() => connectWith(w)}>
            <span className="id" style={{ fontFamily: "var(--font-body)" }}>{w.name} {badge}</span><span className="meta">Connect</span></button>;
          if (!w.installed && w.install) return <div key={w.key} className="pick-link">
            <span className="id" style={{ fontFamily: "var(--font-body)" }}>{w.name} {badge}</span>
            <span className="meta"><a href={w.install} target="_blank" rel="noopener">Install <i className="ph ph-arrow-up-right"></i></a></span></div>;
          return <div key={w.key} className="pick-blocked"><span className="id" style={{ fontFamily: "var(--font-body)" }}>{w.name} {badge}</span><span className="meta">drops post-conditions</span></div>;
        })}
      </div>
      <p style={{ marginTop: 16, marginBottom: 0 }}>The relay refuses any transaction lacking the exact post-conditions, so a wallet that drops them cannot get sponsored.</p>
      <div className="row"><Btn kind="secondary" onClick={() => setWalletPick(null)}>Cancel</Btn></div>
    </div></div> : null}
  </div>;
}
