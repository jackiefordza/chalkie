#!/bin/bash
set -e

FLUTTER_HOME="$HOME/flutter"

if [ ! -d "$FLUTTER_HOME" ]; then
  echo "Installing Flutter SDK..."
  git clone https://github.com/flutter/flutter.git -b stable "$FLUTTER_HOME" --depth 1
fi

export PATH="$PATH:$FLUTTER_HOME/bin:$HOME/.pub-cache/bin"
echo 'export PATH="$PATH:$HOME/flutter/bin:$HOME/.pub-cache/bin"' >> ~/.bashrc
echo 'export PATH="$PATH:$HOME/flutter/bin:$HOME/.pub-cache/bin"' >> ~/.profile

echo "Configuring Flutter..."
flutter config --enable-web --no-analytics
flutter precache --web

echo "Installing Firebase CLI..."
npm install -g firebase-tools

echo "Installing FlutterFire CLI..."
dart pub global activate flutterfire_cli

echo "Chalkie dev environment ready."
