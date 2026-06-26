import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../models/season.dart';
import '../../providers/admin_providers.dart';
import '../../providers/auth_providers.dart';
import '../../providers/service_providers.dart';

class AdminHomeScreen extends ConsumerWidget {
  const AdminHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(currentUserProvider).valueOrNull;
    final leagueId = user?.leagueId ?? '';
    final leagueAsync = ref.watch(leagueProvider(leagueId));
    final seasonsAsync = ref.watch(seasonsProvider(leagueId));

    return Scaffold(
      appBar: AppBar(
        title: Text(leagueAsync.valueOrNull?.name ?? 'Chalkie'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: () => ref.read(authServiceProvider).signOut(),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showCreateSeason(context, ref, leagueId),
        icon: const Icon(Icons.add),
        label: const Text('New season'),
      ),
      body: seasonsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (seasons) => seasons.isEmpty
            ? Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.sports_bar, size: 64, color: Theme.of(context).colorScheme.outlineVariant),
                    const SizedBox(height: 16),
                    Text('No seasons yet', style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 4),
                    Text('Tap + to create your first season',
                        style: Theme.of(context).textTheme.bodySmall),
                  ],
                ),
              )
            : ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: seasons.length,
                itemBuilder: (_, i) => _SeasonCard(season: seasons[i]),
              ),
      ),
    );
  }

  Future<void> _showCreateSeason(BuildContext context, WidgetRef ref, String leagueId) async {
    final ctrl = TextEditingController();
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('New season'),
        content: TextField(
          controller: ctrl,
          decoration: const InputDecoration(
              labelText: 'Season name', hintText: 'e.g. 2025/26', border: OutlineInputBorder()),
          autofocus: true,
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(
            onPressed: () async {
              final name = ctrl.text.trim();
              if (name.isEmpty) return;
              Navigator.pop(ctx);
              await ref.read(adminServiceProvider).createSeason(leagueId, name);
            },
            child: const Text('Create'),
          ),
        ],
      ),
    );
    ctrl.dispose();
  }
}

class _SeasonCard extends StatelessWidget {
  const _SeasonCard({required this.season});
  final Season season;

  Color _statusColor(BuildContext context) => switch (season.status) {
        SeasonStatus.active => Colors.green,
        SeasonStatus.upcoming => Colors.orange,
        SeasonStatus.completed => Theme.of(context).colorScheme.outline,
      };

  @override
  Widget build(BuildContext context) {
    final color = _statusColor(context);
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        title: Text(season.name, style: const TextStyle(fontWeight: FontWeight.w600)),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: color),
              ),
              child: Text(season.status.label, style: TextStyle(color: color, fontSize: 12)),
            ),
            const SizedBox(width: 4),
            const Icon(Icons.chevron_right),
          ],
        ),
        onTap: () => context.push('/admin/seasons/${season.id}'),
      ),
    );
  }
}
