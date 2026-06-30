import 'package:flutter/material.dart';

const _primary = Color(0xFF7B8CDE);
const _secondary = Color(0xFFB8A9D9);
const _tertiary = Color(0xFF9BC4CB);

class AppTheme {
  static ThemeData light() {
    final base = ColorScheme.fromSeed(
      seedColor: _primary,
      brightness: Brightness.light,
      primary: _primary,
      secondary: _secondary,
      tertiary: _tertiary,
      surface: const Color(0xFFF8F8FF),
      surfaceContainerLowest: Colors.white,
      surfaceContainerLow: const Color(0xFFF0F0FA),
      surfaceContainer: const Color(0xFFE8E8F5),
    );
    return _build(base);
  }

  static ThemeData dark() {
    final base = ColorScheme.fromSeed(
      seedColor: _primary,
      brightness: Brightness.dark,
      primary: const Color(0xFF9DAAE8),
      secondary: const Color(0xFFC5B8E8),
      tertiary: const Color(0xFFADD4DB),
      surface: const Color(0xFF0F0F1A),
      surfaceContainerLowest: const Color(0xFF0A0A14),
      surfaceContainerLow: const Color(0xFF14142A),
      surfaceContainer: const Color(0xFF1C1C35),
    );
    return _build(base);
  }

  static ThemeData _build(ColorScheme cs) => ThemeData(
        useMaterial3: true,
        colorScheme: cs,
        scaffoldBackgroundColor: cs.surface,
        appBarTheme: AppBarTheme(
          backgroundColor: Colors.transparent,
          foregroundColor: cs.onSurface,
          elevation: 0,
          centerTitle: false,
          titleTextStyle: TextStyle(
            color: cs.onSurface,
            fontSize: 20,
            fontWeight: FontWeight.w600,
            letterSpacing: -0.3,
          ),
        ),
        cardTheme: CardThemeData(
          color: cs.surfaceContainerLow,
          elevation: 0,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          margin: EdgeInsets.zero,
        ),
        filledButtonTheme: FilledButtonThemeData(
          style: FilledButton.styleFrom(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
            textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
          ),
        ),
        outlinedButtonTheme: OutlinedButtonThemeData(
          style: OutlinedButton.styleFrom(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
          ),
        ),
        textButtonTheme: TextButtonThemeData(
          style: TextButton.styleFrom(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          ),
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: cs.surfaceContainer,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide.none,
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide.none,
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide(color: cs.primary, width: 1.5),
          ),
          errorBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide(color: cs.error, width: 1.5),
          ),
          contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          labelStyle: TextStyle(color: cs.onSurfaceVariant),
        ),
        chipTheme: ChipThemeData(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        ),
        listTileTheme: const ListTileThemeData(
          contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 4),
        ),
        dividerTheme: DividerThemeData(
          color: cs.outlineVariant.withValues(alpha: 0.5),
          thickness: 1,
        ),
        snackBarTheme: SnackBarThemeData(
          behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
      );
}
