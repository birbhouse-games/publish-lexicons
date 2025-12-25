// Module imports
import { type Stats } from 'node:fs'

export interface PathDetails {
	path: string
	stats?: Stats
}
