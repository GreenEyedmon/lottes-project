import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router'
import { Home, Join } from './screens.tsx'

const rootRoute = createRootRoute({ component: Outlet })

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Home,
})

const joinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/join',
  component: Join,
  validateSearch: (search: Record<string, unknown>): { code: string } => ({
    code: typeof search.code === 'string' ? search.code : '',
  }),
})

const routeTree = rootRoute.addChildren([indexRoute, joinRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
