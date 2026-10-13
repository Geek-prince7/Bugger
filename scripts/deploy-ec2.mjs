import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const exec = promisify(execFile);
class DeployError extends Error {}
const fail = (message) => {
  throw new DeployError(message);
};
export function validateDeployment(env) {
  const region = env.AWS_REGION,
    instanceId = env.EC2_INSTANCE_ID,
    image = env.IMAGE_URI,
    revision = env.GIT_SHA;
  if (!/^[a-z]{2}-[a-z]+-\d+$/.test(region || "")) fail("Invalid AWS_REGION.");
  if (!/^i-(?:[a-f0-9]{8}|[a-f0-9]{17})$/.test(instanceId || ""))
    fail("Invalid EC2_INSTANCE_ID.");
  if (!/^[a-f0-9]{40}$/.test(revision || ""))
    fail("GIT_SHA must be a full 40-character commit revision.");
  const match =
    /^(\d{12})\.dkr\.ecr\.([a-z]{2}-[a-z]+-\d+)\.amazonaws\.com\/([a-z0-9][a-z0-9._/-]{0,127})@sha256:([a-f0-9]{64})$/.exec(
      image || "",
    );
  if (
    !match ||
    match[2] !== region ||
    match[3].includes("..") ||
    match[3].includes("//")
  )
    fail("IMAGE_URI must be an ECR digest in AWS_REGION.");
  return { region, instanceId, image, revision };
}
export function makeCommand(config, script) {
  if (
    typeof script !== "string" ||
    script.length > 24000 ||
    !script.startsWith("#!/usr/bin/env bash")
  )
    fail("Invalid deployment script.");
  const encoded = Buffer.from(script).toString("base64");
  // All positional values have passed strict validation; script bytes are base64 only.
  return `printf '%s' '${encoded}' | base64 --decode | bash -s -- '${config.image}' '${config.revision}' '${config.region}'`;
}
export async function deploy({
  env,
  script,
  run = exec,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  maxPolls = 180,
}) {
  const config = validateDeployment(env);
  if (!Number.isInteger(maxPolls) || maxPolls < 1 || maxPolls > 180)
    fail("Invalid polling bound.");
  const command = makeCommand(config, script);
  async function aws(args, eventual = false) {
    let output;
    try {
      output = await run(
        "aws",
        [
          ...args,
          "--region",
          config.region,
          "--output",
          "json",
          "--no-cli-pager",
        ],
        {
          timeout: 30000,
          maxBuffer: 1024 * 1024,
          env: { ...process.env, AWS_PAGER: "" },
        },
      );
    } catch (error) {
      if (eventual && String(error?.stderr).includes("InvocationDoesNotExist"))
        return null;
      fail(
        "AWS command failed or timed out. Check IAM, instance status and the SSM console; no remote output was logged.",
      );
    }
    try {
      return JSON.parse(output.stdout);
    } catch {
      fail("AWS returned invalid JSON. Check SSM before retrying.");
    }
  }
  const request = {
    DocumentName: "AWS-RunShellScript",
    InstanceIds: [config.instanceId],
    TimeoutSeconds: 60,
    Comment: `Bugger backend ${config.revision}`,
    Parameters: { commands: [command], executionTimeout: ["900"] },
  };
  const sent = await aws([
    "ssm",
    "send-command",
    "--cli-input-json",
    JSON.stringify(request),
  ]);
  const commandId = sent?.Command?.CommandId;
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(commandId || ""))
    fail("AWS returned no valid command ID. Inspect SSM before retrying.");
  for (let i = 0; i < maxPolls; i++) {
    await sleep(5000);
    const result = await aws(
      [
        "ssm",
        "get-command-invocation",
        "--command-id",
        commandId,
        "--instance-id",
        config.instanceId,
      ],
      true,
    );
    if (!result) continue;
    if (result.Status === "Success" && result.ResponseCode === 0)
      return { commandId, revision: config.revision, state: "DEPLOYED" };
    if (!["Pending", "InProgress", "Delayed"].includes(result.Status))
      fail(
        "SSM deployment did not succeed. Inspect its command and container state through SSM; remote output was suppressed.",
      );
  }
  fail(
    "SSM polling timed out. Deployment may still be running; inspect SSM before retrying.",
  );
}
export async function main(args = process.argv.slice(2), env = process.env) {
  const script = await readFile("deploy/deploy-backend.sh", "utf8");
  if (args[0] === "check") {
    if (args.length !== 1) fail("Usage: deploy-ec2.mjs check|deploy");
    console.log("Deployment script loaded; no AWS calls made.");
    return;
  }
  if (args.length !== 1 || args[0] !== "deploy")
    fail("Usage: deploy-ec2.mjs check|deploy");
  const result = await deploy({ env, script });
  console.log(
    `Backend ${result.revision}: ${result.state}; SSM command ${result.commandId}.`,
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(
      error instanceof DeployError
        ? error.message
        : "Deployment failed; inspect configuration and SSM. Sensitive output was not logged.",
    );
    process.exitCode = 1;
  });
