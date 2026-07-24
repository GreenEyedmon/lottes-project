import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { type FormEvent, type ReactNode, useState } from 'react'
import { CATALOG, describeRecurrence } from '../shared/chore/catalog.ts'
import {
  acceptInvite,
  addCatalogChore,
  addRoom,
  type CatalogChoreInput,
  claimOccurrence,
  completeOccurrence,
  createChore,
  createHousehold,
  createInvite,
  createTask,
  getCurrentHousehold,
  getHistory,
  type HistoryWindow,
  type HouseholdView,
  listOccurrences,
  type OccurrenceView,
  postponeOccurrence,
  skipOccurrence,
  type TemporalStatus,
  updateSettings,
} from './api.ts'
import { authClient } from './auth-client.ts'
import { type EnableResult, enableNotifications, sendTestNotification } from './push.ts'

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

const STATUS_LABEL: Record<TemporalStatus, string> = {
  overdue: 'Overdue',
  due: 'Today',
  upcoming: 'Upcoming',
}
const STATUS_TEXT: Record<TemporalStatus, string> = {
  overdue: 'text-error',
  due: 'text-warning',
  upcoming: 'text-base-content/50',
}
const GROUP_ORDER: TemporalStatus[] = ['overdue', 'due', 'upcoming']

interface PostponeArgs {
  id: string
  mode: 'this' | 'thisAndFuture'
  days: number
}

function OccurrenceRow({
  occ,
  memberName,
  onComplete,
  onSkip,
  onClaim,
  onPostpone,
}: {
  occ: OccurrenceView
  memberName: (id: string) => string
  onComplete: (id: string) => void
  onSkip: (id: string) => void
  onClaim: (id: string) => void
  onPostpone: (args: PostponeArgs) => void
}) {
  return (
    <li className="flex items-center justify-between gap-2 py-2">
      <div className="flex flex-col">
        <span className="font-medium">{occ.name}</span>
        {occ.responsibleId ? (
          <span className="text-base-content/50 text-xs">{memberName(occ.responsibleId)}</span>
        ) : (
          <span className="text-warning text-xs">Unassigned</span>
        )}
      </div>
      <div className="flex items-center gap-1">
        {occ.temporalStatus !== 'upcoming' && (
          <button
            type="button"
            onClick={() => onComplete(occ.id)}
            className="btn btn-primary btn-sm"
          >
            Done
          </button>
        )}
        <div className="dropdown dropdown-end">
          <button
            type="button"
            tabIndex={0}
            aria-label="More actions"
            className="btn btn-square btn-ghost btn-sm"
          >
            ⋯
          </button>
          <ul className="dropdown-content menu z-10 w-52 rounded-box border border-base-300 bg-base-100 p-1 shadow">
            <li>
              <button
                type="button"
                onClick={() => onPostpone({ id: occ.id, mode: 'this', days: 1 })}
              >
                Postpone to tomorrow
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={() => onPostpone({ id: occ.id, mode: 'this', days: 7 })}
              >
                Postpone 1 week
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={() => onPostpone({ id: occ.id, mode: 'thisAndFuture', days: 7 })}
              >
                Shift 1 week (and future)
              </button>
            </li>
            <li>
              <button type="button" onClick={() => onSkip(occ.id)}>
                Skip
              </button>
            </li>
            {!occ.responsibleId && (
              <li>
                <button type="button" onClick={() => onClaim(occ.id)}>
                  Claim it
                </button>
              </li>
            )}
          </ul>
        </div>
      </div>
    </li>
  )
}

function CatalogModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const [added, setAdded] = useState<Set<string>>(new Set())
  const add = useMutation({
    mutationFn: (input: CatalogChoreInput) => addCatalogChore(input),
    onSuccess: (_data, input) => {
      setAdded((prev) => new Set(prev).add(input.name))
      queryClient.invalidateQueries({ queryKey: ['occurrences'] })
    },
  })

  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-lg">
        <h3 className="font-semibold text-lg">Add from the catalog</h3>
        <p className="text-base-content/60 text-sm">
          Recommended starting frequencies — edit any of them anytime.
        </p>
        <div className="mt-3 flex flex-col gap-4">
          {CATALOG.map((pack) => (
            <div key={pack.category}>
              <h4 className="font-semibold text-base-content/50 text-xs uppercase tracking-wide">
                {pack.category}
              </h4>
              <ul className="mt-1 flex flex-col divide-y divide-base-200">
                {pack.items.map((item) => (
                  <li key={item.name} className="flex items-center justify-between gap-2 py-2">
                    <div className="flex flex-col">
                      <span className="font-medium">{item.name}</span>
                      <span className="text-base-content/50 text-xs">
                        {describeRecurrence(item.recurrence)} · {item.estimatedEffortMinutes} min
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={added.has(item.name)}
                      onClick={() =>
                        add.mutate({
                          name: item.name,
                          recurrence: item.recurrence,
                          estimatedEffortMinutes: item.estimatedEffortMinutes,
                          category: pack.category,
                        })
                      }
                      className="btn btn-outline btn-xs"
                    >
                      {added.has(item.name) ? 'Added ✓' : 'Add'}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="modal-action">
          <button type="button" onClick={onClose} className="btn btn-sm">
            Done
          </button>
        </div>
      </div>
      <button type="button" onClick={onClose} aria-label="Close catalog" className="modal-backdrop">
        close
      </button>
    </div>
  )
}

function ChoresSection({ view }: { view: HouseholdView }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [presetIndex, setPresetIndex] = useState(0)
  const [taskTitle, setTaskTitle] = useState('')
  const [catalogOpen, setCatalogOpen] = useState(false)
  const occurrences = useQuery({ queryKey: ['occurrences'], queryFn: listOccurrences })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['occurrences'] })
  const complete = useMutation({ mutationFn: completeOccurrence, onSuccess: invalidate })
  const skip = useMutation({ mutationFn: skipOccurrence, onSuccess: invalidate })
  const claim = useMutation({ mutationFn: claimOccurrence, onSuccess: invalidate })
  const postpone = useMutation({
    mutationFn: (args: PostponeArgs) => postponeOccurrence(args.id, args.mode, args.days),
    onSuccess: invalidate,
  })
  const addChore = useMutation({
    mutationFn: () => createChore(name, RECURRENCE_PRESETS[presetIndex]?.rule ?? {}),
    onSuccess: () => {
      setName('')
      invalidate()
    },
  })
  const addTask = useMutation({
    mutationFn: () => createTask(taskTitle),
    onSuccess: () => {
      setTaskTitle('')
      invalidate()
    },
  })

  const memberName = (id: string): string =>
    view.members.find((m) => m.id === id)?.displayName ?? 'Someone'

  const groups = GROUP_ORDER.map((status) => ({
    status,
    items: (occurrences.data ?? [])
      .filter((o) => o.temporalStatus === status)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
  })).filter((group) => group.items.length > 0)

  return (
    <Card title="Chores & tasks">
      {groups.length === 0 && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-base-content/50 text-sm">Nothing scheduled yet.</p>
          <button
            type="button"
            onClick={() => setCatalogOpen(true)}
            className="btn btn-primary btn-sm"
          >
            Add common chores
          </button>
        </div>
      )}
      {groups.map(({ status, items }) => (
        <div key={status} className="flex flex-col gap-1">
          <p className={`font-semibold text-xs uppercase tracking-wide ${STATUS_TEXT[status]}`}>
            {STATUS_LABEL[status]}
          </p>
          <ul className="flex flex-col divide-y divide-base-200">
            {items.map((occ) => (
              <OccurrenceRow
                key={occ.id}
                occ={occ}
                memberName={memberName}
                onComplete={(id) => complete.mutate(id)}
                onSkip={(id) => skip.mutate(id)}
                onClaim={(id) => claim.mutate(id)}
                onPostpone={(args) => postpone.mutate(args)}
              />
            ))}
          </ul>
        </div>
      ))}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          addChore.mutate()
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New chore (e.g. Vacuum)"
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
          Add chore
        </button>
      </form>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          addTask.mutate()
        }}
        className="flex gap-2"
      >
        <input
          required
          value={taskTitle}
          onChange={(e) => setTaskTitle(e.target.value)}
          placeholder="One-off task (e.g. Call plumber)"
          aria-label="Task title"
          className="input input-bordered input-sm flex-1"
        />
        <button type="submit" className="btn btn-outline btn-sm">
          Add task
        </button>
      </form>

      <button
        type="button"
        onClick={() => setCatalogOpen(true)}
        className="btn btn-ghost btn-sm w-fit"
      >
        Browse catalog
      </button>
      {catalogOpen && <CatalogModal onClose={() => setCatalogOpen(false)} />}
    </Card>
  )
}

const ENABLE_MESSAGE: Record<Exclude<EnableResult, 'ok'>, string> = {
  denied: 'Permission denied — enable notifications in your browser settings.',
  unsupported: "This browser doesn't support push notifications.",
  unconfigured: 'Push isn’t configured on the server yet.',
}

