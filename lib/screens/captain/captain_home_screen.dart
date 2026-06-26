import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/auth_providers.dart';
import '../../providers/admin_providers.dart';
import '../../providers/service_providers.dart';

class CaptainHomeScreen extends ConsumerWidget {
  const CaptainHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(currentUserProvider).valueOrNull;
    final teamId = user?.teamId ?? '';
    final teamAsync = ref.watch(teamProvider(teamId));
    final roleLabel = user?.role == 'viceCaptain' ? 'Vice Captain' : 'Captain';

    return Scaffold(
      appBar: AppBar(
        title: teamAsync.when(
          data: (team) => Text(team?.name ?? 'My Team'),
          loading: () => const Text('Loading...'),
          error: (_, __) => const Text('My Team'),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'Sign out',
            onPressed: () => ref.read(authServiceProvider).signOut(),
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Chip(label: Text(roleLabel)),
            const SizedBox(height: 24),
            Text('Players', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            const Expanded(
              child: Center(child: Text('Player management coming soon')),
            ),
          ],
        ),
      ),
    );
  }
}
