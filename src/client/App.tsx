import { useEffect, useState } from 'react'

/**
 * Placeholder shell. Proves the client -> worker round trip works.
 * Replace once the spec lands.
 */
export default function App() {
  const [health, setHealth] = useState<string>('checking...')

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json() as Promise<{ status: string }>)
      .then((body) => setHealth(body.status))
      .catch(() => setHealth('unreachable'))
  }, [])

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-2 p-6">
      <h1 className="font-semibold text-2xl">Lottes Project</h1>
      <p className="text-neutral-500 text-sm">
        API: <span className="font-mono">{health}</span>
      </p>
    </main>
  )
}
