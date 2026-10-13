// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
// @ts-expect-error Native Node deployment CLI is outside extension TypeScript.
import * as deployment from "../scripts/deploy-ec2.mjs";
const { validateDeployment, makeCommand, deploy } = deployment;
const env = {
  AWS_REGION: "us-east-1",
  EC2_INSTANCE_ID: "i-0123456789abcdef0",
  GIT_SHA: "a".repeat(40),
  IMAGE_URI: `123456789012.dkr.ecr.us-east-1.amazonaws.com/bugger/backend@sha256:${"b".repeat(64)}`,
};
const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const script = readFileSync("deploy/deploy-backend.sh", "utf8");
function mockRun(...results: unknown[]) {
  const queue = [...results];
  return vi.fn(async () => {
    if (!queue.length) throw new Error("Unexpected AWS command");
    const value = queue.shift();
    if (value instanceof Error) throw value;
    return { stdout: JSON.stringify(value), stderr: "" };
  });
}
async function run(mock: ReturnType<typeof mockRun>, extra = {}) {
  return deploy({
    env,
    script,
    run: mock,
    sleep: vi.fn(async () => {}),
    ...extra,
  });
}
describe("EC2 deployment controller", () => {
  it("accepts one bounded EC2 target and immutable same-region image", () => {
    expect(validateDeployment(env)).toMatchObject({
      instanceId: env.EC2_INSTANCE_ID,
      image: env.IMAGE_URI,
    });
  });
  it.each([
    { AWS_REGION: "us-east-1;id" },
    { EC2_INSTANCE_ID: "i-123;cat /etc/passwd" },
    { GIT_SHA: "$(touch /tmp/unsafe)" },
    { IMAGE_URI: "example.com/bugger:latest" },
    { IMAGE_URI: env.IMAGE_URI.replace("us-east-1", "eu-west-1") },
    { IMAGE_URI: env.IMAGE_URI.replace("bugger/backend", "bugger/../other") },
  ])("rejects invalid coordinates before AWS %j", async (change) => {
    const mock = mockRun();
    await expect(run(mock, { env: { ...env, ...change } })).rejects.toThrow();
    expect(mock).not.toHaveBeenCalled();
  });
  it("encodes reviewed script bytes rather than interpolating script into shell", () => {
    const command = makeCommand(validateDeployment(env), script);
    expect(command).toContain(Buffer.from(script).toString("base64"));
    expect(command).not.toContain("$(");
    expect(command).toContain(`'${env.IMAGE_URI}'`);
  });
  it("submits execFile AWS arguments and waits for explicit success", async () => {
    const mock = mockRun(
      { Command: { CommandId: id } },
      { Status: "Pending" },
      { Status: "InProgress" },
      { Status: "Success", ResponseCode: 0 },
    );
    expect(await run(mock)).toEqual({
      commandId: id,
      revision: env.GIT_SHA,
      state: "DEPLOYED",
    });
    const calls = mock.mock.calls as unknown as [string, string[], object][];
    expect(calls[0]![0]).toBe("aws");
    const args = calls[0]![1],
      body = JSON.parse(args[args.indexOf("--cli-input-json") + 1]!);
    expect(body.DocumentName).toBe("AWS-RunShellScript");
    expect(body.InstanceIds).toEqual([env.EC2_INSTANCE_ID]);
    expect(body.Parameters.executionTimeout).toEqual(["900"]);
    expect(calls[0]![2]).toMatchObject({ timeout: 30000 });
  });
  it("tolerates eventual invocation discovery", async () => {
    const eventual = Object.assign(new Error("hidden"), {
      stderr: "InvocationDoesNotExist",
    });
    const mock = mockRun(
      { Command: { CommandId: id } },
      eventual,
      { Status: "Delayed" },
      { Status: "Success", ResponseCode: 0 },
    );
    expect(await run(mock)).toMatchObject({ state: "DEPLOYED" });
  });
  it.each([
    "Failed",
    "Cancelled",
    "TimedOut",
    "Cancelling",
    "Unknown",
    undefined,
  ])(
    "rejects terminal/unknown status %s without printing outputs",
    async (Status) => {
      const mock = mockRun(
        { Command: { CommandId: id } },
        {
          Status,
          ResponseCode: 1,
          StandardOutputContent: "SECRET",
          StandardErrorContent: "PASSWORD",
        },
      );
      await expect(run(mock)).rejects.toThrow("did not succeed");
    },
  );
  it("requires zero response code even for Success", async () => {
    await expect(
      run(
        mockRun(
          { Command: { CommandId: id } },
          { Status: "Success", ResponseCode: 1 },
        ),
      ),
    ).rejects.toThrow("did not succeed");
  });
  it("limits polling and never repeats SendCommand", async () => {
    const mock = mockRun(
      { Command: { CommandId: id } },
      { Status: "InProgress" },
    );
    await expect(run(mock, { maxPolls: 1 })).rejects.toThrow(
      "may still be running",
    );
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it("sanitizes AWS failures and rejects invalid command IDs", async () => {
    await expect(run(mockRun(new Error("PRIVATE_CREDENTIAL")))).rejects.toThrow(
      "AWS command failed",
    );
    await expect(
      run(mockRun({ Command: { CommandId: "bad-id" } })),
    ).rejects.toThrow("valid command ID");
  });
  it("validates deployment bash syntax and fail-safe runtime options", () => {
    execFileSync("bash", ["-n", "deploy/deploy-backend.sh"]);
    for (const flag of [
      "flock -n",
      "--read-only",
      "--cap-drop ALL",
      "--user 1000:1000",
      "npm run migrate",
      "healthy 3001",
      "healthy 3000",
      "bugger-backend-previous",
      "127.0.0.1:3000:3000",
    ]) {
      expect(script).toContain(flag);
    }
    expect(script).not.toMatch(/source\s+\"?\$ENV_FILE/);
  });
});

import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// Sandbox the remote host paths/privilege precondition and replace external
// executables. The rollout/cleanup state machine itself is executed unchanged.
it.each(["success", "candidate_fail", "production_fail"])(
  "remote shell rollout handles %s with mock Docker",
  (scenario) => {
    const root = mkdtempSync(join(tmpdir(), "bugger-deploy-test-")),
      bin = join(root, "bin"),
      state = join(root, "state"),
      config = join(root, "config");
    mkdirSync(bin);
    mkdirSync(state);
    mkdirSync(config);
    writeFileSync(join(config, "backend.env"), "TEST_ONLY=true\n");
    writeFileSync(join(config, "signing-private.pem"), "test-only\n");
    writeFileSync(join(state, "bugger-backend"), "previous");
    function executable(name: string, contents: string) {
      const file = join(bin, name);
      writeFileSync(file, "#!/usr/bin/env bash\nset -eu\n" + contents);
      chmodSync(file, 0o755);
    }
    executable(
      "stat",
      `case "$*" in *backend.env*) echo '0:600';; *) echo '0:1000:640';; esac\n`,
    );
    executable("flock", "exit 0\n");
    executable("sleep", "exit 0\n");
    executable("timeout", 'shift; exec "$@"\n');
    executable("aws", "echo test-only-password\n");
    executable(
      "docker",
      `
printf '%s\\n' "$*" >> "$MOCK_STATE/calls"
case "$1" in
 login) cat >/dev/null ;;
 pull) : ;;
 container) test -f "$MOCK_STATE/$3" ;;
 rm) shift; for name in "$@"; do [[ "$name" == -* ]] || rm -f "$MOCK_STATE/$name"; done ;;
 rename) mv "$MOCK_STATE/$2" "$MOCK_STATE/$3" ;;
 stop) : ;;
 start) touch "$MOCK_STATE/restored" ;;
 run) name=''; while (($#)); do if [[ "$1" == '--name' ]]; then shift; name=$1; break; fi; shift; done; [[ -z "$name" ]] || touch "$MOCK_STATE/$name" ;;
 *) exit 1 ;;
esac
`,
    );
    executable(
      "curl",
      `
url="\${!#}"
if [[ "$MOCK_SCENARIO" == candidate_fail && "$url" == *:3001/* ]]; then exit 22; fi
if [[ "$MOCK_SCENARIO" == production_fail && "$url" == *:3000/* && ! -f "$MOCK_STATE/restored" ]]; then exit 22; fi
if [[ "$url" == */version ]]; then printf '{"revision":"%s"}' "$MOCK_REVISION"; else echo '{"ok":true}'; fi
`,
    );
    const sandboxed = script
      .replace("[[ $EUID -eq 0 ]]", "true")
      .replaceAll("/etc/bugger", config)
      .replace("/var/lock/bugger-deploy.lock", join(root, "deploy.lock"))
      .replace("/run/bugger-docker.XXXXXX", join(root, "docker.XXXXXX"));
    const file = join(root, "deploy.sh");
    writeFileSync(file, sandboxed);
    try {
      const result = spawnSync(
        "bash",
        [file, env.IMAGE_URI, env.GIT_SHA, env.AWS_REGION],
        {
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            MOCK_STATE: state,
            MOCK_SCENARIO: scenario,
            MOCK_REVISION: env.GIT_SHA,
          },
          encoding: "utf8",
          timeout: 10000,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(scenario === "success" ? 0 : 1);
      expect(existsSync(join(state, "bugger-backend"))).toBe(true);
      expect(existsSync(join(state, "bugger-backend-candidate"))).toBe(false);
      const calls = readFileSync(join(state, "calls"), "utf8");
      if (scenario === "candidate_fail")
        expect(calls).not.toContain("rename bugger-backend");
      if (scenario === "production_fail") {
        expect(calls).toContain(
          "rename bugger-backend-previous bugger-backend",
        );
        expect(existsSync(join(state, "restored"))).toBe(true);
      }
      if (scenario === "success")
        expect(existsSync(join(state, "bugger-backend-previous"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
