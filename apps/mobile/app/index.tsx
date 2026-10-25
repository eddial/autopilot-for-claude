import { Redirect } from 'expo-router'
import { useSyncInstance } from '../src/store.ts'

/** Where the app opens: the queue once paired with a Mac, pairing before that. */
export default function Index() {
  return <Redirect href={useSyncInstance() === null ? '/pair' : '/queue'} />
}
