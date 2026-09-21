// The four step panels plus per-step info copy. One exported component per step; the shell,
// routing and URL contract live in app.jsx; constants and atoms in core.jsx.
import React, { useState, useEffect } from "react";
import { buildSwapCall, defaultTier, defaultSlippageBips, minOutFor, explainRelayError, explainTxFailure, TIERS } from "@no314/sbtc-gas-swap";
import {
  CONTRACT_ID, DOCS, SBTC_BRIDGE, TIER_LIST, Btn, Field, Badge, KV, StatusLine, CheckRow, ExtLink, GatedBtn, PanelFoot,
  useInterval, useElapsed, fmtElapsed, walletErrMsg,
} from "./core.jsx";
import {
  parseAmount, fmtSats, fmtBtc, fmtBoth, fmtStx, fmtStxBoth, fmtUstx, fmtBips, bipsToPct, parseSlippagePct, fmtStamp,
  txOutcome, shortTxid, shortPrincipal, explorerTx, explorerAddr, normTxid,
} from "./amounts.js";
import { quoteFromSnapshot, freshQuoteFor, rankRelays, poolName, poolPrincipal } from "./chain.js";

const group = (n) => Number(n).toLocaleString("en-US");

// ---------- Step 1: Connect a wallet ----------
export function Step1({ account, walletName, catalog, onConnectWith, onDisconnect, connErr, onContinue, reloadedFromUrl }) {
  if (account) {
    return <div className="body-wrap"><div className="body">
      <p className="step-sub">A wallet is connected. Continue to enter the swap amount, or disconnect to use another account.</p>
      <div className="kvs">
        <KV label="Connected account">{account}</KV>
        <KV label="Wallet" mono={false}>{walletName || "-"}</KV>
      </div>
      <StatusLine kind="err">{connErr}</StatusLine>
    </div>
    <PanelFoot>
      <Btn kind="secondary" lg onClick={onDisconnect}>Disconnect</Btn>
      <Btn kind="primary" lg onClick={onContinue}>Continue<i className="ph ph-arrow-right"></i></Btn>
    </PanelFoot></div>;
  }
  return <div className="body-wrap"><div className="body">
    <p className="step-sub">Connect the wallet that holds your sBTC; no STX is needed. Leather is verified to keep the post-conditions this swap depends on and to return a sponsored transaction unbroadcast; the other wallets are offered untested. The relay refuses any transaction lacking the exact post-conditions, so a wallet that drops them cannot get sponsored.</p>
    {reloadedFromUrl ? <StatusLine kind="info">This page was opened with a transaction id in the URL. Reconnect a wallet only to start another swap.</StatusLine> : null}
    <div className="pick wallet-pick">
      {catalog.map((w) => {
        const tierBadge = w.tier === "verified" ? <Badge k="ok">verified</Badge> : w.tier === "untested" ? <Badge k="warn">offered untested</Badge> : <Badge k="bad">not supported</Badge>;
        if (w.installed && w.supported) return <button key={w.key} onClick={() => onConnectWith(w)}>
          <span className="id" style={{ fontFamily: "var(--font-body)" }}>{w.name} {tierBadge}</span>
          <span className="meta">Connect</span>
        </button>;
        if (!w.installed && w.install) return <div key={w.key} className="pick-link">
          <span className="id" style={{ fontFamily: "var(--font-body)" }}>{w.name} {tierBadge}</span>
          <span className="meta"><a href={w.install} target="_blank" rel="noopener">Install <i className="ph ph-arrow-up-right"></i></a></span>
        </div>;
        return <div key={w.key} className="pick-blocked">
          <span className="id" style={{ fontFamily: "var(--font-body)" }}>{w.name} {tierBadge}</span>
          <span className="meta">drops post-conditions</span>
        </div>;
      })}
    </div>
    <p className="step-sub" style={{ marginTop: 16, marginBottom: 0 }}>Untested wallets: approve the first real transaction only after the wallet's own signing screen lists the three post-conditions and a fee of 0.</p>
    <StatusLine kind="err">{connErr}</StatusLine>
  </div>
  <PanelFoot></PanelFoot></div>;
}

