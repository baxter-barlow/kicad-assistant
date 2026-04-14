#!/bin/bash
set -euo pipefail

# KiCad Assistant Panel - Build Setup
# Tested on macOS 14+ (Apple Silicon)
#
# Prerequisites:
#   brew install cmake ninja wxwidgets protobuf boost swig python glm
#   brew install opencascade ngspice unixodbc glew cairo
#
# Usage:
#   ./setup.sh          # Configure and build
#   ./setup.sh --clean  # Clean build from scratch

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="${SCRIPT_DIR}/build-assistant"

if [ "${1:-}" = "--clean" ]; then
    echo "Removing build directory..."
    rm -rf "$BUILD_DIR"
fi

# Find wxWidgets
WX_CONFIG="$(which wx-config 2>/dev/null || echo "")"
if [ -z "$WX_CONFIG" ]; then
    # Try Homebrew paths
    for prefix in /opt/homebrew /usr/local; do
        if [ -x "${prefix}/bin/wx-config" ]; then
            WX_CONFIG="${prefix}/bin/wx-config"
            break
        fi
    done
fi

if [ -z "$WX_CONFIG" ]; then
    echo "Error: wx-config not found. Install wxWidgets:"
    echo "  brew install wxwidgets"
    exit 1
fi

echo "Using wx-config: ${WX_CONFIG}"
echo "wxWidgets version: $(${WX_CONFIG} --version)"

mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

if [ ! -f "CMakeCache.txt" ]; then
    echo "Configuring CMake..."
    cmake "$SCRIPT_DIR" \
        -G Ninja \
        -DCMAKE_BUILD_TYPE=Debug \
        -DCMAKE_OSX_ARCHITECTURES="$(uname -m)" \
        -DKICAD_IPC_API=ON \
        -DKICAD_USE_PCH=ON \
        -DKICAD_BUILD_QA_TESTS=OFF \
        -DwxWidgets_CONFIG_EXECUTABLE="$WX_CONFIG"
else
    echo "CMakeCache.txt exists, skipping configure (use --clean to reconfigure)"
fi

echo ""
echo "Building KiCad (this takes 15-20 minutes on first build)..."
NPROC="$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)"
ninja -j"$NPROC" kicad

echo ""
echo "Build complete."
echo ""
echo "To launch:"
echo "  open ${BUILD_DIR}/kicad/kicad.app"
echo ""
echo "Toggle the assistant panel: View > Panels > Assistant"
