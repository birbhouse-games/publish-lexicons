// Module imports
import fs from 'node:fs/promises'

import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export async function getPackageJSON() {
	const packageJSONPath = resolve(__dirname, '..', 'package.json')
	const packageJSONFile = await fs.readFile(packageJSONPath, 'utf-8')
	return JSON.parse(packageJSONFile)
}
