// Operator page: deploy the reviewed contract through Leather (Ledger capable). Not linked from the app.
import "./styles/tokens.css";
import "./styles/app.css";
import "./lib.js";
import CONTRACT_SOURCE from "../../contracts/contracts/sbtc-gas-swap-v1.clar?raw";
import { structureHash, PINNED_STRUCTURE_HASH } from "@no314/sbtc-gas-swap";

const DEPLOYER = "SP2BM6AQSMQ04CX8KDE62QBFVZTDZ2ZX80GZJSBZ4";
const $ = (id) => document.getElementById(id);
let account = null;

structureHash(CONTRACT_SOURCE).then((h) => {
  $("hash").textContent = h;
  const ok = h === PINNED_STRUCTURE_HASH;
  $("hash-status").textContent = ok ? "Match." : "MISMATCH: do not deploy; the source differs from the reviewed one.";
  if (!ok) $("deploy").disabled = true;
});

$("connect").addEventListener("click", async () => {
  const L = window.SGLib;
  const leather = L.detectWallets().find((w) => w.tier === "verified");
  if (!leather) { $("account-status").textContent = "Leather is not installed in this browser."; return; }
  L.setSelectedProviderId(leather.id);
  try {
    const res = await L.connect({ network: "mainnet", forceWalletSelect: false });
    const addrs = (res && res.addresses) || [];
    const stx = addrs.find((a) => /^S[PM]/.test(a.address));
    account = stx ? stx.address : null;
    $("account").textContent = account || "no mainnet STX address returned";
    const ok = account === DEPLOYER;
    $("account-status").textContent = ok ? "This is the deployer." : "Not the deployer account. Switch Leather to the Ledger account " + DEPLOYER + " and connect again.";
    $("deploy").disabled = !ok || $("hash-status").textContent.startsWith("MISMATCH");
  } catch (e) { $("account-status").textContent = "Connect failed: " + ((e && e.message) || e); }
});

$("deploy").addEventListener("click", async () => {
  $("deploy").disabled = true;
  $("result").textContent = "Waiting for Leather.";
  try {
    const res = await window.SGLib.request("stx_deployContract", {
      name: "sbtc-gas-swap-v1",
      clarityCode: CONTRACT_SOURCE,
      clarityVersion: 3,
      network: "mainnet",
      address: account,
      postConditionMode: "deny",
      postConditions: [],
    });
    const txid = String((res && res.txid) || "").replace(/^0x/i, "");
    if (!/^[0-9a-f]{64}$/i.test(txid)) { $("result").textContent = "Leather returned no txid: " + JSON.stringify(res).slice(0, 300); $("deploy").disabled = false; return; }
    $("result").innerHTML = "Broadcast. txid <span class=\"mono\">" + txid + "</span>. <a target=\"_blank\" rel=\"noopener\" href=\"https://explorer.hiro.so/txid/0x" + txid + "?chain=mainnet\">Open in the explorer</a>. Deploys take one or two blocks.";
  } catch (e) { $("result").textContent = "Deploy request failed or was cancelled: " + ((e && e.message) || e); $("deploy").disabled = false; }
});
