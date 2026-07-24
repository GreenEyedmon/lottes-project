import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { type FormEvent, type ReactNode, useState } from 'react'
import {
  acceptInvite,
  addRoom,
  completeOccurrence,
  createChore,
  createHousehold,
  createInvite,
  getCurrentHousehold,
  type HouseholdView,
  listOccurrences,
  type TemporalStatus,
} from './api.ts'
import { authClient } from './auth-client.ts'

const input = 'rounded border border-neutral-300 p-2'
const primary = 'rounded bg-neutral-900 p-2 text-white disabled:opacity-50'

function Screen({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
      {children}
    </main>
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong'
}

export function SignIn({ callbackURL }: { callbackURL?: string }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Email addresses are case-insensitive in practice; normalize so a stray capital
  // doesn't create a second identity or trip provider-side exact-match checks.
  const normalizedEmail = email.trim().toLowerCase()

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const result = await authClient.signIn.magicLink({
      email: normalizedEmail,
      callbackURL: callbackURL ?? window.location.origin,
    })
    if (result.error) setError(result.error.message ?? 'Could not send the link')
    else setSent(true)
  }

  if (sent) {
    return (
      <Screen>
        <h1 className="font-semibold text-2xl">Check your email</h1>
        <p className="text-neutral-500 text-sm">We sent a sign-in link to {normalizedEmail}.</p>
      </Screen>
    )
  }

  return (
    <Screen>
      <h1 className="font-semibold text-2xl">Sign in to Lottes Project</h1>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          aria-label="Email address"
          className={input}
        />
        <button type="submit" className={primary}>
          Email me a sign-in link
        </button>
        {error && <p className="text-red-600 text-sm">{error}</p>}
      </form>
    </Screen>
  )
}

export function CreateHousehold() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const mutation = useMutation({
    mutationFn: () => createHousehold(name, timeZone),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['household'] }),
  })

  return (
    <Screen>
      <h1 className="font-semibold text-2xl">Create your household</h1>
      <p className="text-neutral-500 text-sm">
        Time zone: <span className="font-mono">{timeZone}</span>
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          mutation.mutate()
        }}
        className="flex flex-col gap-3"
      >
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="The Bronsveld house"
          aria-label="Household name"
          className={input}
        />
        <button type="submit" disabled={mutation.isPending} className={primary}>
          Create household
        </button>
        {mutation.error && <p className="text-red-600 text-sm">{errorMessage(mutation.error)}</p>}
      </form>
    </Screen>
  )
}

const RECURRENCE_PRESETS: { label: string; rule: Record<string, unknown> }[] = [
  { label: 'Every day', rule: { mode: 'fixedWeekly', weekdays: [1, 2, 3, 4, 5, 6, 7] } },
  { label: 'Every Monday', rule: { mode: 'fixedWeekly', weekdays: [1] } },
  { label: 'Every Saturday', rule: { mode: 'fixedWeekly', weekdays: [6] } },
  { label: 'Every 2 weeks (after done)', rule: { mode: 'completionRelative', everyDays: 14 } },
]

const STATUS_ORDER: Record<TemporalStatus, number> = { overdue: 0, due: 1, upcoming: 2 }
const STATUS_LABEL: Record<TemporalStatus, string> = {
  overdue: 'Overdue',
  due: 'Today',
  upcoming: 'Upcoming',
}

