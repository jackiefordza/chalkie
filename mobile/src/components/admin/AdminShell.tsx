import { useState, useEffect, type ReactNode } from 'react';
import { View, ScrollView, Text, Pressable } from 'react-native';
import { router, usePathname, useGlobalSearchParams } from 'expo-router';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { useAdminContextStore } from '@/stores/adminContextStore';
import { AppIcon, Heading, Body, Caption, Badge, Sheet, type AppIconName } from '@/components/ui';
import { RAW } from '@/lib/theme';
import { FONT_DISPLAY, FONT_BODY } from '@/styles/typography';

// Desktop-only admin console shell — deliberately a different visual world
// from the app's warm branded mobile cards (dark slate sidebar + cool
// neutral canvas) so the web admin surface reads as a console, not a
// stretched phone screen. Each admin-*.tsx screen renders this only at
// isDesktop width and keeps its existing mobile layout below 768px.
//
// The sidebar is a fixed dark slate regardless of the app's own light/dark
// theme toggle (same convention as most desktop admin tools), so its text
// uses plain RN Text + inline styles rather than the shared Heading/Body/
// Caption components — those hardcode `dark:` variants keyed to the app's
// color scheme, which would fight a background that never changes with it.

type WorkspaceTab = 'teams' | 'fixtures' | 'results' | 'standings';
type SectionKey = 'dashboard' | WorkspaceTab | 'inbox' | 'tools';

function currentSection(pathname: string, tab: string | undefined): SectionKey | null {
  if (pathname.startsWith('/admin-inbox') || pathname.startsWith('/admin-dispute')) return 'inbox';
  if (pathname.startsWith('/admin-tools')) return 'tools';
  if (pathname.startsWith('/admin-team')) return 'teams';
  if (pathname.startsWith('/results-entry')) return 'results';
  if (pathname.startsWith('/admin-season')) {
    if (tab === 'fixtures') return 'fixtures';
    if (tab === 'results') return 'results';
    if (tab === 'standings') return 'standings';
    return 'teams';
  }
  if (pathname.startsWith('/admin')) return 'dashboard';
  return null;
}

interface SeasonSummary { id: string; name: string }
interface DivisionSummary { id: string; name: string; seasonId: string }

interface SidebarRowProps {
  icon?: AppIconName;
  label: string;
  active: boolean;
  trailing?: ReactNode;
  onPress: () => void;
}

function SidebarRow({ icon, label, active, trailing, onPress }: SidebarRowProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      className={['flex-row items-center gap-3 mx-3 rounded-xl', active ? 'bg-admin-sidebar-active' : hovered ? 'bg-white/10' : ''].join(' ')}
      style={{ paddingVertical: 9, paddingLeft: active ? 9 : 12, paddingRight: 12, borderLeftWidth: active ? 3 : 0, borderLeftColor: RAW.sageInkDark }}
    >
      {icon && <AppIcon name={icon} size={16} color={active ? RAW.textDark : RAW.textFaintDark} />}
      <Text style={{ flex: 1, fontFamily: FONT_BODY, color: active ? RAW.textDark : '#D3D7E0', fontSize: 13, fontWeight: active ? '700' : '500' }}>
        {label}
      </Text>
      {trailing}
    </Pressable>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Text style={{ fontFamily: FONT_BODY, color: '#6B7080', fontSize: 10.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 20, marginBottom: 6, paddingHorizontal: 16 }}>
      {children}
    </Text>
  );
}

export interface Crumb { label: string; path?: string }

interface AdminShellProps {
  leagueName?: string;
  title: string;
  breadcrumb?: Crumb[];
  actions?: ReactNode;
  children: ReactNode;
}

