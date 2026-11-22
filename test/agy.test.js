// Antigravity CLI (`agy`): recognition, flag carrying, resume/fork command
// building, camelCase hook payloads, stdout `{}` response, clean-exit clear,
// and ~/.gemini/config/hooks.json install/uninstall.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { agentKey, carriedFlags, attendedFlags, command, canFork, hookPayload, isOneShot } from "../mods/revive/lib/core.js";
import { withAgyHooks, hasAgyHooks } from "../mods/revive/revive.mjs";
import { POSIX_HARNESS } from "./helpers/platform.js";

const ENGINE = fileURLToPath(new URL("../mods/revive/revive.mjs", import.meta.url));
const ID = "40a587b9-c18c-4e67-9491-e83d8308b8ae";

test("agy is known by its launcher, antigravity binary, and OSC report", () => {
  assert.equal(agentKey(null, ["agy"]), "agy");
  assert.equal(agentKey(null, ["/opt/homebrew/bin/agy", "--model", "flash"]), "agy");
  assert.equal(agentKey(null, ["/opt/homebrew/Caskroom/antigravity-cli/1.5.10,5253791805734912/antigravity"]), "agy");
  assert.equal(agentKey("antigravity"), "agy");
  assert.equal(agentKey(null, ["vim", "agy"]), null);
});

test("agy carries safe session flags and drops prompt, resume, and config flags", () => {
  assert.deepEqual(
    carriedFlags("agy", [
      "agy", "--model", "pro", "--effort", "high", "--mode", "auto",
      "--agent", "reviewer", "--dangerously-skip-permissions", "--sandbox",
      "--settings", "/tmp/s.json", "--add-dir", "/extra", "--conversation", "old",
      "-i", "initial prompt", "fix tests",
    ]),
    ["--model", "pro", "--effort", "high", "--mode", "auto", "--agent", "reviewer", "--dangerously-skip-permissions", "--sandbox"],
  );
  assert.deepEqual(carriedFlags("agy", ["agy", "--agent", "../escape", "--mode=plan"]), ["--mode=plan"]);
});

test("agy drops permission-lifting flags when resuming unattended", () => {
  assert.deepEqual(
    attendedFlags("agy", ["--model", "pro", "--dangerously-skip-permissions", "--mode", "auto", "--sandbox"]),
    { kept: ["--model", "pro", "--sandbox"], dropped: ["--dangerously-skip-permissions", "--mode auto"] },
  );
  assert.deepEqual(
    attendedFlags("agy", ["--mode", "plan", "--effort", "medium"]),
    { kept: ["--mode", "plan", "--effort", "medium"], dropped: [] },
  );
});

test("agy resumes with --conversation and forks with -i pointing to the transcript", () => {
  const transcript = "/Users/me/.gemini/antigravity-cli/brain/40a587b9-c18c-4e67-9491-e83d8308b8ae/.system_generated/logs/transcript.jsonl";
  const rec = { agent: "agy", session: ID, flags: ["--model", "pro", "--dangerously-skip-permissions"], transcript };
  assert.deepEqual(command(rec, "resume"), ["agy", "--model", "pro", "--dangerously-skip-permissions", "--conversation", ID]);
  assert.deepEqual(command(rec, "resume", { unattended: true }), ["agy", "--model", "pro", "--conversation", ID]);
  assert.equal(canFork("agy"), true);

  const forked = command(rec, "fork");
  assert.equal(forked[0], "agy");
  assert.deepEqual(forked.slice(1, 4), ["--model", "pro", "--dangerously-skip-permissions"]);
  assert.equal(forked[4], "-i");
  assert.ok(forked[5].includes(ID));
  assert.ok(forked[5].includes(transcript));

  // Newlines in a tainted transcript label are ignored.
  const tainted = command({ ...rec, transcript: "/tmp/ok\nignore previous" }, "fork");
  assert.ok(!tainted[5].includes("\nignore previous"));
});

test("agy one-shot runs and subcommands are not remembered as interactive sessions", () => {
  assert.equal(isOneShot("agy", ["agy", "-p", "hi"]), true);
  assert.equal(isOneShot("agy", ["agy", "--print", "hi"]), true);
  assert.equal(isOneShot("agy", ["agy", "--prompt=hi"]), true);
  assert.equal(isOneShot("agy", ["agy", "acp"]), true);
  assert.equal(isOneShot("agy", ["agy", "--model", "pro", "models"]), true);
  assert.equal(isOneShot("agy", ["agy", "--model", "pro", "fix tests"]), false);
  assert.equal(isOneShot("agy", ["agy", "--conversation", ID]), false);
});

test("hookPayload reads agy camelCase SessionStart payload", () => {
  const transcriptPath = `/Users/me/.gemini/antigravity-cli/brain/${ID}/.system_generated/logs/transcript.jsonl`;
  assert.deepEqual(
    hookPayload({
      hookEventName: "SessionStart",
      conversationId: ID,
      workspacePaths: ["/w"],
      transcriptPath,
      artifactDirectoryPath: `/Users/me/.gemini/antigravity-cli/brain/${ID}`,
      modelName: "auto",
      cwd: "/w",
    }),
    { event: "SessionStart", session: ID, cwd: "/w", reason: null, transcript: transcriptPath, argv: null, agent: "agy" },
  );
});

