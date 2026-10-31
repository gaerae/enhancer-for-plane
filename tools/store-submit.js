#!/usr/bin/env node
// store-submit.js — sends a published GitHub Release to the Chrome Web Store. Run by
// .github/workflows/store.yml, which supplies the environment; AGENTS.md says why it works
// the way it does, and store-assets/STORE_LISTING.md holds the one-time setup.
//
// Stock node, like the rest of tools/, and it does the Google sign-in itself because the
// repo only allows GitHub-owned actions. Nothing here reads a stored credential: the run's
// GitHub identity is exchanged for a Google token that lasts as long as the run needs.

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const { execFileSync } = require("child_process");

const STORE = "https://chromewebstore.googleapis.com";
const STORE_SCOPE = "https://www.googleapis.com/auth/chromewebstore";
const LISTING_PATH = "store-assets";
const TOKEN_LIFETIME = "900s";
const POLL_MS = 5000;
const POLL_TRIES = 60;
// The upload page calls the state UPLOAD_IN_PROGRESS and the UploadState enum IN_PROGRESS.
const STILL_UPLOADING = new Set(["IN_PROGRESS", "UPLOAD_IN_PROGRESS"]);
// A rejected or withdrawn submission is not "at the store": that version can go again.
const WAITING_OR_LIVE = new Set(["PENDING_REVIEW", "STAGED", "PUBLISHED", "PUBLISHED_TO_TESTERS"]);
const REQUIRED = [
  "RELEASE_TAG",
  "GITHUB_REPOSITORY",
  "GITHUB_TOKEN",
  "ACTIONS_ID_TOKEN_REQUEST_URL",
  "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
  "GCP_WORKLOAD_PROVIDER",
  "GCP_SERVICE_ACCOUNT",
  "CWS_PUBLISHER_ID",
  "CWS_EXTENSION_ID"
];

async function call(io, what, url, init) {
  const resp = await io.fetch(url, init);
  const text = await resp.text();
  if (!resp.ok) {
    const err = new Error(`${what}: HTTP ${resp.status} ${text.replace(/\s+/g, " ").slice(0, 500)}`);
    err.status = resp.status;
    throw err;
  }
  return text ? JSON.parse(text) : {};
}

async function readRelease(env, io, version) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPOSITORY}/releases/tags/${env.RELEASE_TAG}`;
  let release;
  try {
    release = await call(io, "read the release", url, {
      headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json" }
    });
  } catch (e) {
    // This endpoint serves published releases only, so a draft lands here: that is what
    // keeps Run workflow from getting past the Publish click.
    if (e.status === 404) throw new Error(`no published release is tagged ${env.RELEASE_TAG}. A draft has no tag yet: Publish it first.`);
    throw e;
  }
  const name = `enhancer-for-plane-${version}.zip`;
  const asset = (release.assets || []).find((a) => a.name === name);
  if (!asset) throw new Error(`${env.RELEASE_TAG} has no ${name}.`);
  return asset;
}

async function accessToken(env, io) {
  const oidcUrl = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  oidcUrl.searchParams.set("audience", `https://iam.googleapis.com/${env.GCP_WORKLOAD_PROVIDER}`);
  const oidc = await call(io, "get the run's GitHub identity", oidcUrl.href, {
    headers: { Authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` }
  });
  const federated = await call(io, "exchange the GitHub identity at Google", "https://sts.googleapis.com/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audience: `//iam.googleapis.com/${env.GCP_WORKLOAD_PROVIDER}`,
      grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
      requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
      scope: "https://www.googleapis.com/auth/cloud-platform",
      subjectToken: oidc.value,
      subjectTokenType: "urn:ietf:params:oauth:token-type:jwt"
    })
  });
  const url = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${env.GCP_SERVICE_ACCOUNT}:generateAccessToken`;
  const issued = await call(io, "impersonate the store service account", url, {
    method: "POST",
    headers: { Authorization: `Bearer ${federated.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ scope: [STORE_SCOPE], lifetime: TOKEN_LIFETIME })
  });
  return issued.accessToken;
}

async function download(asset, io) {
  const resp = await io.fetch(asset.browser_download_url);
  if (!resp.ok) throw new Error(`download ${asset.name}: HTTP ${resp.status}`);
  const zip = Buffer.from(await resp.arrayBuffer());
  const digest = "sha256:" + crypto.createHash("sha256").update(zip).digest("hex");
  if (digest !== asset.digest) throw new Error(`${asset.name} does not match the release's digest (${digest}, expected ${asset.digest}).`);
  return zip;
}

