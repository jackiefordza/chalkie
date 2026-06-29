import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../widgets/glass_card.dart';
import '../../widgets/gradient_scaffold.dart';

class PlayerHomeScreen extends ConsumerWidget {
  const PlayerHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cs = Theme.of(context).colorScheme;

    return GradientScaffold(
      showDrawer: true,
      title: const Text('Chalkie'),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: GlassCard(
            child: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.sports_bar_outlined, size: 48, color: cs.onSurfaceVariant),
                  const SizedBox(height: 12),
                  Text('Player home coming soon',
                      style: TextStyle(color: cs.onSurfaceVariant, fontWeight: FontWeight.w500)),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
