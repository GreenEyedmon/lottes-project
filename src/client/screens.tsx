import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { type FormEvent, type ReactNode, useState } from 'react'
import {
  acceptInvite,
  addRoom,
  createHousehold,
  createInvite,
  getCurrentHousehold,
  type HouseholdView,
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

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const result = await authClient.signIn.magicLink({
      email,
      callbackURL: callbackURL ?? window.location.origin,
    })
    if (result.error) setError(result.error.message ?? 'Could not send the link')
    else setSent(true)
  }

  if (sent) {
    return (
      <Screen>
        <h1 className="font-semibold text-2xl">Check your email</h1>
        <p className="text-neutral-500 text-sm">We sent a sign-in link to {email}.</p>
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
