/* Merge only the POS payment fragment into the current shared Firestore rules.
 * node scripts/payment-rules.cjs --project jw-system-f2104 [--deploy]
 * A no-deploy run compiles the merged ruleset but never changes the release.
 */
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const cliRequire = createRequire(path.join(path.dirname(process.execPath), "payment-rules.cjs"));
const { configstore } = cliRequire("firebase-tools/lib/configstore");
const { getAccessToken } = cliRequire("firebase-tools/lib/auth");

(async () => {
  const args = process.argv.slice(2);
  const projectIndex = args.indexOf("--project");
  const project = args[projectIndex + 1];
  if (projectIndex < 0 || !/^[a-z][a-z0-9-]+$/.test(project || "")) throw new Error("Supply --project PROJECT_ID explicitly.");
  const token = (await getAccessToken(configstore.get("tokens").refresh_token, ["https://www.googleapis.com/auth/cloud-platform"])).access_token;
  const base = `https://firebaserules.googleapis.com/v1/projects/${project}`;
  async function api(url, method = "GET", body) {
    const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    return response.json();
  }
  const release = await api(`${base}/releases/cloud.firestore`);
  const current = await api(`https://firebaserules.googleapis.com/v1/${release.rulesetName}`);
  const files = current.source.files.map((file) => ({ ...file }));
  const main = files.find((file) => file.content.includes("service cloud.firestore"));
  if (!main) throw new Error("Cannot identify the live shared Firestore rules.");
  const fragment = fs.readFileSync(path.join(__dirname, "../firestore.payment-status.rules"), "utf8");
  const blockPattern = /    \/\/ BEGIN POS PAYMENT REALTIME[\s\S]*?    \/\/ END POS PAYMENT REALTIME\r?\n?/;
  if (blockPattern.test(main.content)) main.content = main.content.replace(blockPattern, fragment);
  else {
    if (/match\s+\/pos_payment_(status|checks)\//.test(main.content)) throw new Error("Collection already has unrecognized shared rules. Review before merging.");
    const match = /match\s+\/databases\/\{database\}\/documents\s*\{/.exec(main.content);
    if (!match) throw new Error("Cannot identify the shared database match.");
    const offset = match.index + match[0].length;
    main.content = main.content.slice(0, offset) + "\n" + fragment + main.content.slice(offset);
  }
  const backupDir = path.join(__dirname, "../.firebase/payment-rules");
  fs.mkdirSync(backupDir, { recursive: true });
  fs.writeFileSync(path.join(backupDir, `backup-${Date.now()}.json`), JSON.stringify({ release, source: current.source }, null, 2));
  fs.writeFileSync(path.join(backupDir, "merged.rules"), main.content);
  const compiled = await api(`${base}/rulesets`, "POST", { source: { files } });
  console.log(`Compiled merged shared rules: ${compiled.name}`);
  if (!args.includes("--deploy")) return;
  const latest = await api(`${base}/releases/cloud.firestore`);
  if (latest.rulesetName !== release.rulesetName) throw new Error("Shared rules changed during validation. Re-run against the latest release.");
  const deployed = await api(`${base}/releases/cloud.firestore?updateMask=rulesetName`, "PATCH", { release: { name: release.name, rulesetName: compiled.name } });
  console.log(`Updated shared release: ${deployed.rulesetName}`);
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
