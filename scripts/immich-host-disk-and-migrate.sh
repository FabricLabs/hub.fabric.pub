#!/usr/bin/env bash
# Run on the Immich host as root (copy via scp, then: sudo bash immich-host-disk-and-migrate.sh <step>)
# Steps: emergency-truncate | show-daemon-json | apply-log-limits | compose-down-hint | migrate-volumes-hint
#
# Before anything: add your user to the docker group (optional):
#   sudo usermod -aG docker YOURUSER && newgrp docker

set -euo pipefail

TARGET_BASE="${TARGET_BASE:-/media/storage/containers/immich}"
IMMICH_MATCH="${IMMICH_MATCH:-immich}"

die() { echo "ERROR: $*" >&2; exit 1; }

require_root() {
  [[ "$(id -u)" -eq 0 ]] || die "run as root: sudo bash $0 $*"
}

find_immich_cid() {
  docker ps -aq --filter "name=${IMMICH_MATCH}" 2>/dev/null | head -1 \
    || docker ps -aq --filter "ancestor=ghcr.io/immich-app/immich-server" 2>/dev/null | head -1 \
    || true
}

step_emergency_truncate() {
  require_root emergency-truncate
  mkdir -p /media/storage/containers 2>/dev/null || true
  local cid
  cid="$(find_immich_cid)"
  [[ -n "$cid" ]] || die "no container matching name ${IMMICH_MATCH} or immich-server image; set IMMICH_MATCH or start containers once"
  local logpath
  logpath="$(docker inspect --format '{{.LogPath}}' "$cid")"
  [[ -f "$logpath" ]] || die "log missing: $logpath"
  echo "Stopping container $cid (frees log handle; avoids corruption)..."
  docker stop "$cid"
  echo "Truncating $logpath"
  ls -lh "$logpath"
  truncate -s 0 "$logpath"
  ls -lh "$logpath"
  echo "Starting container $cid"
  docker start "$cid"
  echo "Done. df -h /"
  df -h /
}

step_show_daemon_json() {
  require_root show-daemon-json
  local f=/etc/docker/daemon.json
  if [[ -f "$f" ]]; then
    echo "=== Current $f ==="
    cat "$f"
  else
    echo "No $f (Docker defaults only)."
  fi
  echo
  echo "=== Recommended merge (edit by hand or merge with jq) ==="
  cat <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "50m",
    "max-file": "3"
  }
}
JSON
  echo
  echo "If $f already exists, merge these keys without duplicating \"log-driver\" / \"log-opts\"."
  echo "Then: systemctl restart docker  (briefly disrupts all containers)"
}

step_apply_log_limits() {
  require_root apply-log-limits
  local f=/etc/docker/daemon.json
  local bak="${f}.bak.$(date +%Y%m%d%H%M%S)"
  if [[ -f "$f" ]]; then
    cp -a "$f" "$bak"
    echo "Backed up to $bak"
  fi
  python3 <<'PY'
import json, os
path = "/etc/docker/daemon.json"
desired_log = {"log-driver": "json-file", "log-opts": {"max-size": "50m", "max-file": "3"}}
if os.path.exists(path):
    with open(path) as fp:
        cfg = json.load(fp)
else:
    cfg = {}
cfg["log-driver"] = desired_log["log-driver"]
cfg["log-opts"] = {**cfg.get("log-opts", {}), **desired_log["log-opts"]}
with open(path, "w") as fp:
    json.dump(cfg, fp, indent=2)
    fp.write("\n")
print("Wrote", path)
PY
  echo "Restarting docker..."
  systemctl restart docker
  echo "Done."
}

step_install_logrotate_fallback() {
  require_root install-logrotate-fallback
  local f=/etc/logrotate.d/docker-container-json
  cat >"$f" <<'LOGROTATE'
/var/lib/docker/containers/*/*-json.log {
  rotate 3
  size 200M
  copytruncate
  missingok
  notifempty
  compress
  delaycompress
}
LOGROTATE
  echo "Wrote $f — runs daily via logrotate; copytruncate is a safety net, not a substitute for log-opts."
}

step_compose_hints() {
  echo "=== Compose stack locations (search under /home /root /opt /srv /var) ==="
  for base in /home /root /opt /srv /var; do
    [[ -d "$base" ]] || continue
    find "$base" -maxdepth 5 \( -name 'docker-compose.yml' -o -name 'compose.yaml' \) 2>/dev/null
  done | while read -r p; do
    grep -l -i immich "$p" 2>/dev/null && echo "  $p"
  done || true
  echo
  echo "In that directory, after editing volume paths to $TARGET_BASE/...:"
  echo "  docker compose pull   # optional"
  echo "  docker compose up -d"
}

step_migrate_hints() {
  require_root migrate-hints
  echo "Target base: $TARGET_BASE"
  mkdir -p "$TARGET_BASE"/{postgres,redis,library,model-cache}
  chown -R root:root "$TARGET_BASE"
  echo
  echo "1) docker compose down  (in your Immich compose directory)"
  echo "2) Locate current data — for named volumes:"
  echo "     docker volume ls | grep -i immich"
  echo "     docker volume inspect VOLUME_NAME"
  echo "3) rsync -aHAX --progress SOURCE/ $TARGET_BASE/postgres/   (example; use real mountpoint)"
  echo "4) Edit docker-compose.yml (or .env) so volumes bind to:"
  echo "     $TARGET_BASE/postgres"
  echo "     $TARGET_BASE/redis"
  echo "     $TARGET_BASE/library"
  echo "     $TARGET_BASE/model-cache"
  echo "5) docker compose up -d"
  echo
  echo "Official compose reference: https://immich.app/docs/install/docker-compose"
}

usage() {
  cat <<USAGE
Usage: sudo bash $(basename "$0") <step>

  emergency-truncate     Stop Immich container, truncate its json log, start again (free root NOW)
  show-daemon-json       Print /etc/docker/daemon.json + recommended log limits
  apply-log-limits       Merge max-size/max-file into daemon.json and restart docker
  install-logrotate      Install /etc/logrotate.d fallback for *-json.log (optional)
  compose-hints          Try to find Immich compose files (read-only)
  migrate-hints          Print steps + mkdir $TARGET_BASE subdirs

Env: TARGET_BASE (default $TARGET_BASE), IMMICH_MATCH (default $IMMICH_MATCH)
USAGE
}

main() {
  local step="${1:-}"
  case "$step" in
    emergency-truncate) step_emergency_truncate ;;
    show-daemon-json) step_show_daemon_json ;;
    apply-log-limits) step_apply_log_limits ;;
    install-logrotate) step_install_logrotate_fallback ;;
    compose-hints) step_compose_hints ;;
    migrate-hints) step_migrate_hints ;;
    *) usage; exit 1 ;;
  esac
}

main "$@"
