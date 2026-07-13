import type { SprinklerApi } from '../types'
import { RealApi } from './client'
import { MockApi } from './mock'

const useMock = import.meta.env.VITE_MOCK === '1'

const mock = useMock ? new MockApi() : null

/** The API the app codes against; mock and real client are interchangeable. */
export const api: SprinklerApi = mock ?? new RealApi()

/** Non-null only in mock mode; drives the dev-only MOCK badge. */
export const mockControls: MockApi | null = mock
