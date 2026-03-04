#!/usr/bin/env bash
# Example: Configure Concierge to use a bundled Node.js runtime and CLIs.
#
# This script demonstrates how to set CONCIERGE_* environment variables
# for running Claude Code and Codex from a self-contained runtime directory
# (e.g., installed by an enterprise deployment tool).
#
# Adapt the paths and credential file locations to your environment.
set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Usage: source scripts/example-bundled-env.sh
       eval "$(scripts/example-bundled-env.sh)"

Example script showing how to configure Concierge to use a bundled CLI runtime
and skills directories. Adapt paths and credential locations to your setup.

When sourced or eval'd, exports CONCIERGE_* variables for:
  - Custom CLI command/args (CONCIERGE_CLAUDE_CMD, CONCIERGE_CLAUDE_ARGS, etc.)
  - Environment injection from JSON (CONCIERGE_CLI_ENV_FILE)
  - Skill directories (CONCIERGE_CLI_SKILLS_DIRS)
  - Sandbox permissions (CONCIERGE_CLAUDE_SANDBOX_ALLOW, etc.)
EOF
  exit 0
fi

# --- CUSTOMIZE: Set runtime_base to your bundled runtime location ---
# This example looks for a runtime directory containing a .runtime-ready marker.
cache_root="${XDG_CACHE_HOME:-$HOME/.cache}"
runtime_base="${cache_root}/gia/runtime"  # Change this path for your setup
runtime_dir=""

if [[ -d "${runtime_base}" ]]; then
  while IFS= read -r -d '' marker; do
    runtime_dir="$(dirname "$marker")"
    break
  done < <(find "${runtime_base}" -maxdepth 2 -type f -name .runtime-ready -print0 2>/dev/null | sort -z)
fi

if [[ -z "${runtime_dir}" ]]; then
  echo "No bundled runtime found under ${runtime_base} (missing .runtime-ready marker)." >&2
  exit 1
fi

node_bin="${runtime_dir}/node/bin/node"
cli_root="${runtime_dir}/clis"

if [[ ! -x "${node_bin}" ]]; then
  echo "Node.js runtime not found at ${node_bin}." >&2
  exit 1
fi

resolve_entry() {
  local package_name="$1"
  local bin_hint="$2"
  python - "$cli_root" "$package_name" "$bin_hint" <<'PY'
import json
import os
import sys

cli_root, package_name, bin_hint = sys.argv[1:]
pkg_dir = os.path.join(cli_root, "node_modules", *package_name.split("/"))
pkg_path = os.path.join(pkg_dir, "package.json")
if not os.path.exists(pkg_path):
    sys.exit(1)
with open(pkg_path, "r", encoding="utf-8") as f:
    pkg = json.load(f)
bin_entry = pkg.get("bin")
entry = None
if isinstance(bin_entry, str):
    entry = os.path.join(pkg_dir, bin_entry)
elif isinstance(bin_entry, dict):
    entry = bin_entry.get(bin_hint)
    if entry:
        entry = os.path.join(pkg_dir, entry)
if not entry or not os.path.exists(entry):
    sys.exit(2)
print(entry)
PY
}

json_array() {
  python - "$1" <<'PY'
import json
import sys
print(json.dumps([sys.argv[1]]))
PY
}

emit_exports() {
  local name="$1"
  local cmd_env="$2"
  local args_env="$3"
  local entrypoint="$4"

  local args_json
  args_json="$(json_array "$entrypoint")"

  printf 'export %s="%s"\n' "${cmd_env}" "${node_bin}"
  printf 'export %s=%q\n' "${args_env}" "${args_json}"
}

claude_entry="$(resolve_entry "@anthropic-ai/claude-code" "claude" || true)"
codex_entry="$(resolve_entry "@openai/codex" "codex" || true)"

exports=()

if [[ -n "${claude_entry}" ]]; then
  exports+=("CONCIERGE_CLAUDE_CMD=${node_bin}")
  exports+=("CONCIERGE_CLAUDE_ARGS=$(json_array "${claude_entry}")")
fi

if [[ -n "${codex_entry}" ]]; then
  exports+=("CONCIERGE_CODEX_CMD=${node_bin}")
  exports+=("CONCIERGE_CODEX_ARGS=$(json_array "${codex_entry}")")
fi

exports+=("CONCIERGE_CLI_RUNTIME_DIR=${runtime_dir}")

# --- CUSTOMIZE: Credential file locations ---
# This example reads API tokens from JSON/text files and injects them as env vars.
# Adapt the file paths and env var names to your credential storage.
env_json_path="/tmp/concierge-bundled-env.json"
python - "$env_json_path" <<'PY'
import json
import os
import sys

out_path = sys.argv[1]
env = {}

