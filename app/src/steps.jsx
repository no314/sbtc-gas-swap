// The four step panels plus per-step info copy. One exported component per step; the shell,
// routing and URL contract live in app.jsx; constants and atoms in core.jsx.
import React, { useState, useEffect } from "react";
import { buildSwapCall, defaultTier, defaultSlippageBips, minOutFor, explainRelayError, explainTxFailure, TIERS, POOLS } from "@no314/sbtc-gas-swap";
import {
  CONTRACT_ID, DOCS, SBTC_BRIDGE, TIER_LIST, INTEGRATOR, INTEGRATOR_BIPS, Btn, Field, Badge, KV, StatusLine, CheckRow, ExtLink, GatedBtn, PanelFoot, How,
  useInterval, useElapsed, fmtElapsed, walletErrMsg,
} from "./core.jsx";
import {
  parseAmount, fmtSats, fmtBtc, fmtBoth, fmtStx, fmtStxBoth, fmtUstx, fmtSatsNum, fmtStxNum, fmtBips, bipsToPct, parseSlippagePct, fmtStamp, ledgerLines,
  txOutcome, shortTxid, shortPrincipal, explorerTx, explorerAddr, normTxid, originNonceFromHex, swapTxs,
} from "./amounts.js";
import { quoteFromSnapshot, freshQuoteFor, rankRelays, poolName, poolPrincipal } from "./chain.js";

const group = (n) => Number(n).toLocaleString("en-US");

