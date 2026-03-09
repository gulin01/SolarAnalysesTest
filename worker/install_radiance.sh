#!/usr/bin/env bash
# Download and install Radiance 5.4 pre-built binaries for Linux x86_64.
# Called during Docker image build. EXITS WITH ERROR if installation fails.

set -euo pipefail

RADIANCE_VERSION="5.4.0"
RADIANCE_URL="https://github.com/NREL/Radiance/releases/download/${RADIANCE_VERSION}/radiance-${RADIANCE_VERSION}-Linux.tar.gz"
INSTALL_DIR="/usr/local/radiance"

echo "[install_radiance] Downloading Radiance ${RADIANCE_VERSION}..."
if ! curl -fsSL "${RADIANCE_URL}" -o /tmp/radiance.tar.gz; then
    echo "[install_radiance] ERROR: Failed to download Radiance from ${RADIANCE_URL}"
    exit 1
fi

if [ ! -s /tmp/radiance.tar.gz ]; then
    echo "[install_radiance] ERROR: Downloaded file is empty"
    exit 1
fi

echo "[install_radiance] Extracting to ${INSTALL_DIR}..."
mkdir -p "${INSTALL_DIR}"
if ! tar -xzf /tmp/radiance.tar.gz -C "${INSTALL_DIR}" --strip-components=1; then
    echo "[install_radiance] ERROR: Failed to extract Radiance tar.gz"
    exit 1
fi
rm /tmp/radiance.tar.gz

# Verify installation
if [ ! -f "${INSTALL_DIR}/bin/rpict" ]; then
    echo "[install_radiance] ERROR: rpict binary not found in ${INSTALL_DIR}/bin"
    ls -la "${INSTALL_DIR}/bin" 2>/dev/null || echo "  (bin directory does not exist)"
    exit 1
fi

# Add Radiance programs to PATH (for Docker runtime)
echo "export PATH=\"${INSTALL_DIR}/bin:\$PATH\"" >> /etc/environment
echo "export RAYPATH=\"${INSTALL_DIR}/lib\"" >> /etc/environment

export PATH="${INSTALL_DIR}/bin:${PATH}"
export RAYPATH="${INSTALL_DIR}/lib"

echo "[install_radiance] SUCCESS: Radiance installed at ${INSTALL_DIR}"
echo "[install_radiance] Verifying: $(rpict -version 2>&1 | head -1)"
