#!/usr/bin/env bash
# Download and install Radiance 5.4 pre-built binaries for Linux x86_64.
# Called during Docker image build.

set -euo pipefail

RADIANCE_VERSION="5.4.0"
RADIANCE_URL="https://github.com/NREL/Radiance/releases/download/${RADIANCE_VERSION}/radiance-${RADIANCE_VERSION}-Linux.tar.gz"
INSTALL_DIR="/usr/local/radiance"

echo "[install_radiance] Downloading Radiance ${RADIANCE_VERSION}..."
curl -fsSL "${RADIANCE_URL}" -o /tmp/radiance.tar.gz

echo "[install_radiance] Extracting..."
mkdir -p "${INSTALL_DIR}"
tar -xzf /tmp/radiance.tar.gz -C "${INSTALL_DIR}" --strip-components=1
rm /tmp/radiance.tar.gz

# Add Radiance programs to PATH
echo "export PATH=\"${INSTALL_DIR}/bin:\$PATH\"" >> /etc/environment
echo "export RAYPATH=\"${INSTALL_DIR}/lib\"" >> /etc/environment

export PATH="${INSTALL_DIR}/bin:${PATH}"
export RAYPATH="${INSTALL_DIR}/lib"

echo "[install_radiance] Radiance installed at ${INSTALL_DIR}"
echo "[install_radiance] Verifying: $(rpict -version 2>&1 | head -1 || echo 'rpict not found in PATH')"
