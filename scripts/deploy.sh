#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'USAGE'
用法：bash scripts/deploy.sh <域名> [--no-proxy]

示例：bash scripts/deploy.sh cards.example.com
首次运行自动生成 .env.production、数据库密码，并配置 HTTPS。
后续运行保留配置和数据，备份数据库后迁移并更新应用。
--no-proxy：使用已有反向代理，由它将 HTTPS 请求转发到 127.0.0.1:3000。
USAGE
}

deploy_domain=""
deploy_proxy=true
for deploy_arg in "$@"; do
  case "$deploy_arg" in
    -h|--help) usage; exit 0 ;;
    --no-proxy) deploy_proxy=false ;;
    -*) usage >&2; exit 1 ;;
    *)
      if [[ -n "$deploy_domain" ]]; then usage >&2; exit 1; fi
      deploy_domain="$deploy_arg"
      ;;
  esac
done
if [[ ${#deploy_domain} -gt 253 || ! "$deploy_domain" =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]([a-zA-Z0-9-]*[a-zA-Z0-9])?$ ]]; then
  printf '请传入域名，例如 cards.example.com，不带协议、端口或路径。\n' >&2
  exit 1
fi

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
for deploy_command in docker openssl; do
  if ! command -v "$deploy_command" >/dev/null 2>&1; then
    printf '缺少命令：%s\n' "$deploy_command" >&2
    exit 1
  fi
done
docker compose version >/dev/null
docker info >/dev/null

deploy_env_file="${CARDFOLIO_ENV_FILE:-.env.production}"
if [[ ! -e "$deploy_env_file" ]]; then
  deploy_password="$(openssl rand -hex 32)"
  # Never source the environment file or expose credentials in command arguments.
  (
    umask 077
    set -o noclobber
    sed \
      -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$deploy_password|" \
      -e "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://cardcalendar:$deploy_password@postgres:5432/cardcalendar|" \
      -e "s|^APP_URL=.*|APP_URL=https://$deploy_domain|" \
      .env.production.example > "$deploy_env_file"
  )
  unset deploy_password
  printf '已生成 %s；密码仅保存在该文件中。\n' "$deploy_env_file"
fi

if [[ -f .cardfolio-version ]]; then
  deploy_revision="$(cat .cardfolio-version)"
else
  deploy_revision="$(git rev-parse --short=12 HEAD 2>/dev/null || date -u +%Y%m%d%H%M%S)"
fi
if [[ ! "$deploy_revision" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$ ]]; then
  printf '无效的发布版本标识。\n' >&2
  exit 1
fi
export WEB_IMAGE="cardcalendar-web:$deploy_revision"
export WORKER_IMAGE="cardcalendar-worker:$deploy_revision"
export APP_DOMAIN="$deploy_domain"
export APP_URL="https://$deploy_domain"
deploy_compose=(docker compose --env-file "$deploy_env_file" -f docker-compose.production.yml)
if [[ "$deploy_proxy" == true ]]; then
  deploy_compose+=(-f docker-compose.https.yml)
fi
compose() { "${deploy_compose[@]}" "$@"; }
on_error() {
  local deploy_status=$?
  trap - ERR
  printf '\n部署失败（退出码 %s）。配置、备份和数据库卷均保留。\n' "$deploy_status" >&2
  compose ps >&2 || true
  exit "$deploy_status"
}
trap on_error ERR

compose config --quiet
printf '\n[1/5] 构建版本 %s\n' "$deploy_revision"
compose build web worker
if [[ "$deploy_proxy" == true ]]; then compose pull caddy; fi

printf '\n[2/5] 等待数据库就绪\n'
compose up -d --wait --wait-timeout 120 postgres

printf '\n[3/5] 停止应用写入并备份数据库\n'
compose stop --timeout 30 web worker
mkdir -p .deploy-backups
chmod 700 .deploy-backups
deploy_backup=".deploy-backups/$(date -u +%Y%m%dT%H%M%SZ)-$deploy_revision-$$.dump"
(
  umask 077
  # Expand database settings inside the container, never on the host.
  # shellcheck disable=SC2016
  compose exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$deploy_backup"
)
if [[ ! -s "$deploy_backup" ]]; then
  printf '数据库备份为空，停止发布。\n' >&2
  exit 1
fi
printf '备份：%s\n' "$deploy_backup"

printf '\n[4/5] 执行数据库迁移\n'
compose run --rm --no-deps migrate

printf '\n[5/5] 启动并检查应用\n'
compose up -d --no-deps --wait --wait-timeout 180 web worker
if [[ "$deploy_proxy" == true ]]; then
  compose up -d --no-deps caddy
fi
compose ps
printf '\n应用与数据库检查通过：https://%s\n' "$deploy_domain"
if [[ "$deploy_proxy" == true ]]; then
  printf 'Caddy 已启动，正在自动申请或续用 HTTPS 证书。\n'
else
  printf '请确认已有 HTTPS 反向代理已指向配置的 WEB_PORT（默认 127.0.0.1:3000）。\n'
fi
