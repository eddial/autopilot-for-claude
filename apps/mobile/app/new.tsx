import { useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import type { Workstream } from '@autopilot/contracts'
import { router, Stack } from 'expo-router'
import KV from 'expo-sqlite/kv-store'
import { titleCase } from '../src/format.ts'
import { useDraft } from '../src/drafts.ts'
import { useSyncInstance } from '../src/store.ts'
import { colours } from '@autopilot/design'
import { Chip, Sides, type } from '../src/ui.tsx'

const PRIORITIES = [
  { value: 1, label: 'Urgent' },
  { value: 2, label: 'High' },
  { value: 3, label: 'Normal' },
  { value: 4, label: 'Low' },
]

/** New task, as a sheet. Works offline: it waits in the outbox and reaches the Mac later. */
export default function NewTaskScreen() {
  const sync = useSyncInstance()
  const [title, setTitle] = useDraft('new:title')
  const [brief, setBrief] = useDraft('new:brief')
  const [workstream, setWorkstream] = useState<string | null>(null)
  const [priority, setPriority] = useState(3)
  const [start, setStart] = useState(true)
  const [workstreams, setWorkstreams] = useState<Workstream[]>([])

  // The last list seen online, so picking a workstream works offline too.
  useEffect(() => {
    void KV.getItem('autopilot.workstreams').then((cached) => cached && setWorkstreams(JSON.parse(cached) as Workstream[]))
    void sync
      ?.online((api) => api.workstreams.list())
      .then((list) => {
        setWorkstreams(list)
        void KV.setItem('autopilot.workstreams', JSON.stringify(list))
      })
      .catch(() => {})
  }, [sync])

  const create = () => {
    if (!sync || !title.trim()) return
    void sync.send({
      kind: 'create',
      title: title.trim().slice(0, 120),
      brief: brief.trim(),
      start,
      priority,
      ...(workstream ? { workstream } : {}),
    })
    setTitle('')
    setBrief('')
    router.back()
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: 'New task',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colours.surface },
          headerTitleStyle: { color: colours.text },
        }}
      />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Cancel" onPress={() => router.back()} />
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          variant="prominent"
          tintColor={colours.pilot}
          icon="arrow.up"
          accessibilityLabel={start ? 'Create and start' : 'Save'}
          disabled={!title.trim()}
          onPress={create}
        />
      </Stack.Toolbar>
      <Sides colour={colours.surface}>
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <TextInput
            style={styles.title}
            placeholder="What needs doing, starting with a verb"
            placeholderTextColor={colours.text3}
            value={title}
            onChangeText={setTitle}
            maxLength={120}
            autoFocus
            accessibilityLabel="Title"
          />
          <TextInput
            style={styles.brief}
            placeholder="The brief: what you know, what to use, what not to do."
            placeholderTextColor={colours.text3}
            value={brief}
            onChangeText={setBrief}
            multiline
            accessibilityLabel="Brief"
          />
          <Text style={[type.meta, styles.label]}>Workstream</Text>
          <View style={styles.chips}>
            <Chip label="Inbox" on={workstream === null} onPress={() => setWorkstream(null)} />
            {workstreams
              .filter((w) => w.name !== 'autopilot')
              .map((w) => (
                <Chip key={w.name} label={titleCase(w.name)} on={workstream === w.name} onPress={() => setWorkstream(w.name)} />
              ))}
          </View>
          <Text style={[type.meta, styles.label]}>Priority</Text>
          <View style={styles.chips}>
            {PRIORITIES.map((p) => (
              <Chip key={p.value} label={p.label} on={priority === p.value} onPress={() => setPriority(p.value)} />
            ))}
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.switchText}>Start a session right away</Text>
            <Switch value={start} onValueChange={setStart} trackColor={{ true: colours.pilot }} />
          </View>
        </ScrollView>
      </Sides>
    </>
  )
}

const styles = StyleSheet.create({
  form: { padding: 20, gap: 12 },
  title: { fontSize: 18, fontWeight: '600', color: colours.text, paddingVertical: 8 },
  brief: { minHeight: 120, fontSize: 16, lineHeight: 22, color: colours.text2, textAlignVertical: 'top' },
  label: { marginTop: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  switchRow: { marginTop: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  switchText: { fontSize: 15, color: colours.textBody },
})
