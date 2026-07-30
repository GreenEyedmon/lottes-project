import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { type FormEvent, type ReactNode, useState } from 'react'
import { CATALOG, describeRecurrence } from '../shared/chore/catalog.ts'
import { suggestIngredients } from '../shared/meal/dishes.ts'
import {
  acceptInvite,
  acceptSuggestion,
  addCatalogChore,
  addRoom,
  addToShoppingList,
  type CatalogChoreInput,
  claimOccurrence,
  completeOccurrence,
  cookRecipe,
  createChore,
  createHousehold,
  createInvite,
  createRecipe,
  createTask,
  deleteRecipe,
  dismissSuggestion,
  type GroceryItem,
  getCurrentHousehold,
  getDashboard,
  getHistory,
  getShopping,
  type HistoryWindow,
  type HouseholdView,
  listGroceryItems,
  listOccurrences,
  listSuggestions,
  type MissedPolicy,
  mealHistory,
  type OccurrenceView,
  postponeOccurrence,
  purchaseShoppingEntry,
  removeShoppingEntry,
  type ShoppingEntry,
  type SuggestedMeal,
  type SuggestionView,
  skipOccurrence,
  suggestMeals,
  type TemporalStatus,
  updateMyName,
  updateRecipe,
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
        <h2 className="font-semibold text-base-content/60 text-sm">{title}</h2>
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
  { label: 'Twice a week', rule: { mode: 'frequencyTarget', timesPerWeek: 2 } },
  { label: '3× a week', rule: { mode: 'frequencyTarget', timesPerWeek: 3 } },
]

