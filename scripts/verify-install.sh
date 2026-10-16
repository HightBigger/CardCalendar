#!/usr/bin/env bash
# Exercise the real installer/deployer with local archives and a Docker stand-in.
# No network, real containers, credentials, or existing installations are touched.
set -Eeuo pipefail

verify_repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
verify_tmp="$(mktemp -d "${TMPDIR:-/tmp}/cardfolio-install-test-XXXXXX")"
trap 'rm -rf -- "$verify_tmp"' EXIT
mkdir -p "$verify_tmp/bin" "$verify_tmp/fixture/cardcalendar/scripts" "$verify_tmp/fixture/cardcalendar/deploy"
cp "$verify_repo/scripts/deploy.sh" "$verify_tmp/fixture/cardcalendar/scripts/"
cp "$verify_repo/Dockerfile" "$verify_repo/docker-compose.production.yml" "$verify_repo/docker-compose.https.yml" "$verify_repo/.env.production.example" "$verify_tmp/fixture/cardcalendar/"
cp "$verify_repo/deploy/Caddyfile" "$verify_tmp/fixture/cardcalendar/deploy/"
tar -czf "$verify_tmp/source.tar.gz" -C "$verify_tmp/fixture" cardcalendar

cat > "$verify_tmp/bin/curl" <<'STUB'
#!/usr/bin/env bash
set -eu
if [[ "${VERIFY_INSTALL_FAIL:-}" == download ]]; then exit 22; fi
while [[ $# -gt 0 ]]; do
  if [[ "$1" == --output ]]; then cp "$VERIFY_INSTALL_ARCHIVE" "$2"; exit 0; fi
  shift
done
exit 1
STUB
cat > "$verify_tmp/bin/openssl" <<'STUB'
#!/usr/bin/env bash
printf '%064d\n' 1
STUB
cat > "$verify_tmp/bin/docker" <<'STUB'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$VERIFY_INSTALL_DOCKER_LOG"
case " $* " in
  *' build web worker '*)
    [[ "${VERIFY_INSTALL_FAIL:-}" != build ]] || exit 41
    [[ "${WEB_IMAGE:-}" == cardcalendar-web:v* ]] || exit 42
    [[ "${APP_URL:-}" == https://cards.example.com ]] || exit 43
    ;;
  *' exec -T postgres '*)
    [[ "${VERIFY_INSTALL_FAIL:-}" != backup ]] || exit 44
    printf 'fake-pg-dump\n'
    ;;
  *' run --rm --no-deps migrate '*)
    [[ "${VERIFY_INSTALL_FAIL:-}" != migration ]] || exit 45
    ;;
esac
STUB
chmod +x "$verify_tmp/bin/"*
export PATH="$verify_tmp/bin:$PATH"
export VERIFY_INSTALL_ARCHIVE="$verify_tmp/source.tar.gz"
export VERIFY_INSTALL_DOCKER_LOG="$verify_tmp/docker.log"
export CARDFOLIO_INSTALL_DIR="$verify_tmp/install with spaces"

fail() { printf 'FAIL: %s\n' "$*" >&2; cat "$verify_tmp/run.log" >&2; exit 1; }
run_install() {
  : > "$VERIFY_INSTALL_DOCKER_LOG"
  bash "$verify_repo/scripts/install.sh" "$@" > "$verify_tmp/run.log" 2>&1
}
expect_failure() {
  if run_install "$@"; then fail 'expected installation to fail'; fi
}
assert_no_docker_action() {
  if grep -q -- "$1" "$VERIFY_INSTALL_DOCKER_LOG"; then fail "unexpected Docker action: $1"; fi
}

run_install cards.example.com
[[ -L "$CARDFOLIO_INSTALL_DIR/current" ]] || fail 'missing current release'
[[ -f "$CARDFOLIO_INSTALL_DIR/.env.production" ]] || fail 'missing shared environment'
[[ "$(ls -l "$CARDFOLIO_INSTALL_DIR/.env.production")" == -rw-------* ]] || fail 'environment permissions'
[[ -f "$CARDFOLIO_INSTALL_DIR/current/.env.production" ]] || fail 'release cannot access shared environment'
[[ -d "$CARDFOLIO_INSTALL_DIR/current/.deploy-backups" ]] || fail 'release cannot access shared backups'
grep -q ' pull caddy$' "$VERIFY_INSTALL_DOCKER_LOG" || fail 'default HTTPS disabled'
verify_backups=("$CARDFOLIO_INSTALL_DIR/.deploy-backups/"*.dump)
[[ ${#verify_backups[@]} -eq 1 && -s "${verify_backups[0]}" ]] || fail 'missing first backup'
printf 'PASS: first installation, shared state, permissions, HTTPS, versioned images\n'

printf '\n# preserve me\n' >> "$CARDFOLIO_INSTALL_DIR/.env.production"
cp "$CARDFOLIO_INSTALL_DIR/.env.production" "$verify_tmp/saved.env"
VERIFY_INSTALL_FAIL=download run_install cards.example.com --no-proxy
cmp "$verify_tmp/saved.env" "$CARDFOLIO_INSTALL_DIR/.env.production" || fail 'configuration overwritten'
verify_backups=("$CARDFOLIO_INSTALL_DIR/.deploy-backups/"*.dump)
[[ ${#verify_backups[@]} -eq 2 ]] || fail 'previous backup lost'
assert_no_docker_action 'caddy'
printf 'PASS: repeat installation reuses source and preserves configuration/backups\n'

ln -sfn releases/previous "$CARDFOLIO_INSTALL_DIR/current"
VERIFY_INSTALL_FAIL=build expect_failure cards.example.com
[[ "$(readlink "$CARDFOLIO_INSTALL_DIR/current")" == releases/previous ]] || fail 'failed release became current'
[[ ! -d "$CARDFOLIO_INSTALL_DIR/.install-lock" ]] || fail 'failure leaked lock'
assert_no_docker_action ' stop '
cmp "$verify_tmp/saved.env" "$CARDFOLIO_INSTALL_DIR/.env.production" || fail 'failure changed configuration'
printf 'PASS: build failure leaves current release and running application intact\n'

VERIFY_INSTALL_FAIL=backup expect_failure cards.example.com
assert_no_docker_action ' run --rm --no-deps migrate'
VERIFY_INSTALL_FAIL=migration expect_failure cards.example.com
assert_no_docker_action ' up -d --no-deps --wait --wait-timeout 180 web worker'
run_install cards.example.com --no-proxy
[[ -f "$CARDFOLIO_INSTALL_DIR/current/scripts/deploy.sh" ]] || fail 'retry did not recover'
printf 'PASS: backup/migration failures stop deployment; same command can retry\n'

mkdir "$CARDFOLIO_INSTALL_DIR/.install-lock"
expect_failure cards.example.com
[[ -d "$CARDFOLIO_INSTALL_DIR/.install-lock" ]] || fail 'removed another installation lock'
assert_no_docker_action ' build '
rmdir "$CARDFOLIO_INSTALL_DIR/.install-lock"
printf 'PASS: concurrent installation refused\n'

verify_existing_dir="$CARDFOLIO_INSTALL_DIR"
export CARDFOLIO_INSTALL_DIR="$verify_tmp/invalid-domain"
expect_failure https://cards.example.com
[[ ! -e "$CARDFOLIO_INSTALL_DIR" ]] || fail 'invalid domain created installation'
mkdir "$verify_tmp/occupied"
printf 'user file\n' > "$verify_tmp/occupied/keep"
expect_failure cards.example.com --dir "$verify_tmp/occupied"
[[ "$(cat "$verify_tmp/occupied/keep")" == 'user file' ]] || fail 'non-owned directory modified'
printf 'PASS: invalid domain and non-owned directory refused\n'

export CARDFOLIO_INSTALL_DIR="$verify_tmp/download-failure"
VERIFY_INSTALL_FAIL=download expect_failure cards.example.com
[[ ! -e "$CARDFOLIO_INSTALL_DIR/current" && ! -e "$CARDFOLIO_INSTALL_DIR/.env.production" && ! -d "$CARDFOLIO_INSTALL_DIR/.install-lock" ]] || fail 'download failure changed application state'
assert_no_docker_action ' build '
printf 'truncated archive\n' > "$verify_tmp/broken.tar.gz"
VERIFY_INSTALL_ARCHIVE="$verify_tmp/broken.tar.gz" expect_failure cards.example.com
assert_no_docker_action ' build '
run_install cards.example.com --no-proxy
[[ -L "$CARDFOLIO_INSTALL_DIR/current" ]] || fail 'download failure cannot be retried'
printf 'PASS: download/extraction failure does not deploy and can be retried\n'

export CARDFOLIO_INSTALL_DIR="$verify_existing_dir"
printf '\nInstaller/deployer integration checks passed (Docker operations simulated).\n'