// ---------- Step 1: Connect a wallet ----------
export function Step1({ account, walletName, catalog, onConnectWith, onDisconnect, connErr, onContinue, reloadedFromUrl }) {
  if (account) {
    return <div className="body-wrap"><div className="body">
      <p className="step-sub">Your wallet is connected. Continue to the amount, or disconnect to use another account.</p>
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
    <p className="step-sub">Connect the wallet that holds your sBTC. You need no STX: a sponsor pays the miner fee, and the swap repays the sponsor in STX from what the pool pays you. We tested Leather with this swap. Other wallets are listed untested.</p>
    {reloadedFromUrl ? <StatusLine kind="info">You opened this page from a transaction id. Connect a wallet when you want another swap.</StatusLine> : null}
    <div className="pick wallet-pick">
      {catalog.map((w) => {
        const tierBadge = w.tier === "verified" ? <Badge k="ok">tested</Badge> : w.tier === "untested" ? <Badge k="warn">untested</Badge> : <Badge k="bad">not supported</Badge>;
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
          <span className="meta">drops the limits</span>
        </div>;
      })}
    </div>
    <p className="step-sub" style={{ marginTop: 16, marginBottom: 0 }}>Untested wallet: before you approve, check that its signing screen lists the three limits and a fee of 0.</p>
    <StatusLine kind="err">{connErr}</StatusLine>
    <How>
      <p>Your wallet signs a sponsored transaction, one that someone else pays the miner fee for, and hands it back to this page without broadcasting it. The transaction carries three post-conditions, limits the blockchain enforces on what it may move: the sBTC you send, the network fee in STX, and the minimum STX you receive.</p>
      <p>The sponsor checks those limits byte for byte and refuses a transaction without them. A wallet that drops post-conditions cannot be sponsored.</p>
    </How>
  </div>
  <PanelFoot></PanelFoot></div>;
}

// ---------- Step 2: Swap amount ----------
export function Step2({ account, onConnect, verification, relays, snapshot, snapshotError, refreshing, onRefresh, swap, setSwap, onContinue, onBack, readOnly, committed }) {
  if (readOnly && committed) {
    return <div className="body-wrap"><div className="body">
      <div className="kvs">
        <KV label="Swap amount">{fmtBoth(committed.amountSats)}</KV>
        <KV label="Pool">{poolName(committed.call ? Number(committed.call.functionArgs[3].value) : committed.poolId)}</KV>
        <KV label="Quote">{fmtStxBoth(committed.quoteOut)}</KV>
        <KV label="Network fee">{committed.tier}, {fmtStxBoth(TIERS[committed.tier])}</KV>
        <KV label="Slippage">{fmtBips(committed.slippageBips)}</KV>
        <KV label="Minimum you receive">{fmtStxBoth(committed.minOut)}</KV>
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
    try { call = buildSwapCall({ user: account, amountSats: sats, tier, poolId: best.poolId, quoteOut: best.out, slippageBips, integrator: INTEGRATOR, integratorBips: INTEGRATOR_BIPS }); }
    catch (e) { buildErr = e; }
  }
  const minOut = best && slippageBips != null ? minOutFor(best.out, slippageBips) : null;
  const balance = snapshot ? snapshot.balance : null;
  const insufficient = balance != null && sats != null && sats > balance;

  const blockers = [];
  if (!verified) blockers.push("contract not verified");
  if (!snapshot) blockers.push("pools not read yet");
  if (sats == null) blockers.push("no amount yet");
  if (snapshot && balance == null) blockers.push("sBTC balance unavailable");
  if (insufficient) blockers.push("amount above balance");
  if (quote && !best) blockers.push("no quote for this amount");
  if (slippageBips == null) blockers.push("slippage out of range");
  if (buildErr) blockers.push(buildErr.code === "MIN_OUT_BELOW_TIER" ? "minimum below the network fee" : buildErr.code);
  if (!ranked.length) blockers.push("no sponsor for this fee level");
  const canContinue = account && blockers.length === 0 && call;

  const tierRank = (t) => TIER_LIST.findIndex((x) => x.key === t);

  return <div className="body-wrap"><div className="body">
    <p className="step-sub">Enter how much sBTC to swap. The quote comes from the pools' balances at the time shown; press Refresh for a new one. The network fee is the STX you repay the sponsor, taken from the STX the pool pays you.</p>

    <div className="readerline">
      {verification == null ? <><span className="spin"></span> reading the contract</>
        : verification.ok ? <><Badge k="ok">contract verified</Badge> the live contract matches the reviewed source</>
        : verification.error ? <><Badge k="idle">contract unavailable</Badge> this page could not read the contract: <span className="mono">{verification.error}</span>. Refresh to retry.</>
        : <><Badge k="bad">contract mismatch</Badge> the live contract does not match the reviewed source (live structure hash <span className="mono">{verification.liveHash}</span>, reviewed <span className="mono">{verification.pinnedHash}</span>). Swapping is blocked.</>}
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
        <div className="hint">{sats ? <span className="mono">{swap.unit === "sats" ? fmtBtc(sats) : fmtSats(sats)}</span> : "shown in sats and BTC once you enter an amount"}</div>
      </Field>
      <Field label="sBTC balance">
        <input className="in mono" readOnly value={!account ? "connect a wallet" : !snapshot ? (snapshotError ? "unavailable" : "reading") : balance == null ? "unavailable" : fmtBoth(balance)} />
        <div className="hint">{snapshot && account && balance == null ? <span>this page could not read the balance: <span className="mono">{snapshot.balanceError}</span></span> : "read together with the pools; Refresh reads it again"}</div>
      </Field>
    </div>

    <div className="two tier-row">
      <Field label="Network fee (STX, repaid to the sponsor)">
        <div className="tiers" role="radiogroup">
          {TIER_LIST.map((t) => {
            const below = relayMin ? tierRank(t.key) < tierRank(relayMin) : false;
            return <label key={t.key} className={`tier${t.key === tier ? " sel" : ""}${below ? " off" : ""}`}>
              <input type="radio" name="tier" value={t.key} checked={t.key === tier} disabled={below}
                onChange={() => setSwap((s) => ({ ...s, tier: t.key, tierTouched: true }))} style={{ accentColor: "var(--accent)" }} />
              <span className="tname">{t.key}</span>
              <span className="tval">{fmtStx(t.ustx)}</span>
              {relayMin === t.key ? <span className="tmin">sponsor minimum</span> : below ? <span className="tmin">below the sponsor minimum</span> : null}
            </label>;
          })}
        </div>
        <div className="hint">{relays == null ? "reading the sponsor services" : relayMin ? <span>default for this amount: {autoTier}; sponsor minimum: {relayMin}</span> : "no sponsor service answered, so the minimum is unknown"}</div>
      </Field>
      <Field label="Slippage (percent, 0.1 to 99)">
        <input className="in mono slip-in" spellCheck="false" inputMode="decimal" value={slippageText}
          onChange={(e) => setSwap((s) => ({ ...s, slippageText: e.target.value, slippageTouched: true }))} />
        <div className="hint">default {bipsToPct(autoSlip)}% for this amount (10% up to 30,000 sats, 1% above){swap.slippageTouched ? <>; <a href="#" onClick={(e) => { e.preventDefault(); setSwap((s) => ({ ...s, slippageTouched: false })); }}>use the default</a></> : null}</div>
      </Field>
    </div>

    <div className="kvs">
      <KV label="Swap amount">{sats ? fmtBoth(sats) : "-"}</KV>
      <KV label="Pool">{best ? poolName(best.poolId) : "-"}</KV>
      <KV label="Quote">{best ? fmtStxBoth(best.out) : "-"}</KV>
      <KV label="Default provider fee (0.5%)">{quote ? fmtSats(quote.fees.serviceFee) : "-"}</KV>
      <KV label="Integrator fee (1%, to stx.fan)">{quote ? fmtSats(quote.fees.integratorFee) : "-"}</KV>
      <KV label="sBTC into the pool">{quote ? fmtSats(quote.fees.net) : "-"}</KV>
      <KV label="Network fee">{`${tier}, ${fmtStxBoth(TIERS[tier])}`}</KV>
      <KV label={`Minimum you receive (quote minus ${slippageBips != null ? fmtBips(slippageBips) : "slippage"})`}>{minOut != null ? fmtStxBoth(minOut) : "-"}</KV>
      <KV label="Price impact">{best ? fmtBips(best.impactBips) : "-"}</KV>
      <KV label="Pools read">{quote ? <span>
        {quote.quotes.map((p) => <span key={p.poolId} className="poolq">{poolName(p.poolId)} {p.out > 0n ? fmtStx(p.out) : (p.reason || "no quote")}</span>)}
        {quote.unavailable.map((u) => <span key={u.poolId} className="poolq unavail">{poolName(u.poolId)} unavailable</span>)}
      </span> : snapshot ? <span>{snapshot.unavailable.map((u) => <span key={u.poolId} className="poolq unavail">{poolName(u.poolId)} unavailable</span>)}{Object.keys(snapshot.states).length ? <span className="poolq">{Object.keys(snapshot.states).map((id) => poolName(Number(id))).join(", ")} read</span> : null}</span> : "-"}</KV>
    </div>

    <div className="readerline stamp">
      {snapshot ? <span>read <span className="mono">{fmtStamp(snapshot.readAt)}</span>; latest Stacks block <span className="mono">{snapshot.tip != null ? group(snapshot.tip) : "unavailable"}</span>{relays ? <>; {relays.infos.length} sponsor {relays.infos.length === 1 ? "service" : "services"} reachable</> : null}</span>
        : snapshotError ? <span>this page could not read the pools: <span className="mono">{snapshotError}</span></span>
        : <><span className="spin"></span> reading the pools</>}
      <span className="spacer"></span>
      <button className="linkbtn" disabled={refreshing} onClick={onRefresh}><i className="ph ph-arrows-clockwise"></i>{refreshing ? "Refreshing" : "Refresh"}</button>
    </div>

    {snapshot && snapshot.unavailable.length ? <StatusLine kind="info">{snapshot.unavailable.map((u) => <div key={u.poolId}>{poolName(u.poolId)} could not be read (<span className="mono">{u.error}</span>), so the quote leaves it out.</div>)}</StatusLine> : null}
    {amt.error ? <StatusLine kind="err">{amt.error}</StatusLine> : null}
    {insufficient ? <StatusLine kind="err">The swap amount {fmtSats(sats)} is above the sBTC balance {fmtSats(balance)}.</StatusLine> : null}
    {slippageBips == null ? <StatusLine kind="err">Slippage must be a percentage from 0.1 to 99 with at most two decimals.</StatusLine> : null}
    {quote && !best ? <StatusLine kind="err">No pool can quote this amount ({quote.error}). Raise the amount or Refresh.</StatusLine> : null}
    {buildErr ? <StatusLine kind="err">{buildErr.code === "MIN_OUT_BELOW_TIER" && minOut != null
      ? <span>The minimum you would receive, {fmtStxBoth(minOut)}, is below the {tier} network fee of {fmtStxBoth(TIERS[tier])}. Raise the amount, choose a lower fee level, or lower the slippage.</span>
      : `${buildErr.message}.`}</StatusLine> : null}
    {relays && !ranked.length ? <StatusLine kind="err">{relays.infos.length ? `No sponsor service accepts the ${tier} fee level; the lowest they accept is ${relays.minTier}.` : "No sponsor service answered, so nothing can pay for the swap right now. Refresh to retry."}</StatusLine> : null}
    <How>
      <p>The quote reads the three supported pools and picks the one that pays the most STX for the sBTC going into the pool after fees. The minimum you receive is the quote minus the slippage, the amount the price may move before the swap refuses. It must stay above the network fee, because the sponsor is repaid out of it. This page stores nothing; a reload starts over.</p>
      <div className="kvs">
        {verification && verification.ok ? <KV label="Contract structure hash">{verification.liveHash}</KV> : null}
        {verification && verification.ok ? <KV label="Contract published in Stacks block">{group(verification.publishHeight)}</KV> : null}
        <KV label="Integrator fee recipient (stx.fan)">{INTEGRATOR}</KV>
        {snapshot ? <KV label="Latest Bitcoin block">{snapshot.burnTip != null ? group(snapshot.burnTip) : "unavailable"}</KV> : null}
        {relays ? <KV label="Sponsor services read">{fmtStamp(relays.readAt)}, from the sponsors.json next to this page</KV> : null}
      </div>
    </How>
  </div>
  <PanelFoot onBack={onBack}>
    {account && blockers.length ? <span className="foot-note">blocked: {blockers.join(", ")}</span> : null}
    <GatedBtn account={account} onConnect={onConnect} disabled={!canContinue} onClick={() => onContinue({ amountSats: sats, tier, slippageBips, poolId: best.poolId, quoteOut: best.out, minOut: call.minOut, fees: call.fees, call, quotedAt: snapshot.readAt, tip: snapshot.tip, burnTip: snapshot.burnTip, ranked })}>
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
        <KV label="Sponsor service">{result.relay}</KV>
        <KV label="Sponsor address">{result.sponsor}</KV>
        <KV label="Miner fee paid by the sponsor">{fmtStxBoth(BigInt(result.fee || 0))}</KV>
      </div>
    </div><PanelFoot onBack={onBack}></PanelFoot></div>;
  }

  async function signAndSponsor() {
    setErr(null); setFresh(null);
    setPhase("requoting");
    const f = await freshQuoteFor(clients, c.amountSats, c.poolId);
    setFresh(f);
    if (!f.quote || f.quote.out === 0n) { setErr(<span>{poolName(c.poolId)} did not answer the fresh read. Go back and quote again.</span>); setPhase("idle"); return; }
    if (f.quote.out < c.minOut) {
      setErr(<span>The price fell: the fresh quote {fmtStxBoth(f.quote.out)} is below your minimum {fmtStxBoth(c.minOut)} (the step 2 quote was {fmtStxBoth(c.quoteOut)}). Go back and quote again, or raise the slippage.</span>);
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
      if (!/^[0-9a-f]{100,}$/i.test(hex)) { setErr("The wallet returned no signed transaction. A wallet that broadcasts the transaction itself cannot be sponsored."); setPhase("idle"); return; }
    } catch (e) { setErr(walletErrMsg(e) || ("The wallet request failed: " + ((e && e.message) || e))); setPhase("idle"); return; }
    setPhase("sponsoring");
    const sub = await clients.relay.submit(hex, ranked).catch((e) => ({ ok: false, attempts: [{ relay: "-", code: "RELAY_UNREACHABLE", message: String((e && e.message) || e) }] }));
    if (!sub.ok) {
      setErr(<div>{sub.attempts.map((a, i) => { const x = explainRelayError(a.code); return <div key={i}><span className="mono">{a.relay}</span> ({a.code}): {x.title} {x.action}{a.message && a.message !== a.code ? <div className="hint">The sponsor service said: <span className="mono">{a.message}</span></div> : null}</div>; })}{sub.attempts.length === 0 ? "No sponsor service was tried." : null}</div>);
      setPhase("idle"); return;
    }
    setPhase("idle");
    onSponsored({ txid: normTxid(sub.txid), relay: sub.relay, sponsor: sub.sponsor, fee: sub.fee, origin: account, originNonce: originNonceFromHex(hex) });
  }

  const label = phase === "requoting" ? "Re-quoting" : phase === "signing" ? "Waiting for the Wallet" : phase === "sponsoring" ? "Sending to the Sponsor" : "Sign and Swap";
  // The sBTC limit follows the post-condition exactly: eq for pools that always consume the full
  // input, lte for DLMM, which can fill part of the swap and leave the rest with the user.
  const partialPool = POOLS[c.poolId] && POOLS[c.poolId].sbtcCondition === "lte";
  return <div className="body-wrap"><div className="body">
    <p className="step-sub">Check the three limits below; your wallet shows the same three before you sign. The page reads a fresh quote first and stops if the price fell below your minimum. A sponsor then adds its signature, pays the miner fee, and broadcasts the transaction.</p>
    <div className="prereq pcs">
      {partialPool
        ? <div className="item"><i className="ph ph-shield-check"></i><span>You send at most <span className="mono">{fmtBoth(c.amountSats)}</span> of sBTC: <span className="mono">{fmtSats(c.fees.serviceFee)}</span> default provider fee, <span className="mono">{fmtSats(c.fees.integratorFee)}</span> integrator fee to stx.fan, up to <span className="mono">{fmtSats(c.fees.net)}</span> into the pool. This pool can fill part of the swap; you keep the sBTC it does not take.</span></div>
        : <div className="item"><i className="ph ph-shield-check"></i><span>You send exactly <span className="mono">{fmtBoth(c.amountSats)}</span> of sBTC: <span className="mono">{fmtSats(c.fees.serviceFee)}</span> default provider fee, <span className="mono">{fmtSats(c.fees.integratorFee)}</span> integrator fee to stx.fan, <span className="mono">{fmtSats(c.fees.net)}</span> into the pool.</span></div>}
      <div className="item"><i className="ph ph-shield-check"></i><span>You send exactly <span className="mono">{fmtStxBoth(TIERS[c.tier])}</span>, the {c.tier} network fee, to the sponsor, who pays the miner fee.</span></div>
      <div className="item"><i className="ph ph-shield-check"></i><span>{poolName(c.poolId)} sends you at least <span className="mono">{fmtStxBoth(c.minOut)}</span>, your minimum.</span></div>
      <div className="item"><i className="ph ph-prohibit"></i><span>Nothing else moves. The blockchain blocks any other transfer, and the sponsor refuses a transaction without these three limits.</span></div>
    </div>
    <div className="kvs">
      <KV label="Contract">{CONTRACT_ID}</KV>
      <KV label="Quote at step 2">{fmtStxBoth(c.quoteOut)} (read <span>{fmtStamp(c.quotedAt)}</span> at Stacks block {c.tip != null ? group(c.tip) : "-"})</KV>
      <KV label={`Sponsor services for the ${c.tier} fee level`}>{ranked.length ? ranked.map((r) => <div key={r.url}>{r.url} (bids {fmtStx(BigInt(r.feeEstimate[c.tier] || 0))} to the miner)</div>) : "none"}</KV>
      {fresh && fresh.quote ? <KV label="Fresh quote before signing">{fmtStxBoth(fresh.quote.out)} (read {fmtStamp(fresh.readAt)})</KV> : null}
    </div>
    {phase !== "idle" ? <StatusLine kind="info"><span className="spin" style={{ marginRight: 8, verticalAlign: -1 }}></span>{phase === "requoting" ? "Reading a fresh quote from the pools." : phase === "signing" ? "Approve the transaction in your wallet. The wallet signs it and hands it back without broadcasting it; the sponsor broadcasts it." : "Sending the signed transaction to the sponsor service."}</StatusLine> : null}
    <StatusLine kind="err">{err}</StatusLine>
    <How>
      <p>Your wallet signs a sponsored transaction with a fee of 0 and hands it back without broadcasting it. The first sponsor service that accepts it checks the three post-conditions byte for byte, adds its signature, pays the miner fee and broadcasts. Deny mode means the blockchain aborts the transaction if anything moves that the post-conditions do not cover.</p>
      <div className="kvs">
        <KV label="Pool contract">{pool}</KV>
        <KV label="Latest Bitcoin block at step 2">{c.burnTip != null ? group(c.burnTip) : "-"}</KV>
      </div>
    </How>
  </div>
  <PanelFoot onBack={onBack}>
    <GatedBtn account={account} onConnect={onConnect} disabled={phase !== "idle" || !ranked.length} onClick={signAndSponsor}>{label}</GatedBtn>
  </PanelFoot></div>;
}