// ---------- Step 2: Swap amount ----------
export function Step2({ account, onConnect, verification, relays, snapshot, snapshotError, refreshing, onRefresh, swap, setSwap, onContinue, onBack, readOnly, committed }) {
  if (readOnly && committed) {
    return <div className="body-wrap"><div className="body">
      <div className="kvs">
        <KV label="Swap amount">{fmtBoth(committed.amountSats)}</KV>
        <KV label="Pool used">{poolName(committed.call ? Number(committed.call.functionArgs[3].value) : committed.poolId)}</KV>
        <KV label="Quote">{fmtStxBoth(committed.quoteOut)}</KV>
        <KV label="Network fee (tier)">{committed.tier}: {fmtStxBoth(TIERS[committed.tier])}</KV>
        <KV label="Slippage">{fmtBips(committed.slippageBips)}</KV>
        <KV label="Min-out">{fmtStxBoth(committed.minOut)}</KV>
      </div>
    </div><PanelFoot onBack={onBack}></PanelFoot></div>;
  }

  const amt = parseAmount(swap.amountText, swap.unit);
  const sats = amt.sats || null;
  const relayMin = relays ? relays.minTier : null;
  const autoTier = sats && relayMin ? defaultTier(sats, { minTier: relayMin }) : (relayMin || "low");
  const tier = swap.tierTouched ? swap.tier : autoTier;
  const autoSlip = defaultSlippageBips(sats || 1n);
  const slippageText = swap.slippageTouched ? swap.slippageText : bipsToPct(autoSlip);
  const slippageBips = swap.slippageTouched ? parseSlippagePct(swap.slippageText) : autoSlip;
  const quote = snapshot && sats ? quoteFromSnapshot(snapshot, sats) : null;
  const best = quote && quote.best;
  const ranked = relays ? rankRelays(relays, tier) : [];
  const verified = !!(verification && verification.ok);

  let call = null, buildErr = null;
  if (account && best && slippageBips != null) {
    try { call = buildSwapCall({ user: account, amountSats: sats, tier, poolId: best.poolId, quoteOut: best.out, slippageBips }); }
    catch (e) { buildErr = e; }
  }
  const minOut = best && slippageBips != null ? minOutFor(best.out, slippageBips) : null;
  const balance = snapshot ? snapshot.balance : null;
  const insufficient = balance != null && sats != null && sats > balance;

  const blockers = [];
  if (!verified) blockers.push("contract not verified");
  if (!snapshot) blockers.push("pools not read yet");
  if (sats == null) blockers.push("swap amount missing");
  if (snapshot && balance == null) blockers.push("sBTC balance unavailable");
  if (insufficient) blockers.push("amount above balance");
  if (quote && !best) blockers.push("no pool quotes this amount");
  if (slippageBips == null) blockers.push("slippage out of range");
  if (buildErr) blockers.push(buildErr.code);
  if (!ranked.length) blockers.push("no relay for this tier");
  const canContinue = account && blockers.length === 0 && call;

  const tierRank = (t) => TIER_LIST.findIndex((x) => x.key === t);

  return <div className="body-wrap"><div className="body">
    <p className="step-sub">Enter the sBTC swap amount; the quote is computed from pool reserves read at the stamped moment and changes only on Refresh. The network fee is the STX you repay the sponsor inside the swap, and the min-out must stay at or above it. Nothing is stored: reloading this page starts over.</p>

    <div className="readerline">
      {verification == null ? <><span className="spin"></span> reading contract source</>
        : verification.ok ? <><Badge k="ok">contract verified</Badge> structure hash <span className="mono">{verification.liveHash.slice(0, 12)}</span> at publish height <span className="mono">{group(verification.publishHeight)}</span></>
        : verification.error ? <><Badge k="idle">contract unavailable</Badge> the source could not be read: <span className="mono">{verification.error}</span>. Refresh to retry.</>
        : <><Badge k="bad">contract mismatch</Badge> live structure hash <span className="mono">{verification.liveHash.slice(0, 12)}</span> differs from the pinned <span className="mono">{verification.pinnedHash.slice(0, 12)}</span>; the swap is blocked.</>}
    </div>

    <div className="two amount-row">
      <Field label="Swap amount (sBTC)">
        <div className="unit-row">
          <input className="in mono" spellCheck="false" inputMode="decimal" placeholder={swap.unit === "sats" ? "5000" : "0.00005"} value={swap.amountText}
            onChange={(e) => setSwap((s) => ({ ...s, amountText: e.target.value }))} />
          <select className="in unit" aria-label="Unit" value={swap.unit} onChange={(e) => setSwap((s) => ({ ...s, unit: e.target.value }))}>
            <option value="sats">sats</option><option value="btc">BTC</option>
          </select>
        </div>
        <div className="hint">{sats ? <span className="mono">{swap.unit === "sats" ? fmtBtc(sats) : fmtSats(sats)}</span> : "sats and BTC are both shown once an amount is entered"}</div>
      </Field>
      <Field label="sBTC balance">
        <input className="in mono" readOnly value={!account ? "connect a wallet" : !snapshot ? (snapshotError ? "unavailable" : "reading") : balance == null ? "unavailable" : fmtBoth(balance)} />
        <div className="hint">{snapshot && account && balance == null ? <span>balance read failed: <span className="mono">{snapshot.balanceError}</span></span> : "read with the pools; Refresh re-reads it"}</div>
      </Field>
    </div>

    <div className="two tier-row">
      <Field label="Network fee (STX, repaid to the sponsor inside the swap)">
        <div className="tiers" role="radiogroup">
          {TIER_LIST.map((t) => {
            const below = relayMin ? tierRank(t.key) < tierRank(relayMin) : false;
            return <label key={t.key} className={`tier${t.key === tier ? " sel" : ""}${below ? " off" : ""}`}>
              <input type="radio" name="tier" value={t.key} checked={t.key === tier} disabled={below}
                onChange={() => setSwap((s) => ({ ...s, tier: t.key, tierTouched: true }))} style={{ accentColor: "var(--accent)" }} />
              <span className="tname">{t.key}</span>
              <span className="tval">{fmtStx(t.ustx)}</span>
              {relayMin === t.key ? <span className="tmin">relay minimum</span> : below ? <span className="tmin">below relay minimum</span> : null}
            </label>;
          })}
        </div>
        <div className="hint">{relays == null ? "reading relays" : relayMin ? <span>default {autoTier} for this amount; the relay minimum is {relayMin}</span> : "no relay reachable: the relay minimum is unknown"}</div>
      </Field>
      <Field label="Slippage (percent, 0.1 to 99)">
        <input className="in mono slip-in" spellCheck="false" inputMode="decimal" value={slippageText}
          onChange={(e) => setSwap((s) => ({ ...s, slippageText: e.target.value, slippageTouched: true }))} />
        <div className="hint">default {bipsToPct(autoSlip)}% for this amount (10% up to 30,000 sats, 1% above); {swap.slippageTouched ? <a href="#" onClick={(e) => { e.preventDefault(); setSwap((s) => ({ ...s, slippageTouched: false })); }}>use the default</a> : "edit to change"}</div>
      </Field>
    </div>

    <div className="kvs">
      <KV label="Swap amount">{sats ? fmtBoth(sats) : "-"}</KV>
      <KV label="Pool used">{best ? `${poolName(best.poolId)} (pool id ${best.poolId})` : "-"}</KV>
      <KV label="Quote (STX out for the net input)">{best ? fmtStxBoth(best.out) : "-"}</KV>
      <KV label="Default provider fee (0.5% of the swap amount)">{quote ? fmtSats(quote.fees.serviceFee) : "-"}</KV>
      <KV label="Integrator fee">{quote ? `${fmtSats(quote.fees.integratorFee)}: this app passes no integrator` : "-"}</KV>
      <KV label="Net input to the pool">{quote ? fmtSats(quote.fees.net) : "-"}</KV>
      <KV label="Network fee (tier)">{`${tier}: ${fmtStxBoth(TIERS[tier])}`}</KV>
      <KV label={`Min-out (quote minus ${slippageBips != null ? fmtBips(slippageBips) : "slippage"})`}>{minOut != null ? fmtStxBoth(minOut) : "-"}</KV>
      <KV label="Price impact">{best ? fmtBips(best.impactBips) : "-"}</KV>
      <KV label="Pools read">{quote ? <span>
        {quote.quotes.map((p) => <span key={p.poolId} className="poolq">{poolName(p.poolId)} {p.out > 0n ? fmtStx(p.out) : (p.reason || "no quote")}</span>)}
        {quote.unavailable.map((u) => <span key={u.poolId} className="poolq unavail">{poolName(u.poolId)} unavailable</span>)}
      </span> : snapshot ? <span>{snapshot.unavailable.map((u) => <span key={u.poolId} className="poolq unavail">{poolName(u.poolId)} unavailable</span>)}{Object.keys(snapshot.states).length ? <span className="poolq">{Object.keys(snapshot.states).map((id) => poolName(Number(id))).join(", ")} read</span> : null}</span> : "-"}</KV>
    </div>

    <div className="readerline stamp">
      {snapshot ? <span>read <span className="mono">{fmtStamp(snapshot.readAt)}</span>, Stacks tip <span className="mono">{snapshot.tip != null ? group(snapshot.tip) : "unavailable"}</span>{relays ? <>; relays read <span className="mono">{fmtStamp(relays.readAt)}</span>, {relays.infos.length} reachable</> : null}</span>
        : snapshotError ? <span>pool read failed: <span className="mono">{snapshotError}</span></span>
        : <><span className="spin"></span> reading pools</>}
      <span className="spacer"></span>
      <button className="linkbtn" disabled={refreshing} onClick={onRefresh}><i className="ph ph-arrows-clockwise"></i>{refreshing ? "Refreshing" : "Refresh"}</button>
    </div>

    {snapshot && snapshot.unavailable.length ? <StatusLine kind="info">{snapshot.unavailable.map((u) => <div key={u.poolId}>{poolName(u.poolId)} is unavailable, not zero: its read failed (<span className="mono">{u.error}</span>). The quote uses the pools that answered.</div>)}</StatusLine> : null}
    {amt.error ? <StatusLine kind="err">{amt.error}</StatusLine> : null}
    {insufficient ? <StatusLine kind="err">The swap amount {fmtSats(sats)} is above the sBTC balance {fmtSats(balance)}.</StatusLine> : null}
    {slippageBips == null ? <StatusLine kind="err">Slippage must be a percentage from 0.1 to 99 with at most two decimals.</StatusLine> : null}
    {quote && !best ? <StatusLine kind="err">No pool can quote this amount ({quote.error}). Raise the amount or Refresh.</StatusLine> : null}
    {buildErr ? <StatusLine kind="err">{buildErr.code === "MIN_OUT_BELOW_TIER" ? "Min-out below tier: " : ""}{buildErr.message}.</StatusLine> : null}
    {relays && !ranked.length ? <StatusLine kind="err">{relays.infos.length ? `No reachable relay accepts the ${tier} tier; the lowest relay minimum is ${relays.minTier}.` : "No relay is reachable, so nothing can sponsor the swap right now. Refresh to retry; the relay list comes from the sponsors.json published next to this page."}</StatusLine> : null}
  </div>
  <PanelFoot onBack={onBack}>
    {account && blockers.length ? <span className="foot-note">blocked: {blockers.join(", ")}</span> : null}
    <GatedBtn account={account} onConnect={onConnect} disabled={!canContinue} onClick={() => onContinue({ amountSats: sats, tier, slippageBips, poolId: best.poolId, quoteOut: best.out, minOut: call.minOut, fees: call.fees, call, quotedAt: snapshot.readAt, tip: snapshot.tip, ranked })}>
      Continue<i className="ph ph-arrow-right"></i></GatedBtn>
  </PanelFoot></div>;
}

