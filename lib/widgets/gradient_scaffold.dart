import 'package:flutter/material.dart';
import 'glass_drawer.dart';

class GradientScaffold extends StatelessWidget {
  const GradientScaffold({
    super.key,
    required this.child,
    this.actions,
    this.title,
    this.floatingActionButton,
    this.bottomNavigationBar,
    this.showDrawer = false,
    this.scaffoldKey,
  });

  final Widget child;
  final List<Widget>? actions;
  final Widget? title;
  final Widget? floatingActionButton;
  final Widget? bottomNavigationBar;
  final bool showDrawer;
  final GlobalKey<ScaffoldState>? scaffoldKey;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final isDark = cs.brightness == Brightness.dark;

    final gradientColors = isDark
        ? [
            const Color(0xFF0F0F1A),
            const Color(0xFF1A1535),
            const Color(0xFF0D1A2E),
          ]
        : [
            const Color(0xFFDFE4F8),
            const Color(0xFFEDE9F7),
            const Color(0xFFD9EEF2),
          ];

    return Scaffold(
      key: scaffoldKey,
      backgroundColor: Colors.transparent,
      extendBodyBehindAppBar: true,
      drawer: showDrawer ? const GlassDrawer() : null,
      appBar: (actions != null || title != null || showDrawer)
          ? AppBar(
              backgroundColor: Colors.transparent,
              title: title,
              actions: actions,
              elevation: 0,
              leading: showDrawer
                  ? Builder(builder: (ctx) => IconButton(
                        icon: const Icon(Icons.menu),
                        onPressed: () => Scaffold.of(ctx).openDrawer(),
                      ))
                  : null,
              automaticallyImplyLeading: !showDrawer,
            )
          : null,
      floatingActionButton: floatingActionButton,
      bottomNavigationBar: bottomNavigationBar,
      body: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: gradientColors,
            stops: const [0.0, 0.5, 1.0],
          ),
        ),
        child: child,
      ),
    );
  }
}
