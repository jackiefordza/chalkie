import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/service_providers.dart';

class PlayerHomeScreen extends ConsumerWidget {
  const PlayerHomeScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Chalkie'),
        actions: [IconButton(icon: const Icon(Icons.logout), onPressed: () => ref.read(authServiceProvider).signOut())],
      ),
      body: const Center(child: Text('Player home — coming soon')),
    );
  }
}