// ---------- Step 3: Sign and sponsor ----------
export function Step3({ clients, account, onConnect, committed, relays, onSponsored, onBack, readOnly, result }) {
  const [phase, setPhase] = useState("idle"); // idle | requoting | signing | sponsoring
  const [err, setErr] = useState(null);
  const [fresh, setFresh] = useState(null);
  const c = committed;
  const ranked = relays ? rankRelays(relays, c.tier) : [];
  const pool = poolPrincipal(c.poolId);

  if (readOnly && result) {
    return <div className="body-wrap"><div className="body">
      <div className="kvs">
        <KV label="Transaction"><a href={explorerTx(result.txid)} target="_blank" rel="noopener">{shortTxid(result.txid)}</a></KV>
        <KV label="Relay used">{result.relay}</KV>
        <KV label="Sponsor">{result.sponsor}</KV>
        <KV label="Network fee actually paid on chain">{fmtStxBoth(BigInt(result.fee || 0))}</KV>
      </div>
    </div><PanelFoot onBack={onBack}></PanelFoot></div>;
  }

  async function signAndSponsor() {
    setErr(null); setFresh(null);
    setPhase("requoting");
    const f = await freshQuoteFor(clients, c.amountSats, c.poolId);
    setFresh(f);
    if (!f.quote || f.quote.out === 0n) { setErr(<span>The fresh read of {poolName(c.poolId)} did not answer, so the swap is blocked. Go back and re-quote.</span>); setPhase("idle"); return; }
    if (f.quote.out < c.minOut) {
      setErr(<span>Fresh quote {fmtStxBoth(f.quote.out)} is below the min-out {fmtStxBoth(c.minOut)} (the quote at step 2 was {fmtStxBoth(c.quoteOut)}). The swap is blocked; go back to re-quote, or raise the slippage.</span>);
      setPhase("idle"); return;
    }
    const L = window.SGLib;
    setPhase("signing");
    let hex;
    try {
      const res = await L.request("stx_callContract", {
        contract: c.call.contract, functionName: c.call.functionName,
        functionArgs: c.call.functionArgs.map((a) => L.cvToHex(a)),
        postConditions: c.call.postConditions, postConditionMode: "deny",
        sponsored: true, fee: 0, network: "mainnet", address: account,
      });
      // A sponsored call returns the signed, unbroadcast transaction; there is no txid yet, so
      // the usual 64-hex txid check does not apply here (PROMPT.md section 12).
      hex = String((res && (res.transaction || res.txRaw || res.tx)) || "").replace(/^0x/i, "");
      if (!/^[0-9a-f]{100,}$/i.test(hex)) { setErr("The wallet returned no signed transaction. A wallet that broadcasts instead of returning the signed bytes cannot be sponsored."); setPhase("idle"); return; }
    } catch (e) { setErr(walletErrMsg(e) || ("The wallet request failed: " + ((e && e.message) || e))); setPhase("idle"); return; }
    setPhase("sponsoring");
    const sub = await clients.relay.submit(hex, ranked).catch((e) => ({ ok: false, attempts: [{ relay: "-", code: "RELAY_UNREACHABLE", message: String((e && e.message) || e) }] }));
    if (!sub.ok) {
      setErr(<div>{sub.attempts.map((a, i) => { const x = explainRelayError(a.code); return <div key={i}><span className="mono">{a.relay}</span> ({a.code}): {x.title} {x.action}</div>; })}{sub.attempts.length === 0 ? "No relay was tried." : null}</div>);
      setPhase("idle"); return;
    }
    setPhase("idle");
    onSponsored({ txid: normTxid(sub.txid), relay: sub.relay, sponsor: sub.sponsor, fee: sub.fee });
  }

  const label = phase === "requoting" ? "Re-quoting" : phase === "signing" ? "Waiting For The Wallet" : phase === "sponsoring" ? "Sponsoring" : "Sign And Sponsor";
  return <div className="body-wrap"><div className="body">
    <p className="step-sub">Signing hands the wallet a sponsored transaction with fee 0 and exactly these three post-conditions; the wallet returns the signed bytes without broadcasting. A fresh quote is read immediately before signing and blocks the swap if it dropped below min-out. The first relay that accepts co-signs, pays the network fee, and broadcasts.</p>
    <div className="prereq pcs">
      <div className="item"><i className="ph ph-shield-check"></i><span>You send exactly <span className="mono">{fmtBoth(c.amountSats)}</span> of sBTC: <span className="mono">{fmtSats(c.fees.serviceFee)}</span> default provider fee, <span className="mono">{fmtSats(c.fees.integratorFee)}</span> integrator fee, <span className="mono">{fmtSats(c.fees.net)}</span> net input to the pool.</span></div>
      <div className="item"><i className="ph ph-shield-check"></i><span>You send exactly <span className="mono">{fmtStxBoth(TIERS[c.tier])}</span>: the {c.tier} network fee to the sponsor, who pays the fee the chain charges.</span></div>
      <div className="item"><i className="ph ph-shield-check"></i><span>{poolName(c.poolId)} (<span className="mono">{pool}</span>) sends you at least <span className="mono">{fmtStxBoth(c.minOut)}</span>, the min-out.</span></div>
      <div className="item"><i className="ph ph-prohibit"></i><span>Nothing else moves: deny mode, and the relay refuses any other set of post-conditions.</span></div>
    </div>
    <div className="kvs">
      <KV label="Contract">{CONTRACT_ID}</KV>
      <KV label="Quote at step 2">{fmtStxBoth(c.quoteOut)} (read <span>{fmtStamp(c.quotedAt)}</span>, tip {c.tip != null ? group(c.tip) : "-"})</KV>
      <KV label={`Relays accepting the ${c.tier} tier`}>{ranked.length ? ranked.map((r) => <div key={r.url}>{r.url} (minimum {r.minTier}, fee estimate {fmtStx(BigInt(r.feeEstimate[c.tier] || 0))})</div>) : "none"}</KV>
      {fresh && fresh.quote ? <KV label="Fresh quote before signing">{fmtStxBoth(fresh.quote.out)} (read {fmtStamp(fresh.readAt)})</KV> : null}
    </div>
    {phase !== "idle" ? <StatusLine kind="info"><span className="spin" style={{ marginRight: 8, verticalAlign: -1 }}></span>{phase === "requoting" ? "Reading a fresh quote from the pools." : phase === "signing" ? "Approve the sponsored transaction in the wallet; it returns signed bytes and broadcasts nothing." : "Submitting the signed transaction to the relay."}</StatusLine> : null}
    <StatusLine kind="err">{err}</StatusLine>
  </div>
  <PanelFoot onBack={onBack}>
    <GatedBtn account={account} onConnect={onConnect} disabled={phase !== "idle" || !ranked.length} onClick={signAndSponsor}>{label}</GatedBtn>
  </PanelFoot></div>;
}

