import { useState } from 'react';
import { View, ScrollView, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { Stack } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';
import { goBack } from '@/lib/navigation';
import { Screen, AppBar, Card, Label, Input, Button, Body } from '@/components/ui';

export default function EditProfileScreen() {
  const { appUser, updateProfileDetails } = useAuthStore();
  const [name, setName] = useState(appUser?.displayName ?? '');
  const [nickname, setNickname] = useState(appUser?.nickname ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!name.trim()) { setError('Enter your name'); return; }
    setError(null);
    setIsSaving(true);
    try {
      await updateProfileDetails(name.trim(), nickname.trim() || null);
      goBack();
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Something went wrong');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Screen scroll={false} header={<AppBar title="Edit Profile" />}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
          <Card>
            {error ? (
              <Card tone="coral" className="mb-4" padded={false}>
                <Body tone="coral" className="p-3">{error}</Body>
              </Card>
            ) : null}

            <View className="mb-3.5">
              <Label>Full name</Label>
              <Input value={name} onChangeText={setName} placeholder="Jane Smith" autoCapitalize="words" autoCorrect={false} />
            </View>

            <View className="mb-5">
              <Label>Darts nickname (optional)</Label>
              <Input value={nickname} onChangeText={setNickname} placeholder={'e.g. "The Machine"'} autoCapitalize="words" autoCorrect={false} />
            </View>

            <Button onPress={handleSave} disabled={isSaving || !name.trim()} loading={isSaving}>
              Save
            </Button>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
