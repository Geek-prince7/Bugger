#!/usr/bin/env bash
# Executed as root by SSM. Inputs are also validated by scripts/deploy-ec2.mjs.
set -Eeuo pipefail
umask 077
IMAGE_URI=${1:-}
REVISION=${2:-}
AWS_REGION=${3:-}
[[ $EUID -eq 0 ]] || { echo 'Deployment requires root.' >&2; exit 1; }
[[ $AWS_REGION =~ ^[a-z]{2}-[a-z]+-[0-9]+$ ]] || exit 1
[[ $REVISION =~ ^[a-f0-9]{40}$ ]] || exit 1
[[ $IMAGE_URI =~ ^[0-9]{12}\.dkr\.ecr\.[a-z]{2}-[a-z]+-[0-9]+\.amazonaws\.com/[a-z0-9][a-z0-9._/-]{0,127}@sha256:[a-f0-9]{64}$ ]] || exit 1
[[ $IMAGE_URI == *".ecr.${AWS_REGION}.amazonaws.com/"* ]] || exit 1
for program in docker aws curl python3 flock timeout; do command -v "$program" >/dev/null; done
exec 9>/var/lock/bugger-deploy.lock
flock -n 9 || { echo 'Another deployment is active.' >&2; exit 1; }
ENV_FILE=/etc/bugger/backend.env
KEY_FILE=/etc/bugger/signing-private.pem
[[ -f $ENV_FILE && ! -L $ENV_FILE && $(stat -c '%u:%a' "$ENV_FILE") == '0:600' ]] || { echo 'Expected root-owned mode-600 backend.env.' >&2; exit 1; }
[[ -f $KEY_FILE && ! -L $KEY_FILE && $(stat -c '%u:%g:%a' "$KEY_FILE") == '0:1000:640' ]] || { echo 'Expected root:1000 mode-640 signing key.' >&2; exit 1; }
# Deliberately never source backend.env or expose its contents to logs.
RUNTIME=(--user 1000:1000 --read-only --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 128 --memory 512m --cpus 1 --tmpfs /tmp:rw,noexec,nosuid,size=64m --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 --env-file "$ENV_FILE" -e PORT=3000 -e HOST=0.0.0.0 -e "GIT_SHA=$REVISION" -e SIGNING_KEY_FILE=/run/secrets/signing-private.pem --mount "type=bind,src=$KEY_FILE,dst=/run/secrets/signing-private.pem,readonly")
if [[ -f /etc/bugger/database-ca.pem ]]; then
  RUNTIME+=(--mount type=bind,src=/etc/bugger/database-ca.pem,dst=/run/secrets/database-ca.pem,readonly -e DATABASE_CA_FILE=/run/secrets/database-ca.pem)
fi
REGISTRY=${IMAGE_URI%%/*}
DOCKER_CONFIG=$(mktemp -d /run/bugger-docker.XXXXXX)
export DOCKER_CONFIG
switched=0
had_previous=0
completed=0
cleanup() {
  code=$?
  trap - EXIT INT TERM
  docker rm -f bugger-backend-candidate bugger-backend-migrate >/dev/null 2>&1 || true
  if [[ $completed -ne 1 && $switched -eq 1 ]]; then
    docker rm -f bugger-backend >/dev/null 2>&1 || true
    if [[ $had_previous -eq 1 ]]; then
      if docker rename bugger-backend-previous bugger-backend >/dev/null 2>&1 && docker start bugger-backend >/dev/null 2>&1; then
        rollback_ready=0
        for ((rollback_attempt=0; rollback_attempt<15; rollback_attempt++)); do
          if curl --fail --silent --max-time 3 http://127.0.0.1:3000/readyz >/dev/null; then rollback_ready=1; break; fi
          sleep 2
        done
        if [[ $rollback_ready -eq 1 ]]; then
          echo 'Previous backend restored and ready; investigate failed deployment in SSM.' >&2
        else
          echo 'ROLLBACK UNHEALTHY: previous container restarted but readiness failed.' >&2
        fi
      else
        echo 'ROLLBACK FAILED: inspect containers through SSM immediately.' >&2
      fi
    fi
  fi
  rm -rf "$DOCKER_CONFIG"
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null 2>&1
timeout 240 docker pull "$IMAGE_URI" >/dev/null 2>&1
# Only additive/backward-compatible migrations may be released through this path.
# Database migrations cannot be undone by a container rollback.
timeout 180 docker run --rm --name bugger-backend-migrate "${RUNTIME[@]}" "$IMAGE_URI" npm run migrate >/dev/null 2>&1
healthy() {
  port=$1
  for ((attempt=0; attempt<30; attempt++)); do
    if curl --fail --silent --max-time 3 "http://127.0.0.1:$port/readyz" >/dev/null && curl --fail --silent --max-time 3 "http://127.0.0.1:$port/version" | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("revision")==sys.argv[1] else 1)' "$REVISION" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}
docker rm -f bugger-backend-candidate >/dev/null 2>&1 || true
docker run -d --name bugger-backend-candidate "${RUNTIME[@]}" -p 127.0.0.1:3001:3000 "$IMAGE_URI" >/dev/null
healthy 3001 || { echo 'Candidate readiness or revision failed; current backend unchanged.' >&2; exit 1; }
docker rm -f bugger-backend-candidate >/dev/null
# Keep the stopped old container as the rollback target until a later successful deploy.
docker rm -f bugger-backend-previous >/dev/null 2>&1 || true
if docker container inspect bugger-backend >/dev/null 2>&1; then
  had_previous=1
  docker rename bugger-backend bugger-backend-previous >/dev/null
  switched=1
  docker stop --time 30 bugger-backend-previous >/dev/null
else
  switched=1
fi
docker run -d --name bugger-backend --restart unless-stopped "${RUNTIME[@]}" -p 127.0.0.1:3000:3000 "$IMAGE_URI" >/dev/null
healthy 3000 || { echo 'Production readiness or revision failed; rolling back.' >&2; exit 1; }
completed=1
echo "Backend deployment healthy at revision $REVISION."