// ---------- Step 4: Done ----------
export function Step4({ clients, txid, result, onRetry, onBack }) {
  const [tx, setTx] = useState(null);
  const [readErr, setReadErr] = useState(null);
  const outcome = txOutcome(tx);
  const polling = outcome.kind === "pending";
  const elapsed = useElapsed(polling);

  async function poll() {
    try {
      const j = await clients.chain.json(`/extended/v1/tx/0x${normTxid(txid)}`);
      setReadErr(null);
      if (j && j.tx_status) setTx(j);
    } catch (e) {
      // 404 while the node has not indexed the transaction yet is expected; keep polling.
      setReadErr((e && e.message) || String(e));
    }
  }
  useEffect(() => { poll(); }, [txid]);
  useInterval(poll, 10000, polling);

  const fail = outcome.kind === "abort" ? explainTxFailure(outcome.status, outcome.repr) : null;
  return <div className="body-wrap"><div className="body">
    <p className="step-sub">The relay broadcast the transaction; this page checks it every 10 seconds until it is mined, and the relay re-signs it with a higher fee if it is still pending after 10 minutes. Once mined, the STX received minus the network fee is yours to spend. If the swap aborted, retry from the amount step with more slippage.</p>
    <div className="kvs">
      <KV label="Transaction"><a href={explorerTx(txid)} target="_blank" rel="noopener">0x{normTxid(txid)}</a></KV>
      {result ? <KV label="Relay used">{result.relay}</KV> : null}
      {result ? <KV label="Sponsor">{result.sponsor}</KV> : null}
      <KV label="Status" mono={false}>{outcome.kind === "pending" ? <Badge k="pending">pending</Badge> : outcome.kind === "success" ? <Badge k="ok">success</Badge> : <Badge k="bad">{outcome.status}</Badge>}</KV>
      {outcome.kind === "success" ? <KV label="STX received">{outcome.received != null ? fmtStxBoth(outcome.received) : "unavailable (result not parsed)"}</KV> : null}
      {outcome.kind === "success" && outcome.received != null && result ? <KV label="Rebate paid to the sponsor">{fmtStxBoth(TIERS[result.tier] || 0n)}</KV> : null}
      {outcome.kind === "success" && outcome.received != null && result && TIERS[result.tier] ? <KV label="Net STX kept">{fmtStxBoth(outcome.received - TIERS[result.tier])}</KV> : null}
      {outcome.blockHeight ? <KV label="Mined in Stacks block">{group(outcome.blockHeight)}</KV> : null}
    </div>
    {polling ? <StatusLine kind="info"><span className="spin" style={{ marginRight: 8, verticalAlign: -1 }}></span>Checking every 10s: <span className="elapsed">{fmtElapsed(elapsed)}</span>{readErr ? <span> (last read: <span className="mono">{readErr}</span>)</span> : null} <a href="#" onClick={(e) => { e.preventDefault(); poll(); }}>Check now</a></StatusLine> : null}
    {outcome.kind === "success" ? <StatusLine kind="ok">The swap is mined. You now hold STX for network fees; the <a href={explorerAddr(tx.sender_address)} target="_blank" rel="noopener">explorer</a> shows the balance.</StatusLine> : null}
    {fail ? <StatusLine kind="err"><div>{fail.title} {fail.action}</div>{outcome.repr ? <div>Result: <span className="mono">{outcome.repr}</span>. The sponsor paid the network fee; you paid nothing.</div> : null}</StatusLine> : null}
  </div>
  <PanelFoot onBack={onBack}>
    {fail && fail.retryable ? <><Btn kind="secondary" lg onClick={() => onRetry(500n)}>Retry With 5 Percent Slippage</Btn><Btn kind="primary" lg onClick={() => onRetry(200n)}>Retry With 2 Percent Slippage</Btn></> : null}
    {outcome.kind === "success" ? <Btn kind="primary" lg onClick={() => onRetry(null)}>Swap Again</Btn> : null}
  </PanelFoot></div>;
}

