import 'dart:ui';
import 'package:flutter/material.dart';

class GlassButton extends StatelessWidget {
  const GlassButton({
    super.key,
    required this.onPressed,
    required this.child,
    this.loading = false,
    this.expand = true,
    this.danger = false,
  });

  final VoidCallback? onPressed;
  final Widget child;
  final bool loading;
  final bool expand;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final isDark = cs.brightness == Brightness.dark;
    final baseColor = danger ? cs.error : cs.primary;

    Widget button = ClipRRect(
      borderRadius: BorderRadius.circular(14),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: (onPressed == null || loading) ? null : onPressed,
            borderRadius: BorderRadius.circular(14),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 15),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(14),
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: (onPressed == null || loading)
                      ? [
                          cs.onSurface.withValues(alpha: 0.08),
                          cs.onSurface.withValues(alpha: 0.04),
                        ]
                      : isDark
                          ? [
                              baseColor.withValues(alpha: 0.35),
                              baseColor.withValues(alpha: 0.20),
                            ]
                          : [
                              baseColor.withValues(alpha: 0.75),
                              baseColor.withValues(alpha: 0.55),
                            ],
                ),
                border: Border.all(
                  color: (onPressed == null || loading)
                      ? cs.onSurface.withValues(alpha: 0.1)
                      : baseColor.withValues(alpha: isDark ? 0.4 : 0.3),
                  width: 1,
                ),
              ),
              child: Center(
                child: loading
                    ? SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: isDark ? baseColor : Colors.white,
                        ),
                      )
                    : DefaultTextStyle(
                        style: TextStyle(
                          color: (onPressed == null)
                              ? cs.onSurface.withValues(alpha: 0.38)
                              : isDark
                                  ? baseColor
                                  : Colors.white,
                          fontWeight: FontWeight.w600,
                          fontSize: 15,
                          letterSpacing: 0.1,
                        ),
                        child: IconTheme(
                          data: IconThemeData(
                            color: (onPressed == null)
                                ? cs.onSurface.withValues(alpha: 0.38)
                                : isDark
                                    ? baseColor
                                    : Colors.white,
                            size: 18,
                          ),
                          child: child,
                        ),
                      ),
              ),
            ),
          ),
        ),
      ),
    );

    return expand ? SizedBox(width: double.infinity, child: button) : button;
  }
}