export function AdminShell({ leagueName, title, breadcrumb, actions, children }: AdminShellProps) {
  const { appUser, logOut } = useAuthStore();
  const pathname = usePathname();
  const { tab } = useGlobalSearchParams<{ tab?: string }>();
  const ctx = useAdminContextStore();

  const [seasons, setSeasons] = useState<SeasonSummary[]>([]);
  const [divisions, setDivisions] = useState<DivisionSummary[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingTab, setPendingTab] = useState<WorkspaceTab>('teams');

  useEffect(() => {
    if (!appUser?.leagueId) return;
    const unsubSeasons = onSnapshot(
      query(collection(db, 'seasons'), where('leagueId', '==', appUser.leagueId)),
      (snap) => setSeasons(snap.docs.map((d) => ({ id: d.id, name: d.data().name })).sort((a, b) => b.name.localeCompare(a.name))),
    );
    const unsubDivisions = onSnapshot(
      query(collection(db, 'divisions'), where('leagueId', '==', appUser.leagueId)),
      (snap) => setDivisions(snap.docs.map((d) => ({ id: d.id, name: d.data().name, seasonId: d.data().seasonId }))),
    );
    return () => { unsubSeasons(); unsubDivisions(); };
  }, [appUser?.leagueId]);

  const currentSeasonName = seasons.find((s) => s.id === ctx.seasonId)?.name ?? null;
  const currentDivisionName = divisions.find((d) => d.id === ctx.divisionId)?.name ?? null;

  function goToTab(workspaceTab: WorkspaceTab) {
    if (ctx.seasonId && ctx.divisionId) {
      router.push(`/(protected)/admin-season?seasonId=${ctx.seasonId}&divisionId=${ctx.divisionId}&tab=${workspaceTab}` as never);
    } else {
      setPendingTab(workspaceTab);
      setPickerOpen(true);
    }
  }

  function choosePicker(seasonId: string, divisionId: string) {
    ctx.setContext(seasonId, divisionId);
    setPickerOpen(false);
    router.push(`/(protected)/admin-season?seasonId=${seasonId}&divisionId=${divisionId}&tab=${pendingTab}` as never);
  }

  const section = currentSection(pathname, tab);

  return (
    <View className="flex-1 flex-row bg-admin-canvas dark:bg-admin-canvas-dark">
      {/* Sidebar — fixed dark slate, intentionally theme-independent */}
      <View className="w-64 bg-admin-sidebar border-r border-admin-sidebar-border" style={{ paddingTop: 28, paddingBottom: 12 }}>
        <View className="px-5 mb-4">
          <Text style={{ fontFamily: FONT_BODY, color: '#6B7080', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 }}>
            Your League
          </Text>
          <Text
            numberOfLines={1}
            style={{ fontFamily: FONT_DISPLAY, color: RAW.textDark, fontSize: 16, marginTop: 2 }}
          >
            {leagueName || 'Chalkie Admin'}
          </Text>
          <Badge tone="brand" className="self-start mt-2">Admin</Badge>
        </View>

        {/* Context switcher — always-visible, one tap to change which season/
            division Teams/Fixtures/Results/Standings point at, replacing the
            old "guess the active season" shortcut logic. */}
        <Pressable
          onPress={() => { setPendingTab('teams'); setPickerOpen(true); }}
          className="mx-3 mb-3 px-3 py-2.5 rounded-xl border border-admin-sidebar-border bg-white/5"
        >
          <Text style={{ fontFamily: FONT_BODY, color: '#8189A0', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Working In
          </Text>
          <View className="flex-row items-center mt-1">
            <Text numberOfLines={1} style={{ flex: 1, fontFamily: FONT_BODY, color: RAW.textDark, fontSize: 13, fontWeight: '600' }}>
              {currentSeasonName && currentDivisionName ? `${currentSeasonName} · ${currentDivisionName}` : 'Choose a season'}
            </Text>
            <AppIcon name="chevron-down" size={13} color="#8189A0" />
          </View>
        </Pressable>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }}>
          <SidebarRow
            icon="home"
            label="Dashboard"
            active={section === 'dashboard'}
            onPress={() => router.push('/(protected)/(tabs)/admin')}
          />

          <SectionLabel>Manage</SectionLabel>
          <SidebarRow icon="users" label="Teams" active={section === 'teams'} onPress={() => goToTab('teams')} />
          <SidebarRow icon="calendar" label="Fixtures" active={section === 'fixtures'} onPress={() => goToTab('fixtures')} />
          <SidebarRow icon="check" label="Results" active={section === 'results'} onPress={() => goToTab('results')} />
          <SidebarRow icon="trending-up" label="Standings" active={section === 'standings'} onPress={() => goToTab('standings')} />

          <SectionLabel>Support</SectionLabel>
          <SidebarRow icon="zap" label="Inbox" active={section === 'inbox'} onPress={() => router.push('/(protected)/admin-inbox')} />
          <SidebarRow icon="settings" label="Tools" active={section === 'tools'} onPress={() => router.push('/(protected)/admin-tools')} />
        </ScrollView>

        <Pressable onPress={logOut} className="flex-row items-center gap-3 px-8 py-4 border-t border-admin-sidebar-border">
          <AppIcon name="log-out" size={16} color="#8189A0" />
          <Text style={{ fontFamily: FONT_BODY, color: '#8189A0', fontSize: 13 }}>Sign Out</Text>
        </Pressable>
      </View>

      {/* Main content — respects the app's normal light/dark theme */}
      <View className="flex-1">
        <View className="flex-row items-center px-8 py-5 bg-admin-panel dark:bg-admin-panel-dark border-b border-admin-panel-border dark:border-admin-panel-border-dark">
          <View className="flex-1">
            {breadcrumb && breadcrumb.length > 0 && (
              <View className="flex-row items-center flex-wrap mb-0.5">
                {breadcrumb.map((crumb, i) => (
                  <View key={i} className="flex-row items-center">
                    {i > 0 && <Caption className="mx-1.5">›</Caption>}
                    {crumb.path ? (
                      <Pressable onPress={() => router.push(crumb.path as never)}>
                        <Caption className="text-brand-ink dark:text-brand-ink-dark">{crumb.label}</Caption>
                      </Pressable>
                    ) : (
                      <Caption>{crumb.label}</Caption>
                    )}
                  </View>
                ))}
              </View>
            )}
            <Heading size="lg">{title}</Heading>
          </View>
          {actions}
        </View>
        <ScrollView contentContainerStyle={{ padding: 32 }}>
          {children}
        </ScrollView>
      </View>

      {/* Season/division picker */}
      <Sheet visible={pickerOpen} onClose={() => setPickerOpen(false)}>
        <Heading size="lg" className="mb-4">Choose Season &amp; Division</Heading>
        <ScrollView style={{ maxHeight: 420 }}>
          {seasons.length === 0 ? (
            <Caption>No seasons yet — create one from the Dashboard first.</Caption>
          ) : (
            seasons.map((season) => {
              const seasonDivisions = divisions.filter((d) => d.seasonId === season.id);
              return (
                <View key={season.id} className="mb-4">
                  <Caption className="mb-1.5">{season.name}</Caption>
                  {seasonDivisions.length === 0 ? (
                    <Caption className="opacity-60">No divisions yet</Caption>
                  ) : (
                    <View className="gap-1.5">
                      {seasonDivisions.map((division) => {
                        const selected = ctx.seasonId === season.id && ctx.divisionId === division.id;
                        return (
                          <Pressable
                            key={division.id}
                            onPress={() => choosePicker(season.id, division.id)}
                            className={['px-3 py-2.5 rounded-xl', selected ? 'bg-brand-fill dark:bg-brand-fill-dark' : 'bg-surface-2 dark:bg-surface-2-dark'].join(' ')}
                          >
                            <Body tone={selected ? 'brand' : 'strong'} weight="semibold">{division.name}</Body>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      </Sheet>
    </View>
  );
}