/** What happens to an occurrence that's missed (still open past its due date). */
const MISSED_POLICIES: { value: MissedPolicy; label: string; hint: string }[] = [
  { value: 'collapse', label: 'Roll forward', hint: 'A missed turn merges into the next one' },
  { value: 'keep', label: 'Pile up', hint: 'Missed turns stay on the list as overdue' },
  { value: 'expire', label: 'Let it go', hint: 'A missed turn just disappears' },
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
  suggestions,
  onComplete,
  onSkip,
  onClaim,
  onPostpone,
  onAccept,
  onDismiss,
}: {
  occ: OccurrenceView
  memberName: (id: string) => string
  suggestions?: SuggestionView[]
  onComplete: (id: string) => void
  onSkip: (id: string) => void
  onClaim: (id: string) => void
  onPostpone: (args: PostponeArgs) => void
  onAccept: (id: string) => void
  onDismiss: (id: string) => void
}) {
  return (
    <li className="flex flex-col gap-1 py-2">
      <div className="flex items-center justify-between gap-2">
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
      </div>
      {suggestions?.map((suggestion) => (
        <div
          key={suggestion.id}
          className="flex items-center justify-between gap-2 rounded-box bg-base-200 px-2 py-1"
        >
          <span className="text-xs">{suggestion.explanation}</span>
          <span className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={() => onAccept(suggestion.id)}
              className="btn btn-primary btn-xs"
            >
              Accept
            </button>
            <button
              type="button"
              onClick={() => onDismiss(suggestion.id)}
              className="btn btn-ghost btn-xs"
            >
              Dismiss
            </button>
          </span>
        </div>
      ))}
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
              <h4 className="font-semibold text-base-content/50 text-xs">{pack.category}</h4>
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
                      {added.has(item.name) ? 'Added' : 'Add'}
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
  const [rotate, setRotate] = useState(false)
  const [missedPolicy, setMissedPolicy] = useState<MissedPolicy>('collapse')
  const [roomId, setRoomId] = useState('')
  const [taskTitle, setTaskTitle] = useState('')
  const [catalogOpen, setCatalogOpen] = useState(false)
  const occurrences = useQuery({ queryKey: ['occurrences'], queryFn: listOccurrences })
  const suggestions = useQuery({ queryKey: ['suggestions'], queryFn: listSuggestions })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['occurrences'] })
  // Accepting a suggestion regenerates occurrences, so refresh both lists.
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['occurrences'] })
    queryClient.invalidateQueries({ queryKey: ['suggestions'] })
  }
  const complete = useMutation({ mutationFn: completeOccurrence, onSuccess: invalidate })
  const skip = useMutation({ mutationFn: skipOccurrence, onSuccess: invalidate })
  const claim = useMutation({ mutationFn: claimOccurrence, onSuccess: invalidate })
  const postpone = useMutation({
    mutationFn: (args: PostponeArgs) => postponeOccurrence(args.id, args.mode, args.days),
    onSuccess: invalidate,
  })
  const accept = useMutation({ mutationFn: acceptSuggestion, onSuccess: invalidateAll })
  const dismiss = useMutation({ mutationFn: dismissSuggestion, onSuccess: invalidateAll })

  const suggestionsByTemplate = new Map<string, SuggestionView[]>()
  for (const s of suggestions.data ?? []) {
    const list = suggestionsByTemplate.get(s.templateId) ?? []
    list.push(s)
    suggestionsByTemplate.set(s.templateId, list)
  }
  const addChore = useMutation({
    mutationFn: () =>
      createChore(name, RECURRENCE_PRESETS[presetIndex]?.rule ?? {}, {
        rotate,
        missedPolicy,
        roomId: roomId || undefined,
      }),
    onSuccess: () => {
      setName('')
      setRotate(false)
      setMissedPolicy('collapse')
      // keep the selected room so several chores can be added to it in a row
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

  const occs = occurrences.data ?? []
  const statusGroups = (list: OccurrenceView[]) =>
    GROUP_ORDER.map((status) => ({
      status,
      items: list
        .filter((o) => o.temporalStatus === status)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    })).filter((group) => group.items.length > 0)

  // Group by room (outer), then by status (inner). "Other" holds room-less chores/tasks.
  const roomBuckets = new Map<string, OccurrenceView[]>()
  for (const o of occs) {
    const key = o.roomName ?? ''
    const list = roomBuckets.get(key) ?? []
    list.push(o)
    roomBuckets.set(key, list)
  }
  const orderedRooms = view.rooms.map((r) => r.name).filter((n) => roomBuckets.has(n))
  const leftoverRooms = [...roomBuckets.keys()].filter((k) => k !== '' && !orderedRooms.includes(k))
  const roomKeys = [...orderedRooms, ...leftoverRooms, ...(roomBuckets.has('') ? [''] : [])]
  // Only show room headings once at least one chore is actually assigned to a room.
  const showRoomHeadings = roomKeys.some((k) => k !== '')

  return (
    <Card title="Chores & tasks">
      {occs.length === 0 && (
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
      {roomKeys.map((roomKey) => (
        <div key={roomKey || '__other'} className="flex flex-col gap-2">
          {showRoomHeadings && <h3 className="font-semibold">{roomKey || 'Other'}</h3>}
          {statusGroups(roomBuckets.get(roomKey) ?? []).map(({ status, items }) => (
            <div key={status} className="flex flex-col gap-1">
              <p className={`font-semibold text-xs ${STATUS_TEXT[status]}`}>
                {STATUS_LABEL[status]}
              </p>
              <ul className="flex flex-col divide-y divide-base-200">
                {items.map((occ) => (
                  <OccurrenceRow
                    key={occ.id}
                    occ={occ}
                    memberName={memberName}
                    suggestions={
                      occ.templateId ? suggestionsByTemplate.get(occ.templateId) : undefined
                    }
                    onComplete={(id) => complete.mutate(id)}
                    onSkip={(id) => skip.mutate(id)}
                    onClaim={(id) => claim.mutate(id)}
                    onPostpone={(args) => postpone.mutate(args)}
                    onAccept={(id) => accept.mutate(id)}
                    onDismiss={(id) => dismiss.mutate(id)}
                  />
                ))}
              </ul>
            </div>
          ))}
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
        <select
          value={missedPolicy}
          onChange={(e) => setMissedPolicy(e.target.value as MissedPolicy)}
          aria-label="If missed"
          title={MISSED_POLICIES.find((p) => p.value === missedPolicy)?.hint}
          className="select select-bordered select-sm"
        >
          {MISSED_POLICIES.map((policy) => (
            <option key={policy.value} value={policy.value} title={policy.hint}>
              If missed: {policy.label}
            </option>
          ))}
        </select>
        {view.rooms.length > 0 && (
          <select
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            aria-label="Room"
            className="select select-bordered select-sm"
          >
            <option value="">No room</option>
            {view.rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </select>
        )}
        {view.members.length > 1 && (
          <label className="label cursor-pointer gap-2 text-sm">
            <input
              type="checkbox"
              checked={rotate}
              onChange={(e) => setRotate(e.target.checked)}
              className="checkbox checkbox-sm"
            />
            <span title="Each turn goes to the next household member">Rotate</span>
          </label>
        )}
        <button type="submit" className="btn btn-primary btn-sm">
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
  const [reminders, setReminders] = useState(view.household.remindersEnabled)
  const [digestOn, setDigestOn] = useState(view.household.digestEnabled)
  const [activity, setActivity] = useState(view.household.activityEnabled)
  const save = useMutation({
    mutationFn: () =>
      updateSettings(view.household.id, {
        digestHour: digest,
        quietStartHour: quietStart,
        quietEndHour: quietEnd,
        remindersEnabled: reminders,
        digestEnabled: digestOn,
        activityEnabled: activity,
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
        <Toggle
          label="Due-time reminders"
          hint="Ping the person responsible when a timed chore comes due"
          checked={reminders}
          onChange={setReminders}
        />
        <Toggle
          label="Daily digest"
          hint="One summary of what's due and overdue"
          checked={digestOn}
          onChange={setDigestOn}
        />
        <Toggle
          label="Activity updates"
          hint="Tell the household when someone completes or claims a chore"
          checked={activity}
          onChange={setActivity}
        />
        <div className="divider my-0" />
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

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 text-sm">
      <span className="flex flex-col">
        <span>{label}</span>
        <span className="text-base-content/50 text-xs">{hint}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="toggle toggle-sm"
      />
    </label>
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

/** Group list entries by category; uncategorized fall under "Other", which sorts last. */
function groupEntriesByCategory(
  entries: ShoppingEntry[],
): { category: string; items: ShoppingEntry[] }[] {
  const groups = new Map<string, ShoppingEntry[]>()
  for (const entry of entries) {
    const key = entry.category?.trim() || 'Other'
    const items = groups.get(key) ?? []
    items.push(entry)
    groups.set(key, items)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b)))
    .map(([category, items]) => ({ category, items }))
}

/** Parse a decimal price string ("3.50") into whole cents; empty/invalid → undefined. */
function parsePriceCents(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const n = Number(trimmed)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined
}

/** Tidy a free-text quantity for display: "250g" → "250 g", "1l" → "1 L". Other text as-is. */
function formatQuantity(raw: string): string {
  const trimmed = raw.trim()
  const match = trimmed.match(/^(\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)$/)
  const num = match?.[1]
  const unit = match?.[2]
  if (!num || !unit) return trimmed
  const lower = unit.toLowerCase()
  return `${num} ${lower === 'l' ? 'L' : lower}`
}

function ShoppingSection({ view }: { view: HouseholdView }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('')
  const [category, setCategory] = useState('')
  const [openId, setOpenId] = useState<string | null>(null) // row whose price/store editor is open
  const [price, setPrice] = useState('')
  const [store, setStore] = useState('')

  const list = useQuery({ queryKey: ['shopping'], queryFn: getShopping })
  const catalog = useQuery({ queryKey: ['grocery-items'], queryFn: listGroceryItems })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['shopping'] })
  const closeDetail = () => {
    setOpenId(null)
    setPrice('')
    setStore('')
  }
  const openDetail = (id: string) => {
    setOpenId(id)
    setPrice('')
    setStore('')
  }

  const add = useMutation({
    mutationFn: () =>
      addToShoppingList({
        name,
        quantity: quantity.trim() || undefined,
        category: category.trim() || undefined,
      }),
    onSuccess: () => {
      setName('')
      setQuantity('')
      setCategory('')
      invalidate()
      void queryClient.invalidateQueries({ queryKey: ['grocery-items'] })
    },
  })
  const addItem = useMutation({
    mutationFn: (itemId: string) => addToShoppingList({ itemId }),
    onSuccess: invalidate,
  })
  const bought = useMutation({
    mutationFn: (args: { id: string; priceCents?: number; store?: string }) =>
      purchaseShoppingEntry(args.id, { priceCents: args.priceCents, store: args.store }),
    onSuccess: () => {
      closeDetail()
      invalidate()
    },
  })
  const remove = useMutation({ mutationFn: removeShoppingEntry, onSuccess: invalidate })

  const memberName = (id: string): string =>
    view.members.find((m) => m.id === id)?.displayName ?? 'Someone'

  const entries = list.data?.entries ?? []
  const restock = list.data?.restock ?? []
  const groups = groupEntriesByCategory(entries)

  const onListIds = new Set(entries.map((e) => e.itemId))
  const restockIds = new Set(restock.map((r) => r.itemId))
  const quickAdd = (catalog.data ?? [])
    .filter((item: GroceryItem) => !onListIds.has(item.id) && !restockIds.has(item.id))
    .slice(0, 12)

  return (
    <Card title="Shopping list">
      {restock.length > 0 && (
        <div className="flex flex-col gap-1 rounded-box bg-base-200 p-2">
          <p className="font-semibold text-base-content/60 text-xs">Probably running low</p>
          {restock.map((item) => (
            <div key={item.itemId} className="flex items-center justify-between gap-2">
              <span className="flex flex-col">
                <span className="font-medium text-sm">{item.name}</span>
                <span className="text-base-content/50 text-xs">{item.explanation}</span>
              </span>
              <button
                type="button"
                onClick={() => addItem.mutate(item.itemId)}
                className="btn btn-primary btn-xs"
              >
                Add
              </button>
            </div>
          ))}
        </div>
      )}

      {entries.length === 0 && <p className="text-base-content/50 text-sm">Nothing on the list.</p>}

      {groups.map(({ category: groupName, items }) => (
        <div key={groupName} className="flex flex-col gap-1">
          <p className="font-semibold text-base-content/50 text-xs">{groupName}</p>
          <ul className="flex flex-col divide-y divide-base-200">
            {items.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-1 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-col">
                    <span className="font-medium">
                      {entry.name}
                      {entry.quantity && (
                        <span className="text-base-content/60">
                          {' '}
                          · {formatQuantity(entry.quantity)}
                        </span>
                      )}
                    </span>
                    <span className="text-base-content/50 text-xs">
                      added by {memberName(entry.addedBy)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => bought.mutate({ id: entry.id })}
                      className="btn btn-primary btn-sm"
                    >
                      Bought
                    </button>
                    <button
                      type="button"
                      onClick={() => (openId === entry.id ? closeDetail() : openDetail(entry.id))}
                      className="btn btn-ghost btn-sm"
                    >
                      Price
                    </button>
                    <button
                      type="button"
                      onClick={() => remove.mutate(entry.id)}
                      className="btn btn-ghost btn-sm text-base-content/60"
                    >
                      Remove
                    </button>
                  </div>
                </div>
                {openId === entry.id && (
                  <div className="flex flex-wrap items-center gap-2 rounded-box bg-base-200 p-2">
                    <input
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      inputMode="decimal"
                      placeholder="Price"
                      aria-label="Price"
                      className="input input-bordered input-xs w-20"
                    />
                    <input
                      value={store}
                      onChange={(e) => setStore(e.target.value)}
                      placeholder="Store (optional)"
                      aria-label="Store"
                      className="input input-bordered input-xs flex-1"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        bought.mutate({
                          id: entry.id,
                          priceCents: parsePriceCents(price),
                          store: store.trim() || undefined,
                        })
                      }
                      className="btn btn-primary btn-xs"
                    >
                      Bought
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          add.mutate()
        }}
        className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"
      >
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add item (e.g. Milk)"
          aria-label="Item name"
          className="input input-bordered input-sm flex-1"
        />
        <input
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="Qty"
          aria-label="Quantity"
          className="input input-bordered input-sm sm:w-20"
        />
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Category"
          aria-label="Category"
          className="input input-bordered input-sm sm:w-28"
        />
        <button type="submit" className="btn btn-primary btn-sm">
          Add
        </button>
      </form>

      {quickAdd.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="font-semibold text-base-content/50 text-xs">Quick add</p>
          <div className="flex flex-wrap gap-1">
            {quickAdd.map((item: GroceryItem) => (
              <button
                key={item.id}
                type="button"
                onClick={() => addItem.mutate(item.id)}
                className="btn btn-outline btn-xs"
              >
                {item.name} +
              </button>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

interface IngredientDraft {
  id: string
  name: string
  quantity: string
  staple: boolean
}

const makeIngredientRow = (): IngredientDraft => ({
  id: crypto.randomUUID(),
  name: '',
  quantity: '',
  staple: false,
})

const DIETARY_TAGS = ['vegetarian', 'vegan', 'gluten-free']

/** Choose which of a recipe's ingredients to add to the shopping list before cooking. */
function CookModal({
  recipe,
  pending,
  onConfirm,
  onClose,
}: {
  recipe: SuggestedMeal
  pending: boolean
  onConfirm: (itemIds: string[]) => void
  onClose: () => void
}) {
  // Missing ingredients start checked; things you likely have (and staples) start unchecked.
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(recipe.ingredients.filter((i) => i.missing).map((i) => i.itemId)),
  )
  const toggle = (itemId: string) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })

  return (
    <div className="modal modal-open">
      <div className="modal-box">
        <h3 className="font-semibold text-lg">Cook {recipe.name}</h3>
        <p className="text-base-content/60 text-sm">Pick what you need to add to the list.</p>
        <ul className="my-3 flex flex-col gap-1">
          {recipe.ingredients.map((ingredient) => (
            <li key={ingredient.itemId}>
              <label className="label cursor-pointer justify-start gap-2">
                <input
                  type="checkbox"
                  checked={checked.has(ingredient.itemId)}
                  onChange={() => toggle(ingredient.itemId)}
                  className="checkbox checkbox-sm"
                />
                <span className="flex-1">
                  {ingredient.name}
                  {ingredient.quantity && (
                    <span className="text-base-content/50">
                      {' '}
                      · {formatQuantity(ingredient.quantity)}
                    </span>
                  )}
                </span>
                {!ingredient.missing && (
                  <span className="text-base-content/40 text-xs">
                    {ingredient.staple ? 'staple' : 'likely have'}
                  </span>
                )}
              </label>
            </li>
          ))}
        </ul>
        <div className="modal-action">
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm([...checked])}
            disabled={pending}
            className="btn btn-primary btn-sm"
          >
            {checked.size > 0 ? `Cook · add ${checked.size}` : 'Cook'}
          </button>
        </div>
      </div>
      <button type="button" onClick={onClose} aria-label="Close" className="modal-backdrop">
        close
      </button>
    </div>
  )
}

function MealsSection({ view }: { view: HouseholdView }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [ingredients, setIngredients] = useState<IngredientDraft[]>(() => [makeIngredientRow()])
  const [cookMinutes, setCookMinutes] = useState('')
  const [servings, setServings] = useState('')
  const [tags, setTags] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [filterCook, setFilterCook] = useState('')
  const [filterTags, setFilterTags] = useState<Set<string>>(new Set())
  const [cookedMsg, setCookedMsg] = useState<string | null>(null)
  const [cookTarget, setCookTarget] = useState<SuggestedMeal | null>(null)

  const filterTagKey = [...filterTags].sort().join(',')
  const recipesQuery = useQuery({
    queryKey: ['meals', filterCook, filterTagKey],
    queryFn: () =>
      suggestMeals({
        maxCookMinutes: filterCook.trim() ? Number(filterCook) : undefined,
        requiredTags: [...filterTags],
      }),
  })
  const historyQuery = useQuery({ queryKey: ['meal-history'], queryFn: mealHistory })
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['meals'] })
    queryClient.invalidateQueries({ queryKey: ['meal-history'] })
  }

  const resetForm = () => {
    setEditingId(null)
    setName('')
    setIngredients([makeIngredientRow()])
    setCookMinutes('')
    setServings('')
    setTags(new Set())
  }

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name,
        dietaryTags: [...tags],
        cookMinutes: cookMinutes.trim() ? Number(cookMinutes) : undefined,
        servings: servings.trim() ? Number(servings) : undefined,
        ingredients: ingredients
          .filter((row) => row.name.trim())
          .map((row) => ({
            name: row.name.trim(),
            quantity: row.quantity.trim() || undefined,
            staple: row.staple,
          })),
      }
      if (editingId) await updateRecipe(editingId, payload)
      else await createRecipe(payload)
    },
    onSuccess: () => {
      resetForm()
      invalidate()
    },
  })
  const startEdit = (recipe: SuggestedMeal) => {
    setEditingId(recipe.id)
    setName(recipe.name)
    setIngredients(
      recipe.ingredients.length > 0
        ? recipe.ingredients.map((i) => ({
            id: crypto.randomUUID(),
            name: i.name,
            quantity: i.quantity ?? '',
            staple: i.staple,
          }))
        : [makeIngredientRow()],
    )
    setCookMinutes(recipe.cookMinutes != null ? String(recipe.cookMinutes) : '')
    setServings(recipe.servings != null ? String(recipe.servings) : '')
    setTags(new Set(recipe.dietaryTags))
  }
  const remove = useMutation({ mutationFn: deleteRecipe, onSuccess: invalidate })
  const cook = useMutation({
    mutationFn: (args: { id: string; itemIds?: string[] }) => cookRecipe(args.id, args.itemIds),
    onSuccess: (data) => {
      setCookTarget(null)
      setCookedMsg(
        data.added > 0
          ? `Added ${data.added} ingredient${data.added === 1 ? '' : 's'} to the shopping list.`
          : 'Nothing added to the list.',
      )
      invalidate()
      void queryClient.invalidateQueries({ queryKey: ['shopping'] })
    },
  })
  const toggleFilterTag = (tag: string) =>
    setFilterTags((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })

  const suggestion = suggestIngredients(name)
  const useSuggestion = () => {
    if (!suggestion) return
    setIngredients([
      ...suggestion.map((s) => ({
        id: crypto.randomUUID(),
        name: s.name,
        quantity: '',
        staple: !!s.staple,
      })),
      makeIngredientRow(),
    ])
  }

  const setIngredient = (id: string, patch: Partial<IngredientDraft>) =>
    setIngredients((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  const removeIngredientRow = (id: string) =>
    setIngredients((rows) => (rows.length > 1 ? rows.filter((row) => row.id !== id) : rows))
  const toggleTag = (tag: string) =>
    setTags((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })

  const memberName = (id: string): string =>
    view.members.find((m) => m.id === id)?.displayName ?? 'Someone'

  const recipes = recipesQuery.data ?? []
  const history = historyQuery.data ?? []

  return (
    <>
      {cookTarget && (
        <CookModal
          recipe={cookTarget}
          pending={cook.isPending}
          onConfirm={(itemIds) => cook.mutate({ id: cookTarget.id, itemIds })}
          onClose={() => setCookTarget(null)}
        />
      )}
      <Card title="Meals">
        {cookedMsg && <p className="text-success text-sm">{cookedMsg}</p>}

        {recipes.length === 0 && (
          <p className="text-base-content/50 text-sm">No recipes yet. Add one below.</p>
        )}

        {recipes.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-base-content/50">Suggest:</span>
            <input
              value={filterCook}
              onChange={(e) => setFilterCook(e.target.value)}
              inputMode="numeric"
              placeholder="≤ min"
              aria-label="Max cook minutes"
              className="input input-bordered input-xs w-20"
            />
            {DIETARY_TAGS.map((tag) => (
              <label key={tag} className="label cursor-pointer gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={filterTags.has(tag)}
                  onChange={() => toggleFilterTag(tag)}
                  className="checkbox checkbox-xs"
                />
                <span>{tag}</span>
              </label>
            ))}
          </div>
        )}

        {recipes.length > 0 && (
          <ul className="flex flex-col divide-y divide-base-200">
            {recipes.map((recipe) => (
              <li key={recipe.id} className="flex items-start justify-between gap-2 py-2">
                <div className="flex flex-col gap-1">
                  <span className="font-medium">
                    {recipe.name}
                    {recipe.cookMinutes != null && (
                      <span className="text-base-content/50 text-xs">
                        {' '}
                        · {recipe.cookMinutes} min
                      </span>
                    )}
                    {recipe.servings != null && (
                      <span className="text-base-content/50 text-xs">
                        {' '}
                        · serves {recipe.servings}
                      </span>
                    )}
                  </span>
                  {recipe.dietaryTags.length > 0 && (
                    <span className="flex flex-wrap gap-1">
                      {recipe.dietaryTags.map((t) => (
                        <span key={t} className="badge badge-ghost badge-sm">
                          {t}
                        </span>
                      ))}
                    </span>
                  )}
                  <span className="text-base-content/50 text-xs">
                    {recipe.ingredients.map((i) => i.name).join(', ')}
                  </span>
                  <span className="text-xs">
                    {recipe.missingCount === 0 ? (
                      <span className="text-success">Have everything</span>
                    ) : (
                      <span className="text-base-content/60">
                        needs {recipe.missingCount} item{recipe.missingCount === 1 ? '' : 's'}
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setCookTarget(recipe)}
                    className="btn btn-primary btn-sm"
                  >
                    Cook
                  </button>
                  <button
                    type="button"
                    onClick={() => startEdit(recipe)}
                    aria-label={`Edit ${recipe.name}`}
                    className="btn btn-ghost btn-sm"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => remove.mutate(recipe.id)}
                    className="btn btn-ghost btn-sm text-base-content/60"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
          className="flex flex-col gap-2"
        >
          {editingId && (
            <div className="flex items-center justify-between">
              <span className="font-semibold text-base-content/60 text-xs">Editing recipe</span>
              <button type="button" onClick={resetForm} className="btn btn-ghost btn-xs">
                Cancel
              </button>
            </div>
          )}
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Dish name (e.g. Spaghetti bolognese)"
            aria-label="Dish name"
            className="input input-bordered input-sm"
          />
          {suggestion && (
            <button type="button" onClick={useSuggestion} className="btn btn-outline btn-xs w-fit">
              Use suggested ingredients ({suggestion.length})
            </button>
          )}
          <div className="flex flex-col gap-1">
            {ingredients.map((row, idx) => (
              <div key={row.id} className="flex items-center gap-1">
                <input
                  value={row.name}
                  onChange={(e) => setIngredient(row.id, { name: e.target.value })}
                  placeholder="Ingredient"
                  aria-label={`Ingredient ${idx + 1}`}
                  className="input input-bordered input-xs flex-1"
                />
                <input
                  value={row.quantity}
                  onChange={(e) => setIngredient(row.id, { quantity: e.target.value })}
                  placeholder="Qty"
                  aria-label={`Quantity ${idx + 1}`}
                  className="input input-bordered input-xs w-16"
                />
                <label
                  className="label cursor-pointer gap-1 text-xs"
                  title="Pantry staple — not auto-added to the list"
                >
                  <input
                    type="checkbox"
                    checked={row.staple}
                    onChange={(e) => setIngredient(row.id, { staple: e.target.checked })}
                    className="checkbox checkbox-xs"
                  />
                  <span>staple</span>
                </label>
                <button
                  type="button"
                  onClick={() => removeIngredientRow(row.id)}
                  aria-label={`Remove ingredient ${idx + 1}`}
                  className="btn btn-ghost btn-xs text-base-content/60"
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setIngredients((rows) => [...rows, makeIngredientRow()])}
              className="btn btn-ghost btn-xs w-fit"
            >
              + ingredient
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={cookMinutes}
              onChange={(e) => setCookMinutes(e.target.value)}
              inputMode="numeric"
              placeholder="Cook min"
              aria-label="Cook minutes"
              className="input input-bordered input-xs w-24"
            />
            <input
              value={servings}
              onChange={(e) => setServings(e.target.value)}
              inputMode="numeric"
              placeholder="Serves"
              aria-label="Servings"
              className="input input-bordered input-xs w-20"
            />
            {DIETARY_TAGS.map((tag) => (
              <label key={tag} className="label cursor-pointer gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={tags.has(tag)}
                  onChange={() => toggleTag(tag)}
                  className="checkbox checkbox-xs"
                />
                <span>{tag}</span>
              </label>
            ))}
          </div>
          <button type="submit" className="btn btn-primary btn-sm w-fit">
            {editingId ? 'Save changes' : 'Save recipe'}
          </button>
          {save.error && <p className="text-error text-xs">{errorMessage(save.error)}</p>}
        </form>

        {history.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="font-semibold text-base-content/50 text-xs">Recently cooked</p>
            <ul className="flex flex-col divide-y divide-base-200">
              {history.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="flex flex-col">
                    <span className="text-sm">{entry.recipeName}</span>
                    <span className="text-base-content/50 text-xs">
                      {memberName(entry.cookedBy)} · {timeAgo(entry.cookedAt)}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => cook.mutate({ id: entry.recipeId })}
                    className="btn btn-ghost btn-xs"
                  >
                    Cook again
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </>
  )
}

type Workspace = 'dashboard' | 'chores' | 'shopping' | 'meals' | 'settings'

/** A whole-card button for the dashboard. Children must be phrasing content (spans). */
function DashCard({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="card w-full border border-base-300 bg-base-100 text-left shadow-sm transition hover:border-primary"
    >
      <span className="card-body gap-2 p-5">
        <span className="font-semibold">{title}</span>
        {children}
      </span>
    </button>
  )
}

/** The landing overview. Prioritized, and every card opens its workspace. */
function DashboardSection({ onNavigate }: { onNavigate: (tab: Workspace) => void }) {
  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: getDashboard })
  const d = dashboard.data

  if (!d) {
    return (
      <Card title="Overview">
        <p className="text-base-content/50 text-sm">Loading…</p>
      </Card>
    )
  }

  const money = (cents: number) => `€${(cents / 100).toFixed(2)}`
  const plural = (n: number) => (n === 1 ? '' : 's')

  return (
    <div className="flex flex-col gap-3">
      <DashCard title="Chores" onClick={() => onNavigate('chores')}>
        {d.chores.overdue === 0 && d.chores.dueToday === 0 ? (
          <span className="text-success">All caught up</span>
        ) : (
          <span className="flex flex-wrap gap-x-4">
            {d.chores.overdue > 0 && (
              <span className="font-medium text-error">{d.chores.overdue} overdue</span>
            )}
            {d.chores.dueToday > 0 && (
              <span className="font-medium text-warning">{d.chores.dueToday} due today</span>
            )}
          </span>
        )}
        {d.chores.upcoming > 0 && (
          <span className="text-base-content/50 text-sm">{d.chores.upcoming} upcoming</span>
        )}
      </DashCard>

      <DashCard title="Shopping" onClick={() => onNavigate('shopping')}>
        {d.shopping.itemCount === 0 ? (
          <span className="text-base-content/50">List is empty</span>
        ) : (
          <span>
            {d.shopping.itemCount} item{plural(d.shopping.itemCount)}
            {d.shopping.estimatedCents != null && (
              <span className="text-base-content/50">
                {' '}
                · est. {money(d.shopping.estimatedCents)}
              </span>
            )}
          </span>
        )}
      </DashCard>

      <DashCard title="Tonight's meal" onClick={() => onNavigate('meals')}>
        {d.meal ? (
          <span className="flex flex-col">
            <span className="font-medium">{d.meal.name}</span>
            <span className="text-base-content/50 text-sm">
              {d.meal.missingCount === 0
                ? 'You have everything'
                : `Needs ${d.meal.missingCount} item${plural(d.meal.missingCount)}`}
            </span>
          </span>
        ) : (
          <span className="text-base-content/50">No recipes yet</span>
        )}
      </DashCard>

      <DashCard title="Recent activity" onClick={() => onNavigate('chores')}>
        {d.activity.length === 0 ? (
          <span className="text-base-content/50 text-sm">Nothing yet</span>
        ) : (
          <span className="flex flex-col gap-1">
            {d.activity.map((a) => (
              <span key={a.id} className="text-sm">
                {a.text} <span className="text-base-content/50">{timeAgo(a.at)}</span>
              </span>
            ))}
          </span>
        )}
      </DashCard>

      <DashCard title="This week" onClick={() => onNavigate('chores')}>
        {d.workload.length === 0 ? (
          <span className="text-base-content/50 text-sm">No completions yet</span>
        ) : (
          <span className="flex flex-col gap-1">
            {d.workload.map((w) => (
              <span key={w.memberId} className="flex justify-between text-sm">
                <span>{w.name}</span>
                <span className="text-base-content/60">{w.completed}</span>
              </span>
            ))}
          </span>
        )}
      </DashCard>
    </div>
  )
}

/** The dedicated Settings destination: your name, members, rooms, notifications, invite. */
function SettingsSection({ view }: { view: HouseholdView }) {
  const queryClient = useQueryClient()
  const [displayName, setDisplayName] = useState(view.me.displayName)
  const [roomName, setRoomName] = useState('')
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const invalidateHousehold = () => queryClient.invalidateQueries({ queryKey: ['household'] })

  const rename = useMutation({
    mutationFn: () => updateMyName(displayName),
    onSuccess: invalidateHousehold,
  })
  const addRoomMutation = useMutation({
    mutationFn: () => addRoom(roomName),
    onSuccess: () => {
      setRoomName('')
      invalidateHousehold()
    },
  })
  const inviteMutation = useMutation({
    mutationFn: () => createInvite(view.household.id),
    onSuccess: (data) => setInviteLink(`${window.location.origin}/join?code=${data.code}`),
  })

  return (
    <>
      <Card title="Your name">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            rename.mutate()
          }}
          className="flex gap-2"
        >
          <input
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            aria-label="Your display name"
            className="input input-bordered input-sm flex-1"
          />
          <button type="submit" className="btn btn-primary btn-sm">
            {rename.isSuccess ? 'Saved' : 'Save'}
          </button>
        </form>
        <p className="text-base-content/50 text-xs">
          Shown to your household. Separate from your sign-in email.
        </p>
      </Card>

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
          <button type="submit" className="btn btn-primary btn-sm">
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
    </>
  )
}

function HouseholdHome({ view }: { view: HouseholdView }) {
  const [tab, setTab] = useState<Workspace>('dashboard')

  const workspaces = [
    { id: 'dashboard', label: 'Home' },
    { id: 'chores', label: 'Chores' },
    { id: 'shopping', label: 'Shopping' },
    { id: 'meals', label: 'Meals' },
  ] as const

  return (
    <div className="min-h-dvh bg-base-200 pb-20">
      <div className="mx-auto flex max-w-lg flex-col gap-4 p-4">
        <header className="flex items-center justify-between py-2">
          <h1 className="font-bold text-2xl">{view.household.name}</h1>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setTab('settings')}
              className={`btn btn-ghost btn-sm ${tab === 'settings' ? 'btn-active' : ''}`}
            >
              Settings
            </button>
            <button
              type="button"
              onClick={() => {
                void authClient.signOut().then(() => window.location.reload())
              }}
              className="btn btn-ghost btn-sm"
            >
              Sign out
            </button>
          </div>
        </header>

        {tab === 'dashboard' && <DashboardSection onNavigate={setTab} />}
        {tab === 'chores' && (
          <>
            <ChoresSection view={view} />
            <HistorySection />
          </>
        )}
        {tab === 'shopping' && <ShoppingSection view={view} />}
        {tab === 'meals' && <MealsSection view={view} />}
        {tab === 'settings' && <SettingsSection view={view} />}
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-10 border-base-300 border-t bg-base-100">
        <div className="mx-auto flex max-w-lg">
          {workspaces.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => setTab(w.id)}
              className={`flex-1 py-3 text-center text-sm ${
                tab === w.id ? 'font-semibold text-primary' : 'text-base-content/60'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </nav>
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