function NotificationsCard() {
  const [result, setResult] = useState<EnableResult | null>(null)
  const [tested, setTested] = useState<number | null>(null)
  const enable = useMutation({ mutationFn: enableNotifications, onSuccess: setResult })
  const test = useMutation({ mutationFn: sendTestNotification, onSuccess: setTested })

  return (
    <Card title="Notifications">
      <button
        type="button"
        onClick={() => enable.mutate()}
        disabled={enable.isPending}
        className="btn btn-outline btn-sm w-fit"
      >
        {result === 'ok' ? 'Notifications on ✓' : 'Turn on notifications'}
      </button>
      {result && result !== 'ok' && (
        <p className="text-base-content/60 text-xs">{ENABLE_MESSAGE[result]}</p>
      )}
      {result === 'ok' && (
        <>
          <button
            type="button"
            onClick={() => test.mutate()}
            className="btn btn-ghost btn-sm w-fit"
          >
            Send a test
          </button>
          {tested !== null && (
            <p className="text-base-content/60 text-xs">
              {tested > 0 ? 'Sent — check your notifications.' : 'No active subscription got it.'}
            </p>
          )}
        </>
      )}
      <p className="text-base-content/50 text-xs">
        On iPhone, add this app to your Home Screen first to receive push.
      </p>
    </Card>
  )
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const hourLabel = (h: number): string => `${String(h).padStart(2, '0')}:00`

function HourSelect({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-label={label}
      className="select select-bordered select-sm w-24"
    >
      {HOURS.map((h) => (
        <option key={h} value={h}>
          {hourLabel(h)}
        </option>
      ))}
    </select>
  )
}

function SettingsCard({ view }: { view: HouseholdView }) {
  const queryClient = useQueryClient()
  const [digest, setDigest] = useState(view.household.digestHour)
  const [quietStart, setQuietStart] = useState(view.household.quietStartHour)
  const [quietEnd, setQuietEnd] = useState(view.household.quietEndHour)
  const save = useMutation({
    mutationFn: () =>
      updateSettings(view.household.id, {
        digestHour: digest,
        quietStartHour: quietStart,
        quietEndHour: quietEnd,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['household'] }),
  })

  return (
    <Card title="Notification settings">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
        className="flex flex-col gap-3"
      >
        <div className="flex items-center justify-between gap-2 text-sm">
          <span>Daily digest at</span>
          <HourSelect label="Digest hour" value={digest} onChange={setDigest} />
        </div>
        <div className="flex items-center justify-between gap-2 text-sm">
          <span>Quiet hours</span>
          <span className="flex items-center gap-1">
            <HourSelect label="Quiet start hour" value={quietStart} onChange={setQuietStart} />
            <span className="text-base-content/50">to</span>
            <HourSelect label="Quiet end hour" value={quietEnd} onChange={setQuietEnd} />
          </span>
        </div>
        <button type="submit" className="btn btn-outline btn-sm w-fit">
          {save.isSuccess ? 'Saved ✓' : 'Save'}
        </button>
      </form>
    </Card>
  )
}

function timeAgo(at: number): string {
  const seconds = Math.floor((Date.now() - at) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function HistorySection() {
  const [range, setRange] = useState<HistoryWindow>('week')
  const history = useQuery({ queryKey: ['history', range], queryFn: () => getHistory(range) })
  const data = history.data

  return (
    <>
      <Card title="Workload">
        <div className="join">
          <button
            type="button"
            onClick={() => setRange('week')}
            className={`btn btn-xs join-item ${range === 'week' ? 'btn-active' : ''}`}
          >
            This week
          </button>
          <button
            type="button"
            onClick={() => setRange('month')}
            className={`btn btn-xs join-item ${range === 'month' ? 'btn-active' : ''}`}
          >
            This month
          </button>
        </div>
        {data && data.tally.length === 0 && (
          <p className="text-base-content/50 text-sm">No completed chores in this window yet.</p>
        )}
        {data?.tally.map((entry) => {
          const pct =
            data.totalEffort > 0 ? Math.round((entry.effortMinutes / data.totalEffort) * 100) : 0
          return (
            <div key={entry.memberId} className="flex flex-col gap-1">
              <div className="flex justify-between text-sm">
                <span className="font-medium">{entry.name}</span>
                <span className="text-base-content/60">
                  {pct}% · {entry.completed} done · {entry.effortMinutes} min
                </span>
              </div>
              <progress className="progress progress-primary h-1.5" value={pct} max={100} />
            </div>
          )
        })}
      </Card>

      <Card title="Recent activity">
        {data && data.activity.length === 0 && (
          <p className="text-base-content/50 text-sm">Nothing yet.</p>
        )}
        <ul className="flex flex-col gap-1 text-sm">
          {data?.activity.map((event) => (
            <li key={event.id} className="flex justify-between gap-3">
              <span>{event.text}</span>
              <span className="whitespace-nowrap text-base-content/50 text-xs">
                {timeAgo(event.at)}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </>
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

        <ChoresSection view={view} />

        <HistorySection />

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

        <NotificationsCard />

        {view.me.role === 'owner' && <SettingsCard view={view} />}

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
