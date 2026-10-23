#!/usr/bin/env bash
# Claude Code PreToolUse hook: refuse Convex CLI commands while an inherited
# deploy key could select a hosted deployment. A Conductor-injected
# CONVEX_DEPLOY_KEY once made `npx convex dev` push Spot over spot-content
# production. Local work uses the Conductor run script
# (CONVEX_AGENT_MODE=anonymous, --local-cloud-port) with the key unset.
set -euo pipefail
command=$(jq -r '.tool_input.command // ""')
# Convex CLI entrypoints: npx/bunx/pnpm/npm exec/yarn convex, node_modules/.bin/convex.
cli='(^|[;&|(` ]|^ *)((npx|bunx|pnpm|yarn)( +(exec|dlx|--?[[:alnum:]-]+))* +convex|npm +exec( +--?[[:alnum:]-]+)* +convex|(\./)?node_modules/\.bin/convex|(^|[;&|(` ] *)convex)( |$)'
# Each shell command needs its own prefix. An unset in a later command must
# never authorize an earlier bare CLI call. Splitting quoted separators too is
# conservative: complex wrappers can use separate, explicitly prefixed calls.
unsets() {
  grep -Eq '^[[:space:]]*env[[:space:]]' <<<"$segment" &&
    grep -Eq "env( [^;&|]*)? (-u *|--unset[= ])$1( |$)" <<<"$segment"
}
while IFS= read -r segment; do
  grep -Eq "$cli" <<<"$segment" || continue
  for name in CONVEX_DEPLOY_KEY CONVEX_DEPLOYMENT_TOKEN CONVEX_SELF_HOSTED_ADMIN_KEY; do
    if [ -n "${!name:-}" ] && ! unsets "$name"; then blocked=1; fi
  done
done < <(printf '%s\n' "$command" | tr ';&|' '\n')
[ -n "${blocked:-}" ] || exit 0
cat >&2 <<'MSG'
Blocked: a Convex deploy credential is in this environment, so the Convex CLI would target a hosted (possibly production) deployment instead of the local backend.
Prefix the command with: env -u CONVEX_DEPLOY_KEY -u CONVEX_DEPLOYMENT_TOKEN CONVEX_AGENT_MODE=anonymous
For a local backend use the Conductor run script (convex dev --local-cloud-port $((CONDUCTOR_PORT + 3)) --local-site-port $((CONDUCTOR_PORT + 4))). Never deploy from an agent session; production deploys go through CI.
MSG
exit 2