// ---------- Per-step info (below the panel) ----------
export function StepInfo({ step }) {
  const blocks = {
    1: <div><p>This app runs on mainnet only and signs one contract call to <span className="mono">{CONTRACT_ID}</span>. It never asks for a seed phrase; keys stay in the wallet, and every call carries deny-mode post-conditions that the relay checks byte for byte before sponsoring.</p>
      <p><ExtLink href={`${DOCS}/sdk.md`}>SDK and wallet requirements</ExtLink> <ExtLink href={`${DOCS}/relay.md`}>Relay verification and error codes</ExtLink></p></div>,
    2: <div><p>The default provider fee is 50 bips of the swap amount, floored (it is 0 below 200 sats); this app passes no integrator, so the integrator fee is 0. The quote picks the whitelisted pool with the highest STX output for the net input; the DLMM pool is skipped when the best other output is at most 100 STX. Reads go to the node in <span className="mono">?api=</span> (reads only; the wallet signs for mainnet regardless).</p>
      <p><ExtLink href={`${DOCS}/contract.md`}>Contract: fees, tiers, pools, error codes</ExtLink> <ExtLink href={`${DOCS}/sdk.md`}>SDK: quote and defaults</ExtLink></p></div>,
    3: <div><p>The origin signature does not bind the sponsor or the fee: any relay holding the signed bytes can sponsor them, and the contract pays the network fee to whichever sponsor lands the transaction, never more than the tier you chose. A relay may refuse any transaction for any reason; it re-quotes before sponsoring because an on-chain abort costs the sponsor the fee.</p>
      <p><ExtLink href={`${DOCS}/relay.md`}>Relay API and error codes</ExtLink> <ExtLink href={`${DOCS}/contract.md#post-conditions`}>Post-conditions the relay requires</ExtLink> <ExtLink href="./disclaimer.html">Disclaimer</ExtLink></p></div>,
    4: <div><p>A swap that aborts on chain moved nothing: post-conditions and the contract's own checks revert every transfer, and the sponsor, not you, paid what the chain charged. The most common abort is the pool paying less than min-out after the price moved; 2 or 5 percent slippage usually clears it.</p>
      <p><ExtLink href={`${DOCS}/contract.md#error-codes`}>Error codes</ExtLink> <ExtLink href="https://explorer.hiro.so/?chain=mainnet">Stacks explorer</ExtLink></p></div>,
  };
  return <>
    <div className="info-sec"><h4>About this step</h4>{blocks[step]}</div>
    {step === 4 ? <div className="info-sec next-steps"><h4>Next steps</h4>
      <p>Once the swap is mined you hold STX for gas. Spend it on any Stacks transaction from the same wallet; to bring more BTC over as sBTC use the <ExtLink href={SBTC_BRIDGE}>sBTC bridge</ExtLink>, and to integrate this swap into a wallet or dapp read the <ExtLink href={`${DOCS}/sdk.md`}>SDK docs</ExtLink>.</p>
    </div> : null}
  </>;
}
