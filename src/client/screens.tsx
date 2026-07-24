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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong'
}

/** Full-height, centered wrapper on the app background. */
function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-base-200 p-4">
      <div className="w-full max-w-md">{children}</div>
    </div>
  )
}

/** A centered card with a title — the shell for auth / onboarding screens. */
function CardScreen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Centered>
      <div className="card border border-base-300 bg-base-100 shadow-xl">
        <div className="card-body gap-4">
          <h1 className="card-title text-2xl">{title}</h1>
          {children}
        </div>
      </div>
    </Centered>
  )
}

function LoadingScreen() {
  return (
    <Centered>
      <div className="flex justify-center">
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    </Centered>
  )
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card border border-base-300 bg-base-100 shadow-sm">
      <div className="card-body gap-3 p-5">
        <h2 className="font-semibold text-base-content/60 text-sm uppercase tracking-wide">
          {title}
        </h2>
        {children}
      </div>
    </div>
  )
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
      <CardScreen title="Check your email">
        <p className="text-base-content/70">
          We sent a sign-in link to <span className="font-medium">{normalizedEmail}</span>.
        </p>
      </CardScreen>
    )
  }

  return (
    <CardScreen title="Sign in to Lottes Project">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          aria-label="Email address"
          className="input input-bordered w-full"
        />
        <button type="submit" className="btn btn-primary">
          Email me a sign-in link
        </button>
        {error && <p className="text-error text-sm">{error}</p>}
      </form>
    </CardScreen>
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
    <CardScreen title="Create your household">
      <p className="text-base-content/60 text-sm">
        Time zone: <span className="badge badge-ghost font-mono">{timeZone}</span>
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
          className="input input-bordered w-full"
        />
        <button type="submit" disabled={mutation.isPending} className="btn btn-primary">
          {mutation.isPending && <span className="loading loading-spinner loading-sm" />}
          Create household
        </button>
        {mutation.error && <p className="text-error text-sm">{errorMessage(mutation.error)}</p>}
      </form>
    </CardScreen>
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
const STATUS_BADGE: Record<TemporalStatus, string> = {
  overdue: 'badge-error',
  due: 'badge-warning',
  upcoming: 'badge-ghost',
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
    <Card title="Chores">
      {sorted.length === 0 ? (
        <p className="text-base-content/50 text-sm">No chores yet — add your first below.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-base-200">
          {sorted.map((occ) => (
            <li key={occ.id} className="flex items-center justify-between gap-3 py-2">
              <span className="flex items-center gap-2">
                <span className={`badge badge-sm ${STATUS_BADGE[occ.temporalStatus]}`}>
                  {STATUS_LABEL[occ.temporalStatus]}
                </span>
                <span className="font-medium">{occ.name}</span>
              </span>
              {occ.temporalStatus !== 'upcoming' && (
                <button
                  type="button"
                  onClick={() => complete.mutate(occ.id)}
                  className="btn btn-primary btn-sm"
                >
                  Done
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          add.mutate()
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Vacuum living room"
          aria-label="Chore name"
          className="input input-bordered input-sm flex-1"
        />
        <select
          value={presetIndex}
          onChange={(e) => setPresetIndex(Number(e.target.value))}
          aria-label="Recurrence"
          className="select select-bordered select-sm"
        >
          {RECURRENCE_PRESETS.map((preset, i) => (
            <option key={preset.label} value={i}>
              {preset.label}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-neutral btn-sm">
          Add
        </button>
      </form>
    </Card>
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
    <div className="min-h-dvh bg-base-200">
      <div className="mx-auto flex max-w-lg flex-col gap-4 p-4">
        <header className="flex items-center justify-between py-2">
          <h1 className="font-bold text-2xl">{view.household.name}</h1>
          <button
            type="button"
            onClick={() => {
              void authClient.signOut().then(() => window.location.reload())
            }}
            className="btn btn-ghost btn-sm"
          >
            Sign out
          </button>
        </header>

        <ChoresSection />

        <Card title="Members">
          <ul className="flex flex-col gap-1">
            {view.members.map((member) => (
              <li key={member.id} className="flex items-center gap-2">
                <span className="font-medium">{member.displayName}</span>
                <span className="badge badge-ghost badge-sm">{member.role}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Rooms">
          {view.rooms.length === 0 ? (
            <p className="text-base-content/50 text-sm">None yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {view.rooms.map((room) => (
                <span key={room.id} className="badge badge-lg badge-outline">
                  {room.name}
                </span>
              ))}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              addRoomMutation.mutate()
            }}
            className="flex gap-2"
          >
            <input
              required
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder="Kitchen"
              aria-label="New room name"
              className="input input-bordered input-sm flex-1"
            />
            <button type="submit" className="btn btn-neutral btn-sm">
              Add
            </button>
          </form>
        </Card>

        {view.me.role === 'owner' && (
          <Card title="Invite">
            <button
              type="button"
              onClick={() => inviteMutation.mutate()}
              className="btn btn-outline btn-sm w-fit"
            >
              Create invite link
            </button>
            {inviteLink && (
              <div className="join w-full">
                <input
                  readOnly
                  value={inviteLink}
                  aria-label="Invite link"
                  className="input input-bordered input-sm join-item flex-1 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => void navigator.clipboard?.writeText(inviteLink)}
                  className="btn btn-neutral btn-sm join-item"
                >
                  Copy
                </button>
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
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

  if (session.isPending) return <LoadingScreen />
  if (!session.data) return <SignIn />
  if (household.isPending) return <LoadingScreen />
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

  if (session.isPending) return <LoadingScreen />
  if (!session.data) return <SignIn callbackURL={`${window.location.origin}/join?code=${code}`} />

  return (
    <CardScreen title="Join a household">
      {code ? (
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="btn btn-primary"
        >
          {mutation.isPending && <span className="loading loading-spinner loading-sm" />}
          Join
        </button>
      ) : (
        <p className="text-error">This invite link is missing its code.</p>
      )}
      {mutation.error && <p className="text-error text-sm">{errorMessage(mutation.error)}</p>}
    </CardScreen>
  )
}
