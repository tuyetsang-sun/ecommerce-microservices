#!/bin/bash
set -euo pipefail

mkdir -p /etc/mongo-keyfile
key=/etc/mongo-keyfile/keyfile

if [ ! -s "$key" ]; then
  umask 077
  head -c 756 /dev/urandom | base64 > "$key.tmp"
  chown mongodb:mongodb "$key.tmp"
  chmod 400 "$key.tmp"
  mv "$key.tmp" "$key"
fi

chown mongodb:mongodb "$key"
chmod 400 "$key"

exec /usr/local/bin/docker-entrypoint.sh "$@"