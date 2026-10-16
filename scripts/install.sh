#!/usr/bin/env bash
# Keep execution inside main so an incomplete curl download cannot start an install.
main() (
  set -Eeuo pipefail
  umask 077

  install_version='v0.1.4'
  install_domain=''
  install_dir="${CARDFOLIO_INSTALL_DIR:-$HOME/cardfolio}"
  install_no_proxy=false
  install_stage=''

  usage() {
    cat <<'USAGE'
用法：bash install.sh <域名> [--no-proxy] [--dir 安装目录]

自动下载固定发布版本，生成配置、构建镜像、迁移数据库并启动 HTTPS。
默认安装到 ~/cardfolio；重复执行保留配置、数据库和备份。
--no-proxy：使用已有 HTTPS 反向代理，转发到 127.0.0.1:3000。
--dir：指定安装目录，也可设置 CARDFOLIO_INSTALL_DIR。
USAGE
  }

  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help) usage; exit 0 ;;
      --no-proxy) install_no_proxy=true; shift ;;
      --dir)
        if [[ $# -lt 2 || -z "$2" || "$2" == -* ]]; then usage >&2; exit 1; fi
        install_dir="$2"
        shift 2
        ;;
      -*) usage >&2; exit 1 ;;
      *)
        if [[ -n "$install_domain" ]]; then usage >&2; exit 1; fi
        install_domain="$1"
        shift
        ;;
    esac
  done
  if [[ ${#install_domain} -gt 253 || ! "$install_domain" =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]([a-zA-Z0-9-]*[a-zA-Z0-9])?$ ]]; then
    printf '请传入域名，例如 cards.example.com，不带协议、端口或路径。\n' >&2
    exit 1
  fi
  for install_command in curl tar docker openssl; do
    if ! command -v "$install_command" >/dev/null 2>&1; then
      printf '缺少命令：%s；请先安装（Docker 需包含 Compose 插件）。\n' "$install_command" >&2
      exit 1
    fi
  done
  docker compose version >/dev/null
  docker info >/dev/null

  mkdir -p -- "$install_dir"
  install_dir="$(cd -- "$install_dir" && pwd -P)"
  if [[ ! -f "$install_dir/.cardfolio-install" && -n "$(ls -A -- "$install_dir")" ]]; then
    printf '安装目录非空且不是本脚本创建的目录：%s；请用 --dir 指定一个空目录。\n' "$install_dir" >&2
    exit 1
  fi
  if ! mkdir -- "$install_dir/.install-lock"; then
    printf '已有安装正在运行；若上次被强制终止，请确认进程退出后移除 %s/.install-lock 再重试。\n' "$install_dir" >&2
    exit 1
  fi
  # shellcheck disable=SC2329 # Invoked by the EXIT trap below.
  cleanup() {
    install_status=$?
    trap - EXIT
    if [[ -n "$install_stage" ]]; then rm -rf -- "$install_stage"; fi
    rmdir -- "$install_dir/.install-lock" || true
    if [[ "$install_status" -ne 0 ]]; then
      printf '\n安装未完成。配置、数据库和备份保留在原处；修复错误后可重跑同一命令。\n' >&2
    fi
    exit "$install_status"
  }
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  if [[ -f "$install_dir/.cardfolio-install" ]]; then
    if [[ "$(cat "$install_dir/.cardfolio-install")" != 'HightBigger/CardCalendar' ]]; then
      printf '安装目录标记不匹配：%s\n' "$install_dir" >&2
      exit 1
    fi
  else
    printf 'HightBigger/CardCalendar\n' > "$install_dir/.cardfolio-install"
  fi
  if [[ -e "$install_dir/current" && ! -L "$install_dir/current" ]]; then
    printf '%s/current 必须是安装脚本管理的符号链接。\n' "$install_dir" >&2
    exit 1
  fi
  mkdir -p -- "$install_dir/releases" "$install_dir/.deploy-backups"
  chmod 700 "$install_dir/.deploy-backups"
  install_release_dir="$install_dir/releases/$install_version"
  if [[ ! -e "$install_release_dir" ]]; then
    install_stage="$(mktemp -d "$install_dir/.install-XXXXXX")"
    printf '\n下载 Cardfolio %s\n' "$install_version"
    curl --fail --show-error --location --retry 2 --connect-timeout 20 --max-time 300 \
      "https://codeload.github.com/HightBigger/CardCalendar/tar.gz/refs/tags/$install_version" \
      --output "$install_stage/source.tar.gz"
    mkdir "$install_stage/source"
    tar -xzf "$install_stage/source.tar.gz" --strip-components=1 -C "$install_stage/source"
    for install_file in scripts/deploy.sh Dockerfile docker-compose.production.yml docker-compose.https.yml .env.production.example deploy/Caddyfile; do
      if [[ ! -f "$install_stage/source/$install_file" ]]; then
        printf '下载内容不完整，缺少 %s。\n' "$install_file" >&2
        exit 1
      fi
    done
    printf '%s\n' "$install_version" > "$install_stage/source/.cardfolio-version"
    ln -s "$install_dir/.env.production" "$install_stage/source/.env.production"
    ln -s "$install_dir/.deploy-backups" "$install_stage/source/.deploy-backups"
    mv -- "$install_stage/source" "$install_release_dir"
  fi
  if [[ ! -f "$install_release_dir/.cardfolio-version" || "$(cat "$install_release_dir/.cardfolio-version")" != "$install_version" || ! -f "$install_release_dir/scripts/deploy.sh" ]]; then
    printf '版本目录不完整，请保留数据并检查 %s。\n' "$install_release_dir" >&2
    exit 1
  fi

  export CARDFOLIO_ENV_FILE="$install_dir/.env.production"
  if [[ "$install_no_proxy" == true ]]; then
    bash "$install_release_dir/scripts/deploy.sh" "$install_domain" --no-proxy
  else
    bash "$install_release_dir/scripts/deploy.sh" "$install_domain"
  fi
  ln -sfn "releases/$install_version" "$install_dir/current"
  printf '\nCardfolio %s 安装完成：https://%s\n' "$install_version" "$install_domain"
  printf '安装目录：%s\n配置文件：%s/.env.production\n数据库备份：%s/.deploy-backups/\n' "$install_dir" "$install_dir" "$install_dir"
)

main "$@"
