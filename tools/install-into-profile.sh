#!/bin/sh
# Install this plugin into a dsh profile.
#
# The desktop profile is owned by the Electron application: `dsh --profile
# desktop` refuses to compose it, but `dsh plugin` is a plain pnpm passthrough
# into the profile directory and works, which is also what the Plugins page
# does. `pnpm add` writes the dependency *and* the `dsh.profile.bundles` row,
# so a restart is all that is left afterwards.
#
# Both packages are packed: the host carries the management logic and the
# Typert descriptors, the UI carries the browser bundle, and each is a Loader
# row of its own. Installing the host alone leaves the sidebar row without the
# panel it opens.
#
# Usage: sh tools/install-into-profile.sh [profile]
#   sh tools/install-into-profile.sh desktop
set -eu

PROFILE=${1:-desktop}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DSH_CLI=${DSH_CLI:-/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh}

cd "$ROOT/dsh-mcp-mgr"
pnpm run build
HOST_TARBALL=$(pnpm pack --pack-destination dist | tail -1)
echo "packed $HOST_TARBALL"

cd "$ROOT/dsh-mcp-mgr-ui"
pnpm run build
UI_TARBALL=$(pnpm pack --pack-destination dist | tail -1)
echo "packed $UI_TARBALL"

# A local install pins each tarball's path, so they must outlive this run.
# The UI goes first: the host depends on it, so installing it second lets the
# profile resolve that dependency from what is already there.
"$DSH_CLI" plugin --profile "$PROFILE" add "$UI_TARBALL"
"$DSH_CLI" plugin --profile "$PROFILE" add "$HOST_TARBALL"

echo
echo "Installed. Restart DeepSeek Harness to mount the new bundle rows;"
echo "the sidebar entry appears directly under Plugins."
