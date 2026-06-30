import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/service_providers.dart';
import '../../widgets/glass_button.dart';
import '../../widgets/glass_card.dart';
import '../../widgets/gradient_scaffold.dart';

class JoinCodeScreen extends ConsumerStatefulWidget {
  const JoinCodeScreen({super.key});

  @override
  ConsumerState<JoinCodeScreen> createState() => _JoinCodeScreenState();
}

class _JoinCodeScreenState extends ConsumerState<JoinCodeScreen> {
  final _ctrl = TextEditingController();
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final code = _ctrl.text.trim();
    if (code.isEmpty) {
      setState(() => _error = 'Enter a join code');
      return;
    }
    setState(() { _loading = true; _error = null; });
    try {
      await ref.read(joinCodeServiceProvider).processJoinCode(code);
    } catch (e) {
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    return GradientScaffold(
      actions: [
        TextButton(
          onPressed: () => ref.read(authServiceProvider).signOut(),
          child: Text('Sign out', style: TextStyle(color: cs.onSurface)),
        ),
      ],
      child: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 40),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: GlassCard(
                padding: const EdgeInsets.all(32),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Text('🎯', textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 40)),
                    const SizedBox(height: 12),
                    Text('Join your team',
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                              fontWeight: FontWeight.w700,
                              color: cs.onSurface,
                              letterSpacing: -0.5,
                            )),
                    const SizedBox(height: 6),
                    Text(
                      'Enter the code your captain or admin gave you',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: cs.onSurfaceVariant),
                    ),
                    const SizedBox(height: 32),
                    TextField(
                      controller: _ctrl,
                      textCapitalization: TextCapitalization.characters,
                      maxLength: 8,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 28,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 8,
                        color: cs.primary,
                      ),
                      decoration: InputDecoration(
                        labelText: 'Join code',
                        counterText: '',
                        errorText: _error,
                      ),
                      onSubmitted: (_) => _submit(),
                    ),
                    const SizedBox(height: 24),
                    GlassButton(
                      onPressed: _loading ? null : _submit,
                      loading: _loading,
                      child: const Text('Join team'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