function ChoresSection() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [presetIndex, setPresetIndex] = useState(0)
  const occurrences = useQuery({ queryKey: ['occurrences'], queryFn: listOccurrences })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['occurrences'] })
  const complete = useMutation({ mutationFn: completeOccurrence, onSuccess: invalidate })
  const add = useMutation({
    mutationFn: () => createChore(name, RECURRENCE_PRESETS[presetIndex]?.rule ?? {}),
    onSuccess: () => {
      setName('')
      invalidate()
    },
  })

  const sorted = [...(occurrences.data ?? [])].sort(
    (a, b) =>
      STATUS_ORDER[a.temporalStatus] - STATUS_ORDER[b.temporalStatus] ||
      a.dueDate.localeCompare(b.dueDate),
  )

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium text-neutral-500 text-sm">Chores</h2>
      <ul className="flex flex-col gap-1">
        {sorted.map((occ) => (
          <li key={occ.id} className="flex items-center justify-between gap-2">
            <span>
              <span className={occ.temporalStatus === 'overdue' ? 'text-red-600' : ''}>
                {occ.name}
              </span>
              <span className="ml-2 text-neutral-400 text-xs">
                {STATUS_LABEL[occ.temporalStatus]}
              </span>
            </span>
            <button
              type="button"
              onClick={() => complete.mutate(occ.id)}
              className="rounded border border-neutral-300 px-2 text-sm"
            >
              Done
            </button>
          </li>
        ))}
        {sorted.length === 0 && <li className="text-neutral-400">No chores yet</li>}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          add.mutate()
        }}
        className="mt-1 flex gap-2"
      >
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Vacuum living room"
          aria-label="Chore name"
          className={`flex-1 ${input}`}
        />
        <select
          value={presetIndex}
          onChange={(e) => setPresetIndex(Number(e.target.value))}
          aria-label="Recurrence"
          className={input}
        >
          {RECURRENCE_PRESETS.map((preset, i) => (
            <option key={preset.label} value={i}>
              {preset.label}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded bg-neutral-900 px-3 text-white">
          Add
        </button>
      </form>
    </section>
  )
}

function HouseholdHome({ view }: { view: HouseholdView }) {
  const queryClient = useQueryClient()
  const [roomName, setRoomName] = useState('')
  const [inviteLink, setInviteLink] = useState<string | null>(null)

  const addRoomMutation = useMutation({
    mutationFn: () => addRoom(roomName),
    onSuccess: () => {
      setRoomName('')
      queryClient.invalidateQueries({ queryKey: ['household'] })
    },
  })
  const inviteMutation = useMutation({
    mutationFn: () => createInvite(view.household.id),
    onSuccess: (data) => setInviteLink(`${window.location.origin}/join?code=${data.code}`),
  })

  return (
    <Screen>
      <div className="flex items-center justify-between">
        <h1 className="font-semibold text-2xl">{view.household.name}</h1>
        <button
          type="button"
          onClick={() => {
            void authClient.signOut().then(() => window.location.reload())
          }}
          className="text-neutral-500 text-sm underline"
        >
          Sign out
        </button>
      </div>

      <ChoresSection />

      <section>
        <h2 className="font-medium text-neutral-500 text-sm">Members</h2>
        <ul className="mt-1">
          {view.members.map((member) => (
            <li key={member.id}>
              {member.displayName} <span className="text-neutral-400 text-xs">({member.role})</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="font-medium text-neutral-500 text-sm">Rooms</h2>
        <ul className="mt-1">
          {view.rooms.map((room) => (
            <li key={room.id}>{room.name}</li>
          ))}
          {view.rooms.length === 0 && <li className="text-neutral-400">None yet</li>}
        </ul>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            addRoomMutation.mutate()
          }}
          className="mt-2 flex gap-2"
        >
          <input
            required
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            placeholder="Kitchen"
            aria-label="New room name"
            className={`flex-1 ${input}`}
          />
          <button type="submit" className="rounded bg-neutral-900 px-3 text-white">
            Add
          </button>
        </form>
      </section>

      {view.me.role === 'owner' && (
        <section className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => inviteMutation.mutate()}
            className="rounded border border-neutral-300 p-2"
          >
            Create invite link
          </button>
          {inviteLink && (
            <p className="break-all font-mono text-neutral-600 text-xs">{inviteLink}</p>
          )}
        </section>
      )}
    </Screen>
  )
}

/** The `/` route: session-aware onboarding funnel. */
export function Home() {
  const session = authClient.useSession()
  const household = useQuery({
    queryKey: ['household'],
    queryFn: getCurrentHousehold,
    enabled: Boolean(session.data),
  })

  if (session.isPending) return <Screen>Loading…</Screen>
  if (!session.data) return <SignIn />
  if (household.isPending) return <Screen>Loading…</Screen>
  if (!household.data) return <CreateHousehold />
  return <HouseholdHome view={household.data} />
}

/** The `/join` route: accept an invite by code. */
export function Join() {
  const { code } = useSearch({ from: '/join' })
  const session = authClient.useSession()
  const navigate = useNavigate()
  const mutation = useMutation({
    mutationFn: () => acceptInvite(code),
    onSuccess: () => navigate({ to: '/' }),
  })

  if (session.isPending) return <Screen>Loading…</Screen>
  if (!session.data) return <SignIn callbackURL={`${window.location.origin}/join?code=${code}`} />

  return (
    <Screen>
      <h1 className="font-semibold text-2xl">Join a household</h1>
      {code ? (
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className={primary}
        >
          Join
        </button>
      ) : (
        <p className="text-red-600">This invite link is missing its code.</p>
      )}
      {mutation.error && <p className="text-red-600 text-sm">{errorMessage(mutation.error)}</p>}
    </Screen>
  )
}