const versionsOf = (revision) => ((revision && revision.distributionChannels) || []).map((c) => c.crxVersion);

// Which of the files behind the listing changed between two tags. null when git could not
// say: that has to stop a submission exactly as a real change would.
function listingChanges(from, to, cwd) {
  try {
    const out = execFileSync("git", ["diff", "--name-only", from, to, "--", LISTING_PATH], { cwd, encoding: "utf8", stdio: "pipe" });
    return out.split("\n").filter(Boolean);
  } catch {
    return null;
  }
}

function listingProblem(served, tag, io) {
  if (!served) return `there is no published version to compare ${LISTING_PATH} with`;
  const changed = io.listingChanges(`v${served}`, tag);
  if (!changed) return `${LISTING_PATH} could not be compared with ${served}`;
  return changed.length ? `${changed.join(", ")} changed since ${served}` : "";
}

async function upload(zip, item, headers, io) {
  const up = await call(io, "upload the package", `${STORE}/upload/v2/${item}:upload`, { method: "POST", headers, body: zip });
  let state = up.uploadState;
  for (let i = 0; STILL_UPLOADING.has(state) && i < POLL_TRIES; i++) {
    await io.sleep(POLL_MS);
    state = (await call(io, "poll the upload", `${STORE}/v2/${item}:fetchStatus`, { headers })).lastAsyncUploadState;
  }
  if (state !== "SUCCEEDED") throw new Error(`upload ended as ${state}: ${JSON.stringify(up).slice(0, 500)}`);
}

async function submit(env, io) {
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length) throw new Error(`not set: ${missing.join(", ")}. The setup is under Packaging in store-assets/STORE_LISTING.md.`);
  if (!/^v\d+\.\d+\.\d+$/.test(env.RELEASE_TAG)) throw new Error(`"${env.RELEASE_TAG}" is not a release tag, which reads v1.2.3.`);

  const version = env.RELEASE_TAG.slice(1);
  const asset = await readRelease(env, io, version);
  const headers = { Authorization: `Bearer ${await accessToken(env, io)}` };
  const item = `publishers/${env.CWS_PUBLISHER_ID}/items/${env.CWS_EXTENSION_ID}`;

  const status = await call(io, "read the store status", `${STORE}/v2/${item}:fetchStatus`, { headers });
  const published = versionsOf(status.publishedItemRevisionStatus);
  const submitted = status.submittedItemRevisionStatus;
  const isSubmitted = submitted && versionsOf(submitted).includes(version) && WAITING_OR_LIVE.has(submitted.state);
  if (published.includes(version) || isSubmitted) {
    return { submitted: false, message: `${version} is already at the store; nothing was sent.` };
  }
  if (submitted && submitted.state === "PENDING_REVIEW") {
    throw new Error(`${versionsOf(submitted).join(", ")} is still in review. Wait for it, or cancel it in the dashboard, then run Store again for ${env.RELEASE_TAG}.`);
  }

  await upload(await download(asset, io), item, headers, io);

  // The API cannot edit listing text, and an upload does not touch it. Submitting now would
  // send the review the old description and justifications, so this is where a person takes
  // over, and a red run is what tells them to.
  const problem = listingProblem(published[0], env.RELEASE_TAG, io);
  if (problem) {
    throw new Error(`${version} is uploaded but not submitted: ${problem}. Update the listing in the dashboard, then press Submit for review there.`);
  }

  const result = await call(io, "submit for review", `${STORE}/v2/${item}:publish`, { method: "POST", headers });
  const warnings = (result.warningInfo && result.warningInfo.warnings) || [];
  for (const w of warnings) io.warn(`${w.reason}: ${w.description}`);
  return { submitted: true, message: `${version} was submitted to the Chrome Web Store: ${result.state}.` };
}

if (require.main === module) {
  const report = (text) => {
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + "\n");
  };
  const io = {
    fetch,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    warn: (text) => console.log(`::warning::${text}`),
    listingChanges
  };
  submit(process.env, io).then(
    (done) => {
      console.log(done.message);
      report(done.message);
    },
    (e) => {
      console.log(`::error::${e.message}`);
      report(e.message);
      process.exitCode = 1;
    }
  );
}

module.exports = { submit, listingChanges };