// ---------- Step 4: Done ----------
// Two ledgers on the Done page, from the mined transaction only. One unit per ledger, stated
// once in the header; deductions carry a minus in their own column so digits stack; the total
// is ruled above and weighted. No colour: sign and position carry the meaning. The pool swap
// between the two ledgers is on the review step and is deliberately not a row here.
function Ledger({ title, unit, rows, total, fmt }) {
  return <div className="ledger">
    <div className="ledger-head"><span>{title}</span><span className="unit">{unit}</span></div>
    {rows.map((r) => <div key={r.label} className={`ledger-row${r.sign ? " ded" : ""}`}>
      <span className="l">{r.label}</span><span className="s mono">{r.sign}</span><span className="n mono">{fmt(r.value)}</span>
    </div>)}
    <div className="ledger-row total"><span className="l">{total.label}</span><span className="s mono"></span><span className="n mono">{fmt(total.value)}</span></div>
  </div>;
}

export function Step4({ clients, txid, origin, originNonce, result, onRetry, onBack }) {
  const [reads, setReads] = useState({ direct: null, addressTxs: [], mempoolTxs: [] });
  const [readErr, setReadErr] = useState(null);
  const swap = swapTxs(txid, origin, originNonce, reads);
  const tx = swap.current;
  const outcome = txOutcome(tx);
  const polling = outcome.kind === "pending";
  const elapsed = useElapsed(polling);

  // Three reads per tick, independent: the txid the relay returned (fastest on a normal day),
  // then the wallet's confirmed and pending transactions, filtered to this nonce. A 404 on the
  // txid is expected until the node indexes it, and permanent when a twin won; the other two
  // reads are what resolve that case.
  async function poll() {
    const direct = clients.chain.json(`/extended/v1/tx/0x${normTxid(txid)}`);
    const addr = origin && originNonce != null ? clients.chain.json(`/extended/v1/address/${origin}/transactions?limit=20`) : Promise.resolve(null);
    const mem = origin && originNonce != null ? clients.chain.json(`/extended/v1/tx/mempool?sender_address=${origin}&limit=20`) : Promise.resolve(null);
    const [d, a, m] = await Promise.allSettled([direct, addr, mem]);
    const next = { ...reads };
    if (d.status === "fulfilled" && d.value && d.value.tx_status) { next.direct = d.value; setReadErr(null); }
    else if (d.status === "rejected") setReadErr((d.reason && d.reason.message) || String(d.reason));
    if (a.status === "fulfilled" && a.value && Array.isArray(a.value.results)) next.addressTxs = a.value.results;
    if (m.status === "fulfilled" && m.value && Array.isArray(m.value.results)) next.mempoolTxs = m.value.results;
    setReads(next);
  }
  useEffect(() => { poll(); }, [txid]);
  useInterval(poll, 10000, polling);

  const fail = outcome.kind === "abort" ? explainTxFailure(outcome.status, outcome.repr) : null;
  const ledger = ledgerLines(outcome);
  const txLink = (t) => <a href={explorerTx(t)} target="_blank" rel="noopener">0x{normTxid(t)}</a>;
  return <div className="body-wrap"><div className="body">
    <p className="step-sub">The sponsor broadcast your transaction. This page checks every 10 seconds until it is mined. Once mined, the STX you received, minus the network fee, is yours to spend. If the swap did not go through, retry from the amount step with more slippage.</p>
    <div className="kvs">
      <KV label="Transaction">{txLink(txid)}{swap.replaced ? <Badge k="pending">Replaced by fee</Badge> : null}</KV>
      {swap.replaced ? <KV label="Mined as">{txLink(swap.confirmedTwin.tx_id)}</KV> : null}
      {swap.pendingTwins.map((t) => <KV key={t.tx_id} label="Also pending">{txLink(t.tx_id)}</KV>)}
      {result && result.relay ? <KV label="Sponsor service">{result.relay}</KV> : null}
      {result && result.sponsor ? <KV label="Sponsor address">{result.sponsor}</KV> : null}
      <KV label="Status" mono={false}>{outcome.kind === "pending" ? <Badge k="pending">pending</Badge> : outcome.kind === "success" ? <Badge k="ok">success</Badge> : <Badge k="bad">{outcome.status}</Badge>}</KV>
      {outcome.blockHeight ? <KV label="Mined in Stacks block">{group(outcome.blockHeight)}</KV> : null}
    </div>
    {ledger ? <div className="ledgers">
      <Ledger title="sBTC" unit="sats" rows={ledger.sbtc.rows} total={ledger.sbtc.total} fmt={fmtSatsNum} />
      <Ledger title="STX" unit="STX" rows={ledger.stx.rows} total={ledger.stx.total} fmt={fmtStxNum} />
    </div> : null}
    {outcome.kind === "success" && !ledger ? <div className="kvs"><KV label="STX received">{outcome.received != null ? fmtStxBoth(outcome.received) : "unavailable (result not parsed)"}</KV></div> : null}
    {polling ? <StatusLine kind="info"><span className="spin" style={{ marginRight: 8, verticalAlign: -1 }}></span>Checking every 10 seconds, <span className="elapsed">{fmtElapsed(elapsed)}</span> so far. <a href="#" onClick={(e) => { e.preventDefault(); poll(); }}>Check now</a></StatusLine> : null}
    {outcome.kind === "success" ? <StatusLine kind="ok">The swap is mined. You now hold STX for gas; the <a href={explorerAddr(tx.sender_address)} target="_blank" rel="noopener">Stacks explorer</a> shows the balance.</StatusLine> : null}
    {fail ? <StatusLine kind="err"><div>{fail.title} {fail.action}</div>{outcome.repr ? <div>Result: <span className="mono">{outcome.repr}</span>. The sponsor paid the miner fee.</div> : null}</StatusLine> : null}
    <How>
      <p>This page follows the transaction nonce, your account's transaction counter, rather than one transaction id, because the transaction can be replaced. The sponsor re-signs it with a higher miner fee if it sits unmined (after 10 minutes at the high fee level, 30 at low and mid), and a transaction that reached the sponsor twice can mine under either id. Whichever transaction mines at this nonce is the result; the id the sponsor returned stays listed and reads Replaced by fee.</p>
      <div className="kvs">
        {origin && originNonce != null ? <KV label="Transaction nonce">{String(originNonce)}</KV> : null}
        {origin && originNonce != null ? <KV label="Account">{origin}</KV> : null}
        {readErr && polling ? <KV label="Last read">{readErr}</KV> : null}
      </div>
      {origin && originNonce != null ? <p>The transaction nonce is the nonce your account signed this transaction with: the next one after its last confirmed transaction when you signed. The sponsor's own nonce is separate.</p> : null}
    </How>
  </div>
  <PanelFoot onBack={onBack}>
    {fail && fail.retryable ? <><Btn kind="secondary" lg onClick={() => onRetry(500n)}>Retry with 5 Percent Slippage</Btn><Btn kind="primary" lg onClick={() => onRetry(200n)}>Retry with 2 Percent Slippage</Btn></> : null}
    {outcome.kind === "success" ? <Btn kind="primary" lg onClick={() => onRetry(null)}>Swap Again</Btn> : null}
  </PanelFoot></div>;
}

// ---------- Per-step info (below the panel) ----------
export function StepInfo({ step }) {
  const blocks = {
    1: <div><p>This app runs on mainnet only and asks your wallet to sign one contract call to <span className="mono">{CONTRACT_ID}</span>. Your keys stay in the wallet.</p>
      <p><ExtLink href={`${DOCS}/sdk.md`}>SDK and wallet requirements</ExtLink> <ExtLink href={`${DOCS}/relay.md`}>Sponsor service checks and error codes</ExtLink></p></div>,
    2: <div><p>Three fees come out of the swap, all shown above before you sign: the network fee in STX to the sponsor, 0.5 percent of the sBTC to the default provider, and 1 percent to stx.fan, which publishes this page. Fees under one sat round to zero.</p>
      <p><ExtLink href={`${DOCS}/contract.md`}>Contract: fees, pools, error codes</ExtLink> <ExtLink href={`${DOCS}/sdk.md`}>SDK: quote and defaults</ExtLink></p></div>,
    3: <div><p>Any sponsor service holding your signed transaction may pay for it; the contract repays whichever one gets it mined, never more than the fee level you chose. A sponsor may refuse for any reason, and a refusal costs you nothing.</p>
      <p><ExtLink href={`${DOCS}/relay.md`}>Sponsor service API and error codes</ExtLink> <ExtLink href={`${DOCS}/contract.md#post-conditions`}>Post-conditions the sponsor requires</ExtLink> <ExtLink href="./disclaimer.html">Disclaimer</ExtLink></p></div>,
    4: <div><p>A swap that does not go through moves nothing: your post-conditions and the contract's own checks undo each transfer, and the sponsor paid the miner fee. The common cause is the price moving below your minimum between the quote and the block; 2 or 5 percent slippage clears it in most cases.</p>
      <p><ExtLink href={`${DOCS}/contract.md#error-codes`}>Error codes</ExtLink> <ExtLink href="https://explorer.hiro.so/?chain=mainnet">Stacks explorer</ExtLink></p></div>,
  };
  return <>
    <div className="info-sec"><h4>About this step</h4>{blocks[step]}</div>
    {step === 4 ? <div className="info-sec next-steps"><h4>Next steps</h4>
      <p>You now hold STX for gas and can send any Stacks transaction from this wallet. To bring more BTC over as sBTC, use the <ExtLink href={SBTC_BRIDGE}>sBTC bridge</ExtLink>. To put this swap in your own wallet or app, read the <ExtLink href={`${DOCS}/sdk.md`}>SDK docs</ExtLink>.</p>
    </div> : null}
  </>;
}
