const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// Metro's package.json "exports" resolution picks the wrong build of the
// `firebase` package on native (works fine on web) — causes
// "Component auth has not been registered yet". Documented Firebase/Expo fix.
config.resolver.unstable_enablePackageExports = false;

module.exports = withNativeWind(config, { input: './global.css' });
