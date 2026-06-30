import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, kIsWeb, TargetPlatform;

class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    if (kIsWeb) {
      return web;
    }
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return android;
      case TargetPlatform.iOS:
        return ios;
      default:
        throw UnsupportedError(
          'DefaultFirebaseOptions are not supported for this platform.',
        );
    }
  }

  static const FirebaseOptions web = FirebaseOptions(
    apiKey: 'AIzaSyBKC5qrnJ6HGGOR0F5qf-CbYHcmvvmnqAA',
    appId: '1:947789418402:web:e3cc81d9fe166cd865ecfb',
    messagingSenderId: '947789418402',
    projectId: 'chalkie-app',
    authDomain: 'chalkie-app.firebaseapp.com',
    storageBucket: 'chalkie-app.firebasestorage.app',
  );

  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyBKC5qrnJ6HGGOR0F5qf-CbYHcmvvmnqAA',
    appId: '1:947789418402:android:ac31a0675bed0f2565ecfb',
    messagingSenderId: '947789418402',
    projectId: 'chalkie-app',
    storageBucket: 'chalkie-app.firebasestorage.app',
  );

  static const FirebaseOptions ios = FirebaseOptions(
    apiKey: 'AIzaSyBKC5qrnJ6HGGOR0F5qf-CbYHcmvvmnqAA',
    appId: '1:947789418402:ios:137424afff3787b965ecfb',
    messagingSenderId: '947789418402',
    projectId: 'chalkie-app',
    storageBucket: 'chalkie-app.firebasestorage.app',
    iosBundleId: 'com.chalkie.chalkie',
  );
}
