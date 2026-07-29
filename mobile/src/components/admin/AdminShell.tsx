import { useState, useEffect, type ReactNode } from 'react';
import { View, ScrollView, Text, Pressable } from 'react-native';
import { router, usePathname, useGlobalSearchParams } from 'expo-router';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { useColorScheme } from 'nativewind';
import { db } from '@/config/firebase';
import { Alert } from '@/lib/alert';
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
type SectionKey = 'dashboard' | WorkspaceTab | 'inbox' | 'tools' | 'venues';

function currentSection(pathname: string, tab: string | undefined): SectionKey | null {
  if (pathname.startsWith('/admin-inbox') || pathname.startsWith('/admin-dispute')) return 'inbox';
  if (pathname.startsWith('/admin-tools')) return 'tools';
  if (pathname.startsWith('/admin-venues')) return 'venues';
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
interface TeamSummary { id: string; divisionId: string }

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
  const { tab, seasonId: urlSeasonId, divisionId: urlDivisionId } = useGlobalSearchParams<{ tab?: string; seasonId?: string; divisionId?: string }>();
  const ctx = useAdminContextStore();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  const [seasons, setSeasons] = useState<SeasonSummary[]>([]);
  const [divisions, setDivisions] = useState<DivisionSummary[]>([]);
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  // Which season's division tree is open in the sidebar — an accordion, not
  // independent toggles per season, so the tree doesn't grow to list every
  // division across every season at once.
  const [expandedSeasonId, setExpandedSeasonId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingTab, setPendingTab] = useState<WorkspaceTab>('teams');
  // Season first, then that season's divisions — not one flat list of every
  // division across every season, so picking "last season" doesn't require
  // already knowing which division you want and losing track of how many
  // divisions the current season has.
  const [pickerStep, setPickerStep] = useState<'season' | 'division'>('season');
  const [pickerSeasonId, setPickerSeasonId] = useState<string | null>(null);

  useEffect(() => {
    if (!appUser?.leagueId) return;
    const onErr = (e: unknown) => Alert.alert('Error', (e as Error).message ?? 'Something went wrong');
    const unsubSeasons = onSnapshot(
      query(collection(db, 'seasons'), where('leagueId', '==', appUser.leagueId)),
      (snap) => setSeasons(snap.docs.map((d) => ({ id: d.id, name: d.data().name })).sort((a, b) => b.name.localeCompare(a.name))),
      onErr,
    );
    const unsubDivisions = onSnapshot(
      query(collection(db, 'divisions'), where('leagueId', '==', appUser.leagueId)),
      (snap) => setDivisions(snap.docs.map((d) => ({ id: d.id, name: d.data().name, seasonId: d.data().seasonId }))),
      onErr,
    );
    const unsubTeams = onSnapshot(
      query(collection(db, 'teams'), where('leagueId', '==', appUser.leagueId)),
      (snap) => setTeams(snap.docs.map((d) => ({ id: d.id, divisionId: d.data().divisionId }))),
      onErr,
    );
    return () => { unsubSeasons(); unsubDivisions(); unsubTeams(); };
  }, [appUser?.leagueId]);

  // Tracks the URL's own seasonId, not the persisted admin-context store —
  // AdminShell remounts fresh on every navigation (each admin-*.tsx screen
  // renders its own instance), so local state alone can't survive the
  // goToSeason navigation that's supposed to trigger this expansion. The
  // store is a separate "last-chosen" memory for the Fixtures/Results/
  // Standings shortcuts and is deliberately not touched here.
  useEffect(() => {
    if (urlSeasonId) setExpandedSeasonId(urlSeasonId);
  }, [urlSeasonId]);

  const currentSeasonName = seasons.find((s) => s.id === ctx.seasonId)?.name ?? null;
  const currentDivisionName = divisions.find((d) => d.id === ctx.divisionId)?.name ?? null;

  function goToTab(workspaceTab: WorkspaceTab) {
    if (ctx.seasonId && ctx.divisionId) {
      router.push(`/(protected)/admin-season?seasonId=${ctx.seasonId}&divisionId=${ctx.divisionId}&tab=${workspaceTab}` as never);
    } else {
      openPicker(workspaceTab);
    }
  }

  function openPicker(workspaceTab: WorkspaceTab) {
    setPendingTab(workspaceTab);
    // Reopening on an already-chosen season jumps straight to its division
    // list rather than making you re-pick the season every time.
    setPickerSeasonId(ctx.seasonId ?? null);
    setPickerStep(ctx.seasonId ? 'division' : 'season');
    setPickerOpen(true);
  }

  function choosePicker(seasonId: string, divisionId: string) {
    ctx.setContext(seasonId, divisionId);
    setPickerOpen(false);
    router.push(`/(protected)/admin-season?seasonId=${seasonId}&divisionId=${divisionId}&tab=${pendingTab}` as never);
  }

  // Clicking a season row opens its division tree and takes you to that
  // season's own management screen (add/delete divisions, delete season) —
  // distinct from a division row, which drops straight into that division's
  // Teams tab.
  function goToSeason(seasonId: string) {
    setExpandedSeasonId(seasonId);
    router.push(`/(protected)/admin-season?seasonId=${seasonId}` as never);
  }

  function goToDivisionInSeason(seasonId: string, divisionId: string) {
    ctx.setContext(seasonId, divisionId);
    setExpandedSeasonId(seasonId);
    router.push(`/(protected)/admin-season?seasonId=${seasonId}&divisionId=${divisionId}&tab=teams` as never);
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

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }}>
          <SidebarRow
            icon="home"
            label="Dashboard"
            active={section === 'dashboard'}
            onPress={() => router.push('/(protected)/(tabs)/admin')}
          />

          <SectionLabel>League Structure</SectionLabel>
          {seasons.length === 0 ? (
            <Text style={{ fontFamily: FONT_BODY, color: '#6B7080', fontSize: 12.5, paddingHorizontal: 16 }}>
              No seasons yet
            </Text>
          ) : (
            seasons.map((season) => {
              const seasonDivisions = divisions.filter((d) => d.seasonId === season.id);
              const expanded = expandedSeasonId === season.id;
              const seasonActive = section === 'teams' && urlSeasonId === season.id && !urlDivisionId;
              return (
                <View key={season.id}>
                  <SidebarRow
                    icon="calendar"
                    label={season.name}
                    active={seasonActive}
                    trailing={
                      <View className="flex-row items-center gap-1">
                        <Text style={{ fontFamily: FONT_BODY, color: '#8189A0', fontSize: 10.5 }}>{seasonDivisions.length}</Text>
                        <AppIcon name={expanded ? 'chevron-down' : 'chevron-right'} size={12} color="#6B7080" />
                      </View>
                    }
                    onPress={() => goToSeason(season.id)}
                  />
                  {expanded && seasonDivisions.length > 0 && (
                    <View style={{ marginLeft: 26, marginTop: 2, marginBottom: 2, borderLeftWidth: 1, borderLeftColor: '#262A35', paddingLeft: 12, gap: 1 }}>
                      {seasonDivisions.map((division) => {
                        const teamCount = teams.filter((t) => t.divisionId === division.id).length;
                        const active = section === 'teams' && urlSeasonId === season.id && urlDivisionId === division.id;
                        return (
                          <Pressable
                            key={division.id}
                            onPress={() => goToDivisionInSeason(season.id, division.id)}
                            className="flex-row items-center justify-between"
                            style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6 }}
                          >
                            <Text
                              numberOfLines={1}
                              style={{ fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: active ? '700' : '500', color: active ? RAW.textDark : '#8189A0', flex: 1 }}
                            >
                              {division.name}
                            </Text>
                            <Text style={{ fontFamily: FONT_BODY, color: '#8189A0', fontSize: 10.5, marginLeft: 6 }}>{teamCount}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })
          )}

          <SectionLabel>Competition</SectionLabel>
          <SidebarRow icon="calendar" label="Fixtures" active={section === 'fixtures'} onPress={() => goToTab('fixtures')} />
          <SidebarRow icon="check" label="Results" active={section === 'results'} onPress={() => goToTab('results')} />
          <SidebarRow icon="trending-up" label="Standings" active={section === 'standings'} onPress={() => goToTab('standings')} />

          <SectionLabel>Support</SectionLabel>
          <SidebarRow icon="zap" label="Inbox" active={section === 'inbox'} onPress={() => router.push('/(protected)/admin-inbox')} />
          <SidebarRow icon="map-pin" label="Venues" active={section === 'venues'} onPress={() => router.push('/(protected)/admin-venues' as never)} />
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
          {/* Season/division switcher — only meaningful on the workspace tabs
              it actually governs, moved here from a permanent sidebar box so
              it reads as a filter on the page you're looking at, not a
              standing app-wide setting. */}
          {(section === 'teams' || section === 'fixtures' || section === 'results' || section === 'standings') && (
            <Pressable
              onPress={() => openPicker(section as WorkspaceTab)}
              className="flex-row items-center gap-1.5 px-3 py-2 mr-3 rounded-xl border border-admin-panel-border dark:border-admin-panel-border-dark bg-surface-2 dark:bg-surface-2-dark"
            >
              <Text
                numberOfLines={1}
                className="text-text dark:text-text-dark"
                style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: '600', maxWidth: 220 }}
              >
                {currentSeasonName && currentDivisionName ? `${currentSeasonName} · ${currentDivisionName}` : 'Choose a season'}
              </Text>
              <AppIcon name="chevron-down" size={13} color={isDark ? RAW.textFaintDark : RAW.textFaint} />
            </Pressable>
          )}
          {actions}
        </View>
        <ScrollView contentContainerStyle={{ padding: 32 }}>
          {children}
        </ScrollView>
      </View>

      {/* Season/division picker — season first, then that season's divisions */}
      <Sheet visible={pickerOpen} onClose={() => setPickerOpen(false)}>
        {pickerStep === 'season' ? (
          <>
            <Heading size="lg" className="mb-4">Choose Season</Heading>
            <ScrollView style={{ maxHeight: 420 }}>
              {seasons.length === 0 ? (
                <Caption>No seasons yet — create one from the Dashboard first.</Caption>
              ) : (
                <View className="gap-1.5">
                  {seasons.map((season) => {
                    const count = divisions.filter((d) => d.seasonId === season.id).length;
                    return (
                      <Pressable
                        key={season.id}
                        onPress={() => { setPickerSeasonId(season.id); setPickerStep('division'); }}
                        className="flex-row items-center justify-between px-3 py-3 rounded-xl bg-surface-2 dark:bg-surface-2-dark"
                      >
                        <Body tone="strong" weight="semibold">{season.name}</Body>
                        <View className="flex-row items-center gap-1.5">
                          <Caption>{count} division{count === 1 ? '' : 's'}</Caption>
                          <AppIcon name="chevron-right" size={14} color={isDark ? RAW.textFaintDark : RAW.textFaint} />
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </ScrollView>
          </>
        ) : (
          <>
            <Pressable onPress={() => setPickerStep('season')} className="flex-row items-center gap-1 mb-3">
              <AppIcon name="chevron-left" size={14} color={isDark ? RAW.brandInkDark : RAW.brandInk} />
              <Body tone="brand" weight="semibold">All Seasons</Body>
            </Pressable>
            <Heading size="lg" className="mb-4">{seasons.find((s) => s.id === pickerSeasonId)?.name ?? 'Choose Division'}</Heading>
            <ScrollView style={{ maxHeight: 420 }}>
              {(() => {
                const seasonDivisions = divisions.filter((d) => d.seasonId === pickerSeasonId);
                return seasonDivisions.length === 0 ? (
                  <Caption>No divisions yet in this season.</Caption>
                ) : (
                  <View className="gap-1.5">
                    {seasonDivisions.map((division) => {
                      const selected = ctx.seasonId === pickerSeasonId && ctx.divisionId === division.id;
                      return (
                        <Pressable
                          key={division.id}
                          onPress={() => choosePicker(pickerSeasonId as string, division.id)}
                          className={['px-3 py-2.5 rounded-xl', selected ? 'bg-brand-fill dark:bg-brand-fill-dark' : 'bg-surface-2 dark:bg-surface-2-dark'].join(' ')}
                        >
                          <Body tone={selected ? 'brand' : 'strong'} weight="semibold">{division.name}</Body>
                        </Pressable>
                      );
                    })}
                  </View>
                );
              })()}
            </ScrollView>
          </>
        )}
      </Sheet>
    </View>
  );
}