def load_json(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None

def load_text(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read().strip()
    except Exception:
        return None

genai = load_json(os.path.expanduser("~/genai.json"))
if isinstance(genai, dict):
    token = genai.get("token")
    base_url = genai.get("base_url")
    if token:
        env["ANTHROPIC_AUTH_TOKEN"] = token
        env["OPENAI_API_KEY"] = token
    if base_url:
        base = str(base_url).rstrip("/")
        env["ANTHROPIC_BASE_URL"] = base
        env["OPENAI_BASE_URL"] = base

jira = load_json(os.path.expanduser("~/jira.json"))
if isinstance(jira, dict):
    email = jira.get("email")
    token = jira.get("token")
    base_url = jira.get("base_url")
    if email:
        env["JIRA_EMAIL"] = email
    if token:
        env["JIRA_API_TOKEN"] = token
    if base_url:
        env["JIRA_BASE_URL"] = base_url

gitlab_pat = load_text(os.path.expanduser("~/gitlab-pat.txt"))
if gitlab_pat:
    env["GITLAB_TOKEN"] = gitlab_pat

if env:
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(env, f)
else:
    # Ensure we don't point at a stale env file
    try:
        os.remove(out_path)
    except FileNotFoundError:
        pass
PY

if [[ -f "${env_json_path}" ]]; then
  exports+=("CONCIERGE_CLI_ENV_FILE=${env_json_path}")
  exports+=("CONCIERGE_CLI_ENV_ALLOWLIST=OPENAI_API_KEY,OPENAI_BASE_URL,ANTHROPIC_AUTH_TOKEN,ANTHROPIC_BASE_URL,JIRA_EMAIL,JIRA_API_TOKEN,JIRA_BASE_URL,GITLAB_TOKEN")
fi

exports+=("CONCIERGE_CLI_PREPEND_SKILL_BINS=1")
exports+=("CONCIERGE_CLAUDE_DISABLE_EXPERIMENTAL_BETAS=1")
exports+=("CONCIERGE_CLAUDE_DISABLE_AUTO_UPDATE=1")
exports+=("CONCIERGE_CLAUDE_DISABLE_UPDATE_NAG=1")

# --- CUSTOMIZE: Extra sandbox file read permissions ---
# Allow Claude to read credential files needed by your skills.
exports+=("CONCIERGE_CLAUDE_SANDBOX_ALLOW=Read(${HOME}/.config/gcloud/**)")

# Skills directories (MySkills as global, AI-specific as per-provider).
global_skill_dirs=()
[[ -d "${HOME}/MySkills" ]] && global_skill_dirs+=("${HOME}/MySkills")

if [[ -d "${HOME}/.claude/skills" ]]; then
  exports+=("CONCIERGE_CLAUDE_SKILLS_DIRS=${HOME}/.claude/skills")
fi

if [[ -d "${HOME}/.codex/skills" ]]; then
  exports+=("CONCIERGE_CODEX_SKILLS_DIRS=${HOME}/.codex/skills")
fi

if [[ ${#global_skill_dirs[@]} -gt 0 ]]; then
  (IFS=':'; exports+=("CONCIERGE_CLI_SKILLS_DIRS=${global_skill_dirs[*]}"))
fi

# --- CUSTOMIZE: Dynamic sandbox domain allowlist ---
# Add domains your skills need network access to. This example detects installed
# skills and adds their required domains conditionally.
domains=()
skill_base="${HOME}/.claude/skills"
if [[ -d "${skill_base}" ]]; then
  # Example: Jira skill needs Atlassian domains
  [[ -d "${skill_base}/cli-jira" ]] && domains+=("your-org.atlassian.net" "id.atlassian.com")
  # Example: GitLab skill
  [[ -d "${skill_base}/cli-gitlab" ]] && domains+=("gitlab.your-org.com")
  # Example: Google APIs for BigQuery/Workspace
  [[ -d "${skill_base}/cli-bigquery" ]] && domains+=("accounts.google.com" "oauth2.googleapis.com" "www.googleapis.com" "bigquery.googleapis.com")
  [[ -d "${skill_base}/cli-workspace" ]] && domains+=("accounts.google.com" "oauth2.googleapis.com" "www.googleapis.com" "docs.google.com" "drive.google.com")
  [[ -d "${skill_base}/util-auth" ]] && domains+=("accounts.google.com" "oauth2.googleapis.com" "www.googleapis.com")
  # Example: Figma API
  [[ -d "${skill_base}/cli-figma" ]] && domains+=("api.figma.com")
fi

# Add any always-required domains (e.g., your API proxy)
# domains+=("api-proxy.your-org.com")

# Deduplicate domains using associative array
declare -A seen_domains
uniq_domains=()
for d in ${domains[@]+"${domains[@]}"}; do
  if [[ -z "${seen_domains[$d]:-}" ]]; then
    seen_domains[$d]=1
    uniq_domains+=("$d")
  fi
done

if [[ ${#uniq_domains[@]} -gt 0 ]]; then
  (IFS=','; exports+=("CONCIERGE_CLAUDE_SANDBOX_ALLOWED_DOMAINS=${uniq_domains[*]}"))
fi

is_sourced=0
if [[ -n "${ZSH_EVAL_CONTEXT-}" ]]; then
  case "${ZSH_EVAL_CONTEXT}" in
    *:file) is_sourced=1 ;;
  esac
elif [[ -n "${BASH_VERSION-}" ]]; then
  if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
    is_sourced=1
  fi
else
  case "$0" in
    *bash|*zsh|*sh) is_sourced=1 ;;
  esac
fi

if [[ "${is_sourced}" -eq 1 ]]; then
  for entry in "${exports[@]}"; do
    export "${entry}"
  done
else
  for entry in "${exports[@]}"; do
    printf 'export %s\n' "${entry}"
  done
fi
