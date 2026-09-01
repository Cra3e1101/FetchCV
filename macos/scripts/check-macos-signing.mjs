import { spawnSync } from "node:child_process";
import fs from "node:fs";
import process from "node:process";

function command(program, args) {
  return spawnSync(program, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function present(...names) {
  return names.every((name) => Boolean(String(process.env[name] || "").trim()));
}

const strict = process.env.FETCHCV_REQUIRE_SIGNING === "1" || process.argv.includes("--strict");
const artifactIndex = process.argv.indexOf("--artifact");
const artifact = artifactIndex >= 0 ? process.argv[artifactIndex + 1] : "";
const identityResult = process.platform === "darwin"
  ? command("/usr/bin/security", ["find-identity", "-v", "-p", "codesigning"])
  : { status: 1, stdout: "" };
const installedDeveloperId = /Developer ID Application:/.test(identityResult.stdout || "");
const signingConfigured = present("CSC_LINK") || present("CSC_NAME") || installedDeveloperId;
const notarizationMethod = present("APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER")
  ? "app_store_connect_api_key"
  : present("APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID")
    ? "apple_id"
    : present("APPLE_KEYCHAIN", "APPLE_KEYCHAIN_PROFILE")
      ? "keychain_profile"
      : "missing";

const report = {
  platform: process.platform,
  signing: signingConfigured ? "ready" : "missing_developer_id",
  notarization: notarizationMethod === "missing" ? "missing_credentials" : "ready",
  notarization_method: notarizationMethod,
  artifact: artifact || null,
  verification: null,
};

if (artifact) {
  if (!fs.existsSync(artifact)) {
    report.verification = { ok: false, reason: "artifact_not_found" };
  } else if (process.platform !== "darwin") {
    report.verification = { ok: false, reason: "macos_required" };
  } else {
    const codesign = command("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", artifact]);
    const gatekeeper = command("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=2", artifact]);
    const stapler = command("/usr/bin/xcrun", ["stapler", "validate", artifact]);
    report.verification = {
      ok: codesign.status === 0 && gatekeeper.status === 0 && stapler.status === 0,
      codesign: codesign.status === 0 ? "valid" : "invalid",
      gatekeeper: gatekeeper.status === 0 ? "accepted" : "rejected",
      notarization_ticket: stapler.status === 0 ? "stapled" : "missing_or_invalid",
    };
  }
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
const ready = process.platform === "darwin" && signingConfigured && notarizationMethod !== "missing" && (!artifact || report.verification?.ok);
if (strict && !ready) process.exitCode = 1;
