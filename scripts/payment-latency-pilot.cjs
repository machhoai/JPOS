/* Change only the per-device rollout flag, using an explicit device ID.
 * node scripts/payment-latency-pilot.cjs --project PROJECT --device DEVICE_ID --enable
 * Use --disable for rollback. Without either switch this only reads status.
 */
const path = require("node:path");
const { createRequire } = require("node:module");
const cliRequire = createRequire(path.join(path.dirname(process.execPath), "payment-latency-pilot.cjs"));
const { configstore } = cliRequire("firebase-tools/lib/configstore");
const { getAccessToken } = cliRequire("firebase-tools/lib/auth");

(async () => {
  const args = process.argv.slice(2);
  const value = (flag) => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
  const project = value("--project");
  const deviceId = value("--device");
  if (!/^[a-z][a-z0-9-]+$/.test(project || "") || !/^[A-Za-z0-9_-]+$/.test(deviceId || "")) throw new Error("Supply an explicit --project and --device ID.");
  if (args.includes("--enable") && args.includes("--disable")) throw new Error("Choose only one rollout action.");
  const token = (await getAccessToken(configstore.get("tokens").refresh_token, ["https://www.googleapis.com/auth/cloud-platform"])).access_token;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const url = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/pos_devices/${deviceId}`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Device lookup failed (${response.status}).`);
  const device = await response.json();
  if (device.fields?.status?.stringValue !== "ACTIVE" || device.fields?.is_deleted?.booleanValue === true) throw new Error("Only an active, non-deleted POS device can be configured.");
  let enabled = device.fields?.payment_latency_optimization_enabled?.booleanValue === true;
  if (args.includes("--enable") || args.includes("--disable")) {
    enabled = args.includes("--enable");
    const query = new URLSearchParams({ "updateMask.fieldPaths": "payment_latency_optimization_enabled", "currentDocument.updateTime": device.updateTime });
    const update = await fetch(`${url}?${query}`, {
      method: "PATCH", headers, body: JSON.stringify({ fields: { payment_latency_optimization_enabled: { booleanValue: enabled } } }),
    });
    if (!update.ok) throw new Error(`Device flag update failed (${update.status}); credentials and other fields were not changed.`);
  }
  console.log(JSON.stringify({ deviceId, warehouseId: device.fields?.warehouse_id?.stringValue, paymentLatencyOptimizationEnabled: enabled }));
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