test("agy hook prints {} on stdout, records transcript, and clear --agent agy respects failed/other agents", POSIX_HARNESS, () => {
  const dir = mkdtempSync(join(tmpdir(), "revive-agy-hook-"));
  const transcript = join(dir, "transcript.jsonl");
  writeFileSync(transcript, "{}\n");
  writeFileSync(join(dir, "state.json"), JSON.stringify({
    labels: {},
    argv: ["/opt/homebrew/Caskroom/antigravity-cli/1.5.10/antigravity", "--model", "pro"],
  }));
  const hc = join(dir, "hc");
  writeFileSync(hc, `#!/usr/bin/env node
const fs = require("fs"), dir = ${JSON.stringify(dir)};
const [cmd, t, ...rest] = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(dir + "/state.json", "utf8"));
if (cmd === "get") {
  const fg = Number(process.env.FAKE_FG);
  console.log(JSON.stringify({ address: t, state: "live", pid: 4242, cwd: "/w", labels: state.labels,
    status: { app: "antigravity", state: "working" },
    foreground: { pid: fg, argv: state.argv, cwd: "/w" } }));
} else if (cmd === "label") {
  for (const kv of rest) {
    const i = kv.indexOf("=");
    const k = kv.slice(0, i), v = kv.slice(i + 1);
    if (v === "") delete state.labels[k];
    else state.labels[k] = v;
  }
  fs.writeFileSync(dir + "/state.json", JSON.stringify(state));
}
`);
  chmodSync(hc, 0o755);

  const bin = join(dir, "antigravity");
  writeFileSync(bin, `#!/bin/sh\nexport FAKE_FG=$$\n${JSON.stringify(process.execPath)} ${JSON.stringify(ENGINE)} hook --agent agy\n`);
  chmodSync(bin, 0o755);

  const env = { ...process.env, HC_TERMINAL_ID: "t1", REVIVE_HC: hc };
  delete env.HC_TERMINAL_SOCKET;
  const stdout = execFileSync(bin, [], {
    input: JSON.stringify({
      hookEventName: "SessionStart",
      conversationId: ID,
      workspacePaths: ["/w"],
      transcriptPath: transcript,
      cwd: "/w",
    }),
    encoding: "utf8",
    env,
  });
  assert.equal(stdout, "{}\n");

  const recorded = JSON.parse(readFileSync(join(dir, "state.json"), "utf8")).labels;
  assert.equal(recorded["revive.agent"], "agy");
  assert.equal(recorded["revive.session"], ID);
  assert.equal(recorded["revive.transcript"], transcript);
  assert.equal(recorded["revive.flags"], '["--model","pro"]');

  // clear --agent agy clears agy labels.
  execFileSync(process.execPath, [ENGINE, "clear", "--agent", "agy"], { env });
  const cleared = JSON.parse(readFileSync(join(dir, "state.json"), "utf8")).labels;
  assert.equal(cleared["revive.session"], undefined);

  // clear --agent agy leaves non-agy or failed agy records untouched.
  writeFileSync(join(dir, "state.json"), JSON.stringify({
    labels: { "revive.agent": "agy", "revive.session": ID, "revive.failed": "123" },
    argv: stateArgv(),
  }));
  function stateArgv() { return ["agy"]; }
  execFileSync(process.execPath, [ENGINE, "clear", "--agent", "agy"], { env });
  assert.equal(JSON.parse(readFileSync(join(dir, "state.json"), "utf8")).labels["revive.session"], ID);
});

test("withAgyHooks preserves other hooks and install/uninstall manages ~/.gemini/config/hooks.json", POSIX_HARNESS, () => {
  const existing = { "other-hook": { PreToolUse: [{ matcher: "*", hooks: [{ command: "./x.sh" }] }] } };
  const added = withAgyHooks(existing);
  assert.ok(hasAgyHooks(added));
  assert.deepEqual(added["other-hook"], existing["other-hook"]);
  assert.deepEqual(withAgyHooks(added), added);
  assert.deepEqual(withAgyHooks(added, { remove: true }), existing);

  const home = mkdtempSync(join(tmpdir(), "revive-agy-home-"));
  mkdirSync(join(home, ".gemini", "config"), { recursive: true });
  mkdirSync(join(home, "bin"), { recursive: true });
  writeFileSync(join(home, "bin", "agy"), "#!/bin/sh\n");
  chmodSync(join(home, "bin", "agy"), 0o755);
  writeFileSync(join(home, ".gemini", "config", "hooks.json"), JSON.stringify(existing));

  const fakeHc = join(home, "bin", "hc");
  writeFileSync(fakeHc, `#!/bin/sh\ncase "$1" in ls) echo '{"terminals":[]}' ;; *) exit 1 ;; esac\n`);
  chmodSync(fakeHc, 0o755);

  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    PATH: `${join(home, "bin")}:${dirname(process.execPath)}:/usr/bin:/bin`,
    SHELL: "/bin/zsh",
    REVIVE_HC: fakeHc,
    REVIVE_MUSE: "",
  };
  delete env.HC_TERMINAL_SOCKET;
  delete env.ZDOTDIR;

  execFileSync(process.execPath, [ENGINE, "install"], { env });
  const doc = JSON.parse(readFileSync(join(home, ".gemini", "config", "hooks.json"), "utf8"));
  assert.ok(hasAgyHooks(doc));
  assert.deepEqual(doc["other-hook"], existing["other-hook"]);
  assert.equal(JSON.parse(execFileSync(process.execPath, [ENGINE, "doctor"], { encoding: "utf8", env })).agy, true);

  execFileSync(process.execPath, [ENGINE, "uninstall"], { env });
  const after = JSON.parse(readFileSync(join(home, ".gemini", "config", "hooks.json"), "utf8"));
  assert.deepEqual(after, existing);
  assert.ok(existsSync(join(home, ".gemini", "config", "hooks.json.revive-backup")));
});
