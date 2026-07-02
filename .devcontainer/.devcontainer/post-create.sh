#!/bin/bash
set -e

echo "Installing Firebase CLI..."
npm install -g firebase-tools

echo "Installing mobile dependencies..."
npm --prefix mobile install

echo "Chalkie dev environment ready."
