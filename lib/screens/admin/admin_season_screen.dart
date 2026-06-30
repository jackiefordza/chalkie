import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../providers/admin_providers.dart';
import '../../providers/auth_providers.dart';

class AdminSeasonScreen extends ConsumerWidget {
  const AdminSeasonScreen({super.key, required this.seasonId});
  final String seasonId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final leagueId = ref.watch(currentUserProvider).valueOrNull?.leagueId ?? '';
    final season = ref.watch(seasonsProvider(leagueId)).valueOrNull
        ?.where((s) => s.id == seasonId)
        .firstOrNull;
    final divisionsAsync = ref.watch(divisionsProvider(seasonId));

    return Scaffold(
      appBar: AppBar(
        title: Text(season?.name ?? 'Season'),
        actions: [
          PopupMenuButton<String>(
            onSelected: (v) => ref.read(adminServiceProvider).updateSeasonStatus(seasonId, v),
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'upcoming', child: Text('Mark Upcoming')),
              PopupMenuItem(value: 'active',   child: Text('Mark Active')),
              PopupMenuItem(value: 'completed', child: Text('Mark Completed')),
            ],
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showAddDivision(context, ref, leagueId),
        icon: const Icon(Icons.add),
        label: const Text('Add division'),
      ),
      body: divisionsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (divisions) => divisions.isEmpty
            ? const Center(child: Text('No divisions yet — tap + to add one'))
            : ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: divisions.length,
                itemBuilder: (_, i) {
                  final d = divisions[i];
                  return Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    child: ListTile(
                      title: Text(d.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => context.push('/admin/seasons/$seasonId/divisions/${d.id}'),
                    ),
                  );
                },
              ),
      ),
    );
  }

  Future<void> _showAddDivision(BuildContext context, WidgetRef ref, String leagueId) async {
    final ctrl = TextEditingController();
    final existingCount = ref.read(divisionsProvider(seasonId)).valueOrNull?.length ?? 0;
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Add division'),
        content: TextField(
          controller: ctrl,
          decoration: const InputDecoration(
              labelText: 'Division name', hintText: 'e.g. Division 1', border: OutlineInputBorder()),
          autofocus: true,
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(
            onPressed: () async {
              final name = ctrl.text.trim();
              if (name.isEmpty) return;
              Navigator.pop(ctx);
              await ref.read(adminServiceProvider).createDivision(
                    leagueId: leagueId, seasonId: seasonId,
                    name: name, order: existingCount + 1,
                  );
            },
            child: const Text('Add'),
          ),
        ],
      ),
    );
    ctrl.dispose();
  }
}
