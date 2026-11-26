#!/bin/sh
# The container starts as root, because a new hostPath volume belongs to root.
# This script gives /data and $HOME to the "node" user, and then starts the
# server as "node". The server and the agent commands never run as root.
set -eu

mkdir -p "$HOME"
chown node:node /data "$HOME"

exec setpriv --reuid=node --regid=node --init-groups -- "$@"
