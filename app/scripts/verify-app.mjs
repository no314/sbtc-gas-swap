// Executes the built artifact (dist/) in headless Chromium and walks the acceptance criteria
// (PROMPT.md sections 7 and 10, the three skills) against the build, not the source tree.
// Fixture mode (?fixture=) answers every read and relay call from src/fixtures.js through the
// SDK clients' injected fetch, so the whole run makes zero network requests; a check asserts
// exactly that. The wallet bridge is stubbed in page. Run `npm run build` first. Screenshots
// of every step in every fixture state land in screenshots/ at deviceScaleFactor 2.
// `--shots-only` keeps the walk and the screenshots but exits 0 regardless of failures.
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";
import { chromium } from "playwright-core";

const SHOTS_ONLY = process.argv.includes("--shots-only");
const DIST = new URL("../dist", import.meta.url).pathname;
const SHOTS = new URL("../screenshots", import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".svg": "image/svg+xml", ".png": "image/png" };
const server = createServer((req, res) => {
  const path = req.url.split("?")[0];
  const file = join(DIST, path === "/" ? "index.html" : path);
  if (existsSync(file)) { res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" }); res.end(readFileSync(file)); }
  else { res.writeHead(200, { "content-type": "text/html" }); res.end(readFileSync(join(DIST, "index.html"))); }
});
await new Promise((r) => server.listen(4173, r));
const BASE = "http://localhost:4173";

const exec = process.env.CHROMIUM || "/opt/pw-browsers/chromium";
const browser = await chromium.launch({
  executablePath: existsSync(exec) ? exec : undefined,
  args: ["--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding"],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
const externalRequests = [];
page.on("request", (r) => { if (!r.url().startsWith(BASE)) externalRequests.push(r.url()); });

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  (" + extra + ")" : ""}`); };
const shot = (name) => page.screenshot({ path: join(SHOTS, name + ".png"), fullPage: true });
const text = async (sel) => (await page.textContent(sel)) || "";
const body = () => page.evaluate(() => document.body.innerText);
const noEmDash = () => page.evaluate(() => !document.body.innerText.includes("\u2014"));
const localStorageLen = () => page.evaluate(() => localStorage.length);
const railStates = () => page.evaluate(() => [...document.querySelectorAll(".rail > *")].map((el) => el.classList.contains("rail-tab") ? "tab" : ["locked", "active", "complete", "blocked", "skipped"].find((c) => el.classList.contains(c)) || "?"));
const kv = async (label) => page.evaluate((l) => { const row = [...document.querySelectorAll(".kv")].find((k) => k.children[0].textContent.startsWith(l)); return row ? row.children[1].textContent : null; }, label);
const primary = () => page.locator(".panel .foot .btn-primary");

const USER = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";
const RELAY = "https://relay.fixture.invalid";
const TXID = "7d3f0a5c9e1b2846a0c3d5e7f9b1d3a5c7e9f1b3d5a7c9e1f3b5d7a9c1e3f5b7";
const CONTRACT = "SP2BM6AQSMQ04CX8KDE62QBFVZTDZ2ZX80GZJSBZ4.sbtc-gas-swap-v1";

// Every-step invariants: disclaimer link in the footer, no em dash, nothing in localStorage,
// "Next steps" only on step 4.
async function invariants(where, step) {
  check(`${where}: disclaimer link in the footer`, (await page.getAttribute(".site-foot .disclaimer-link", "href")) === "./disclaimer.html");
  check(`${where}: no em dash in rendered text`, await noEmDash());
  check(`${where}: localStorage stays empty`, (await localStorageLen()) === 0);
  check(`${where}: Next steps ${step === 4 ? "present" : "absent"}`, (await page.locator(".next-steps").count()) === (step === 4 ? 1 : 0));
}

// Wallet bridge stub: Leather installed, connect returns the fixture user, a sponsored call
// returns signed bytes and no txid (Leather's real behavior for sponsored: true).
async function stubWallet() {
  await page.evaluate((user) => {
    window.wbip_providers = [{ id: "LeatherProvider", name: "Leather" }];
    window.__requests = [];
    window.SGLib.setSelectedProviderId = (id) => { window.__pickedProvider = id; };
    window.SGLib.connect = async () => ({ addresses: [{ address: user }] });
    window.SGLib.disconnect = async () => {};
    window.SGLib.request = async (method, params) => { window.__requests.push({ method, params }); return { transaction: "0x80800000000400" + "ab".repeat(160) }; };
  }, USER);
}
async function open(fixture) {
  await page.goto(`${BASE}/?fixture=${fixture}`);
  await page.waitForSelector(".rail-tab");
}
async function connectLeather() {
  await stubWallet();
  await page.waitForSelector(".wallet-pick button", { timeout: 5000 });
  await page.click(".wallet-pick button");
  await page.waitForFunction(() => document.querySelector(".rail-tab .name")?.textContent === "Swap amount");
}
const quoteReady = () => page.waitForFunction(() => {
  const rows = [...document.querySelectorAll(".kv")];
  const pool = rows.find((k) => k.children[0].textContent.startsWith("Pool used"));
  const rl = document.querySelector(".readerline .badge");
  const bal = document.querySelector(".amount-row .field:nth-child(2) input");
  return pool && pool.children[1].textContent !== "-" && rl && !document.querySelector(".readerline .spin")
    && !document.querySelector(".linkbtn:disabled") && bal && bal.value !== "reading";
}, null, { timeout: 15000 });

// ---------- fresh load, step 1 (fixture happy) ----------
await open("happy");
check("loads; active tab is step 1 Connect a wallet", (await text(".rail-tab .name")) === "Connect a wallet");
check("rail has 4 entries numbered from 1", (await page.locator(".rail > *").count()) === 4 && (await text(".rail-tab .num")) === "1");
check("steps 2 to 4 locked and not clickable", (await page.locator(".rail-item.locked").count()) === 3 && (await page.locator(".rail-item.locked:disabled").count()) === 3);
check("URL carries chain=mainnet", page.url().includes("chain=mainnet"));
check("URL carries api at its default value", page.url().includes("api=" + encodeURIComponent("https://api.hiro.so")));
check("URL keeps the fixture flag", page.url().includes("fixture=happy"));
check("no txid in the URL before broadcast", !page.url().includes("txid="));
check("header states the contract principal", (await text(".hdr-contract")) === "SP2BM\u2026SBZ4.sbtc-gas-swap-v1" && (await page.getAttribute(".no-secrets", "title")) === CONTRACT);
check("header stays on one line at 1200 wide", await page.evaluate(() => document.querySelector(".hdr h1").getBoundingClientRect().height < 30 && document.querySelector(".hdr .wallet-menu .btn").getBoundingClientRect().height <= 36));
check("header states the no-seed-phrase fact", (await text(".no-secrets")).includes("Never asks for a seed phrase"));
check("header wallet button reads Connect Wallet", (await text(".hdr .wallet-menu button")).trim() === "Connect Wallet");
check("mainnet accent, no network switch", (await page.locator(".netsel").count()) === 0 && !(await page.evaluate(() => document.body.classList.contains("net-testnet"))));
check("mainnet pill in the header", (await text(".hdr .netpill")) === "Mainnet");
check("tab title", (await page.title()) === "sBTC to Stacks gas");
check("fixture banner names the fixture", (await text(".status.info")).includes("Fixture mode") && (await text(".status.info")).includes("happy"));
check("catalog: Leather verified, three untested, install links, no connect button without wallets",
  (await page.locator(".wallet-pick .pick-link").count()) === 4 && (await page.locator(".wallet-pick button").count()) === 0
  && (await page.locator(".wallet-pick .b-ok").count()) === 1 && (await page.locator(".wallet-pick .b-warn").count()) === 3);
check("Xverse offered untested with the relay refusal note", (await text(".panel")).includes("Xverse") && (await text(".panel")).includes("relay refuses any transaction lacking the exact post-conditions"));
await invariants("happy step 1", 1);
await shot("happy-step1-connect");

// rail geometry (verbatim from Zero to Signing's harness)
check("rail numbers share the tab number's baseline", await page.evaluate(() => {
  // Same font family everywhere (JetBrains Mono), so the baseline sits at a fixed
  // fraction of the glyph box measured via a Range around the text node.
  const base = el => {
    const tn = [...el.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
    const r = document.createRange(); r.selectNodeContents(tn || el);
    const rect = r.getBoundingClientRect();
    return rect.bottom - rect.height * (300 / 1320); // JetBrains Mono descent/(ascent+descent)
  };
  const tab = base(document.querySelector(".rail-tab .num"));
  return [...document.querySelectorAll(".rail-item .rail-num")].every(e => Math.abs(base(e) - tab) <= 2);
}));
check("tab stays flush with the panel", await page.evaluate(() => {
  const tab = document.querySelector(".rail-tab").getBoundingClientRect();
  const panel = document.querySelector(".panel").getBoundingClientRect();
  return Math.abs(tab.bottom - panel.top) <= 1;
}));
check("active step number uses text color", await page.evaluate(() => {
  const numColor = getComputedStyle(document.querySelector(".rail-tab .num")).color;
  const bodyColor = getComputedStyle(document.querySelector(".rail-tab .name")).color;
  return numColor === bodyColor;
}));
check("title and pill share a text baseline", await page.evaluate(() => {
  const textBottom = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().bottom; };
  const h = textBottom(document.querySelector(".hdr h1"));
  const s = textBottom(document.querySelector(".hdr .netpill"));
  return Math.abs(h - s) <= 3;
}));

// ---------- happy: connect, quote, sign, sponsor, pending then success ----------
await connectLeather();
check("Leather row connects and pins the provider", (await page.evaluate(() => window.__pickedProvider)) === "LeatherProvider");
check("header shows the short address after connect", (await text(".hdr .wallet-menu button")).includes("SP2J6"));
check("rail: step 1 complete, step 2 is the tab", JSON.stringify(await railStates()) === JSON.stringify(["complete", "tab", "locked", "locked"]));
check("fixture seeds the swap amount", (await page.inputValue(".unit-row input")) === "5000");
await quoteReady();
check("reader line: contract verified with the first 12 hash chars", (await text(".readerline")).includes("contract verified") && (await text(".readerline")).includes("5702f09a5ab5"));
check("sBTC balance read and shown in both units", (await page.inputValue(".amount-row .field:nth-child(2) input")) === "250,000 sats (0.00250000 BTC)");
check("both units under the amount field", (await text(".unit-row + .hint")) === "0.00005000 BTC");
check("pool used is Velar for 5,000 sats at the recorded reserves", (await kv("Pool used")) === "velar-univ2-70 (pool id 2)");
check("quote in both units", (await kv("Quote")) === "15.155105 STX (15,155,105 uSTX)");
check("default provider fee", (await kv("Default provider fee")) === "25 sats");
check("integrator fee c is 0 and says so", (await kv("Integrator fee")) === "0 sats: this app passes no integrator");
check("net input", (await kv("Net input")) === "4,975 sats");
check("tier defaults to low with the relay minimum shown", (await kv("Network fee (tier)")) === "low: 0.01 STX (10,000 uSTX)" && (await text(".tier.sel .tname")) === "low" && (await text(".tier.sel .tmin")) === "relay minimum");
check("slippage defaults to 10 percent for a small swap", (await page.inputValue(".slip-in")) === "10");
check("min-out from the SDK", (await kv("Min-out")) === "13.639594 STX (13,639,594 uSTX)");
check("price impact shown in percent", (await kv("Price impact")) === "0%");
check("all three pools read, none unavailable", (await kv("Pools read")).includes("bitflow-xyk") && (await kv("Pools read")).includes("bitflow-dlmm-v2") && !(await kv("Pools read")).includes("unavailable"));
check("read stamp with time and Stacks tip", /read \d\d:\d\d:\d\d, Stacks tip 8,923,977/.test(await text(".readerline.stamp")));
check("Refresh control present", (await page.locator(".linkbtn", { hasText: "Refresh" }).count()) === 1);
check("Continue enabled on a valid quote", !(await primary().isDisabled()) && (await primary().textContent()).includes("Continue"));
await invariants("happy step 2", 2);
await shot("happy-step2-amount");

// unit switch and validation
await page.selectOption(".unit-row select", "btc");
await page.fill(".unit-row input", "0.00005");
check("BTC unit converts to the same sats", (await kv("Swap amount")) === "5,000 sats (0.00005000 BTC)");
await page.fill(".unit-row input", "0.000000001");
check("9 decimals rejected", (await text(".status.err")).includes("BTC has at most 8 decimals"));
await page.selectOption(".unit-row select", "sats");
await page.fill(".unit-row input", "12.5");
check("fractional sats rejected", (await text(".status.err")).includes("Sats are whole numbers"));
await page.fill(".unit-row input", "300000");
check("amount above balance blocks", (await text(".status.err")).includes("above the sBTC balance") && await primary().isDisabled());
await shot("happy-step2-insufficient");
await page.fill(".unit-row input", "5000");
await page.fill(".slip-in", "0.05");
check("slippage below 0.1 rejected", (await text(".status.err")).includes("Slippage must be a percentage from 0.1 to 99"));
await page.fill(".slip-in", "2");
check("slippage 2 percent moves min-out", (await kv("Min-out")) === "14.852002 STX (14,852,002 uSTX)");
await page.click(".hint a"); // use the default
check("slippage default restored", (await page.inputValue(".slip-in")) === "10");
// tier override
await page.click(".tier:nth-child(3)");
check("high tier selectable, network fee row follows", (await kv("Network fee (tier)")) === "high: 1 STX (1,000,000 uSTX)");
await page.click(".tier:nth-child(1)");
// refresh re-reads
const stampBefore = await text(".readerline.stamp");
await page.waitForTimeout(1100);
await page.click(".linkbtn");
await page.waitForFunction(() => !document.querySelector(".linkbtn:disabled"));
await quoteReady();
check("Refresh re-reads and restamps", (await text(".readerline.stamp")) !== stampBefore);

// step 3
await primary().click();
await page.waitForFunction(() => document.querySelector(".rail-tab .name")?.textContent === "Sign and sponsor");
check("rail: 1 and 2 complete, 3 is the tab", JSON.stringify(await railStates()) === JSON.stringify(["complete", "complete", "tab", "locked"]));
const pcs = await text(".pcs");
check("post-condition 1 in plain words: exactly the swap amount of sBTC", pcs.includes("You send exactly 5,000 sats (0.00005000 BTC) of sBTC") && pcs.includes("25 sats default provider fee") && pcs.includes("4,975 sats net input"));
check("post-condition 2: exactly the tier in STX", pcs.includes("You send exactly 0.01 STX (10,000 uSTX)") && pcs.includes("network fee to the sponsor"));
check("post-condition 3: pool sends at least min-out", pcs.includes("velar-univ2-70 (SP20X3DC5R091J8B6YPQT638J8NR1W83KN6TN5BJY.univ2-pool-v1_0_0-0070) sends you at least 13.639594 STX (13,639,594 uSTX)"));
check("nothing else moves", pcs.includes("Nothing else moves"));
check("relay list names the fixture relay with its minimum and fee estimate", (await kv("Relays accepting")).includes(RELAY) && (await kv("Relays accepting")).includes("minimum low") && (await kv("Relays accepting")).includes("0.0032 STX"));
check("contract principal shown", (await kv("Contract")) === CONTRACT);
check("primary reads Sign And Sponsor", (await primary().textContent()).trim() === "Sign And Sponsor");
check("Back label aligns with content edge", await page.evaluate(() => {
  const body = document.querySelector(".panel .body").getBoundingClientRect();
  const back = document.querySelector(".foot .btn-tertiary").getBoundingClientRect();
  return Math.abs(back.left + 16 - body.left) <= 1;
}));
await invariants("happy step 3", 3);
await shot("happy-step3-sign");
await primary().click();
await page.waitForFunction(() => document.querySelector(".rail-tab .name")?.textContent === "Done", null, { timeout: 15000 });
const req = await page.evaluate(() => window.__requests[0]);
check("wallet asked once with stx_callContract", (await page.evaluate(() => window.__requests.length)) === 1 && req.method === "stx_callContract");
check("call fields: contract, function, 6 hex args", req.params.contract === CONTRACT && req.params.functionName === "swap-sbtc-for-gas" && req.params.functionArgs.length === 6 && req.params.functionArgs.every((a) => /^0x[0-9a-f]+$/.test(a)));
check("call fields: sponsored true, fee 0, deny mode, mainnet, 3 post-conditions", req.params.sponsored === true && req.params.fee === 0 && req.params.postConditionMode === "deny" && req.params.network === "mainnet" && req.params.postConditions.length === 3 && req.params.address === USER);
check("post-conditions: ft eq amount, stx eq tier, pool stx gte min-out", JSON.stringify(req.params.postConditions.map((p) => [p.type, p.address, p.condition, p.amount])) === JSON.stringify([
  ["ft-postcondition", USER, "eq", "5000"], ["stx-postcondition", USER, "eq", "10000"], ["stx-postcondition", "SP20X3DC5R091J8B6YPQT638J8NR1W83KN6TN5BJY.univ2-pool-v1_0_0-0070", "gte", "13639594"]]));
check("URL carries txid after broadcast, ordered chain, txid, api, fixture", new RegExp(`\\?chain=mainnet&txid=${TXID}&api=[^&]+&fixture=happy$`).test(page.url()), page.url());
check("rail: 1 to 3 complete, 4 is the tab", JSON.stringify(await railStates()) === JSON.stringify(["complete", "complete", "complete", "tab"]));
check("done step shows txid link to the explorer", (await page.getAttribute(".panel .kv a", "href")) === `https://explorer.hiro.so/txid/0x${TXID}?chain=mainnet`);
check("relay used, sponsor, and status pending", (await kv("Relay used")) === RELAY && (await kv("Sponsor")) === "SP3TB3AJ0XMZ9S6CGY2CQ6R06H1Z6DJQ1SH15ZP2H" && (await text(".panel .badge")) === "pending");
check("polling copy: every 10s with elapsed", (await text(".panel .status.info")).includes("Checking every 10s"));
await invariants("happy step 4 pending", 4);
await shot("happy-step4-pending");
await page.waitForFunction(() => document.querySelector(".panel .badge")?.textContent === "success", null, { timeout: 25000 });
check("second poll (10s later) reads success", true);
check("STX received parsed from tx_result", (await kv("STX received")) === "15.155105 STX (15,155,105 uSTX)");
check("rebate and net kept shown", (await kv("Rebate paid")) === "0.01 STX (10,000 uSTX)" && (await kv("Net STX kept")) === "15.145105 STX (15,145,105 uSTX)");
check("Next steps section present on step 4 only", (await text(".next-steps h4")) === "Next steps" && (await text(".next-steps p")).includes("you hold STX for gas"));
await shot("happy-step4-success");
// read-only views after broadcast
await page.click(".rail-item.complete >> nth=2");
await page.waitForSelector(".kvs");
check("completed step 3 renders a read-only summary with the txid", (await text(".rail-tab")).includes("read-only") && (await kv("Transaction")) === `0x${TXID.slice(0, 12)}\u2026` && (await page.locator(".panel .foot .btn-primary").count()) === 0);
check("read-only foot pinned to panel bottom", await page.evaluate(() => {
  const p = document.querySelector(".panel").getBoundingClientRect();
  const f = document.querySelector(".foot").getBoundingClientRect();
  return p.bottom - f.bottom < 40 && p.height >= 380;
}));
check("next steps absent on the read-only step 3", (await page.locator(".next-steps").count()) === 0);
await shot("happy-step3-readonly");
await page.click(".rail-item.complete >> nth=1");
await page.waitForSelector(".kvs");
check("completed step 2 read-only summary carries the committed values", (await kv("Slippage")) === "10%" && (await kv("Min-out")) === "13.639594 STX (13,639,594 uSTX)");
await shot("happy-step2-readonly");
await page.click(".rail-item.complete >> nth=0");
check("step 1 revisit shows the connected account", (await kv("Connected account")) === USER);
await shot("happy-step1-connected");

// ---------- velar-down: unavailable, never 0 ----------
await open("velar-down");
await invariants("velar-down step 1", 1);
await connectLeather();
await quoteReady();
check("velar-down: Velar listed as unavailable", (await kv("Pools read")).includes("velar-univ2-70 unavailable"));
check("velar-down: no zero for Velar anywhere", !/velar-univ2-70 0 STX/.test(await body()));
check("velar-down: reader explains unavailable is not zero", (await text(".panel .status.info")).includes("velar-univ2-70 is unavailable, not zero"));
check("velar-down: XYK wins", (await kv("Pool used")) === "bitflow-xyk (pool id 1)" && (await kv("Quote")) === "15.12892 STX (15,128,920 uSTX)");
check("velar-down: Continue still enabled", !(await primary().isDisabled()));
await invariants("velar-down step 2", 2);
await shot("velar-down-step2-amount");

// ---------- no-relay ----------
await open("no-relay");
await connectLeather();
await quoteReady();
check("no-relay: error names the missing relay", (await text(".status.err")).includes("No relay is reachable"));
check("no-relay: relay minimum unknown in tier hint", (await text(".tiers + .hint")).includes("no relay reachable"));
check("no-relay: Continue disabled", await primary().isDisabled());
check("no-relay: reader line counts 0 reachable", (await text(".readerline.stamp")).includes("0 reachable"));
await invariants("no-relay step 2", 2);
await shot("no-relay-step2-amount");

// ---------- min-out-below-tier ----------
await open("min-out-below-tier");
await connectLeather();
await quoteReady();
check("min-out-below-tier: tier defaults to the relay minimum mid", (await text(".tier.sel .tname")) === "mid");
check("min-out-below-tier: low tier disabled as below the relay minimum", (await page.locator(".tier.off").count()) === 1 && (await text(".tier.off .tmin")) === "below relay minimum");
check("min-out-below-tier: inline MIN_OUT_BELOW_TIER error with the SDK message", (await text(".status.err")).includes("Min-out below tier") && (await text(".status.err")).includes("below the mid network fee of 100000 uSTX: raise the amount, lower the tier, or lower the slippage"));
check("min-out-below-tier: Continue disabled", await primary().isDisabled());
await invariants("min-out-below-tier step 2", 2);
await shot("min-out-below-tier-step2-amount");
await page.fill(".unit-row input", "5000");
check("min-out-below-tier: raising the amount clears the error", (await page.locator(".status.err").count()) === 0 && !(await primary().isDisabled()));

// ---------- tx-abort-1020: explanation and retry with 2 percent ----------
await open("tx-abort-1020");
await connectLeather();
await quoteReady();
await primary().click();
await page.waitForFunction(() => document.querySelector(".rail-tab .name")?.textContent === "Sign and sponsor");
await primary().click();
await page.waitForFunction(() => document.querySelector(".panel .badge")?.textContent === "abort_by_response", null, { timeout: 15000 });
check("abort: status badge shows the abort", (await text(".panel .badge")) === "abort_by_response");
check("abort: explainTxFailure text for u1020", (await text(".status.err")).includes("Bitflow XYK: output below minimum (price moved).") && (await text(".status.err")).includes("Re-quote and retry with 2 or 5 percent slippage."));
check("abort: raw result and who paid", (await text(".status.err")).includes("(err u1020)") && (await text(".status.err")).includes("The sponsor paid the network fee; you paid nothing."));
check("abort: no STX received row", (await kv("STX received")) === null);
check("abort: retry buttons for 2 and 5 percent", (await page.locator(".foot .btn", { hasText: "Retry With 2 Percent Slippage" }).count()) === 1 && (await page.locator(".foot .btn", { hasText: "Retry With 5 Percent Slippage" }).count()) === 1);
await invariants("tx-abort step 4", 4);
await shot("tx-abort-1020-step4-abort");
await page.click(".foot .btn-primary");
await page.waitForFunction(() => document.querySelector(".rail-tab .name")?.textContent === "Swap amount");
await quoteReady();
check("retry: back on step 2 with slippage preset to 2", (await page.inputValue(".slip-in")) === "2" && (await kv("Min-out")) === "14.852002 STX (14,852,002 uSTX)");
check("retry: txid left the URL, steps 3 and 4 locked", !page.url().includes("txid=") && JSON.stringify(await railStates()) === JSON.stringify(["complete", "tab", "locked", "locked"]));
await shot("tx-abort-1020-step2-retry");

// ---------- tx-success: immediate success ----------
await open("tx-success");
await connectLeather();
await quoteReady();
await primary().click();
await page.waitForFunction(() => document.querySelector(".rail-tab .name")?.textContent === "Sign and sponsor");
await primary().click();
await page.waitForFunction(() => document.querySelector(".panel .badge")?.textContent === "success", null, { timeout: 15000 });
check("tx-success: success on the first poll", (await kv("STX received")) === "15.155105 STX (15,155,105 uSTX)" && (await kv("Mined in Stacks block")) === "8,923,980");
check("tx-success: Swap Again offered", (await primary().textContent()).trim() === "Swap Again");
await invariants("tx-success step 4", 4);
await shot("tx-success-step4-success");

// ---------- ?txid= reload lands on step 4 ----------
await page.goto(`${BASE}/?chain=mainnet&txid=${TXID}&fixture=tx-success`);
await page.waitForSelector(".rail-tab");
check("?txid= reload lands on step 4 with 1 to 3 complete", (await text(".rail-tab .name")) === "Done" && JSON.stringify(await railStates()) === JSON.stringify(["complete", "complete", "complete", "tab"]));
check("?txid= reload keeps the txid in the URL", page.url().includes(`txid=${TXID}`));
await page.click(".rail-item.complete >> nth=2");
check("step 3 after reload explains the missing details", (await text(".panel")).includes("signing details are not kept after a reload"));
await shot("reload-step3-from-url");

// ---------- header connect path and the wallet selector modal ----------
await open("happy");
await page.evaluate(() => { window.wbip_providers = [{ id: "XverseProviders.BitcoinProvider", name: "Xverse Wallet" }, { id: "LeatherProvider", name: "Leather" }]; });
await page.click(".hdr .wallet-menu button");
await page.waitForSelector(".modal .pick");
check("two wallets installed: selector modal offers both", (await page.locator(".modal .pick button").count()) === 2);
check("Xverse is offered untested, not blocked", (await page.locator(".modal .pick button", { hasText: "Xverse" }).count()) === 1 && (await page.locator(".modal .pick button", { hasText: "Xverse" }).locator(".b-warn").count()) === 1);
check("modal states the relay refusal rule", (await text(".modal p")).includes("relay refuses any transaction lacking the exact post-conditions"));
check("no em dash in the modal", await noEmDash());
await shot("wallet-selector-modal");
await page.click(".modal .row button");
check("modal dismissed", (await page.locator(".modal").count()) === 0);

// ---------- reset ----------
await page.click(".reset-btn");
check("reset popover explains nothing is stored", (await text(".reset-pop")).includes("Nothing is stored"));
await page.click(".reset-pop .btn-secondary");
check("cancel closes the popover", (await page.locator(".reset-pop").count()) === 0);

// ---------- disclaimer page ----------
await page.goto(`${BASE}/disclaimer.html`);
await page.waitForSelector(".legal-card");
const legal = await body();
check("disclaimer: title", (await page.title()).startsWith("Disclaimer"));
check("disclaimer: as is, without warranty of any kind", legal.includes("provided as is") && legal.includes("without warranty of any kind"));
check("disclaimer: no guarantee of sponsorship, execution, price, availability or fitness", legal.includes("guarantee of sponsorship, execution, price, availability, or fitness"));
check("disclaimer: responsibility rests with the user or integrator", legal.includes("rests with the user or the integrator"));
check("disclaimer: relay may refuse any transaction for any reason", legal.includes("refuse any transaction for any reason"));
check("disclaimer: immutable contract, no reversal", legal.includes("cannot be changed") && legal.includes("cannot reverse it"));
check("disclaimer: New Jersey law and courts", legal.includes("State of New Jersey") && legal.includes("courts located in New Jersey"));
check("disclaimer: not legal advice", legal.includes("is legal, financial, investment, or tax advice"));
check("disclaimer: counsel note is an HTML comment, not visible copy", !legal.includes("Counsel review") && readFileSync(join(DIST, "disclaimer.html"), "utf8").includes("<!-- Counsel review"));
check("disclaimer: styled with tokens", await page.evaluate(() => getComputedStyle(document.querySelector(".legal-card")).borderRadius === "12px"));
check("disclaimer: links back to the app", (await page.getAttribute(".legal-foot a >> nth=1", "href")) === "./index.html");
check("disclaimer: no em dash", await noEmDash());
await shot("disclaimer");

// ---------- global invariants ----------
check("zero external requests in fixture mode", externalRequests.length === 0, externalRequests.slice(0, 3).join(", "));
check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
check("localStorage empty at the end", (await localStorageLen()) === 0);

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail && !SHOTS_ONLY ? 1 : 0);
